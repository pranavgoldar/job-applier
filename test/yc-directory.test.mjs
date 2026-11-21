import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { discover, normalize } from "../src/connectors.mjs";
import { seedYCDirectories, readYC } from "../src/yc-discovery.mjs";
import { runCloudQueue } from "../src/cloud-worker.mjs";

function setup(t, authorized = true) {
  const previous = process.env.YC_DISCOVERY_AUTHORIZED;
  process.env.YC_DISCOVERY_AUTHORIZED = String(authorized);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yc-boards-"));
  const s = new Store(dir);
  t.after(() => {
    if (previous === undefined) delete process.env.YC_DISCOVERY_AUTHORIZED;
    else process.env.YC_DISCOVERY_AUTHORIZED = previous;
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return s;
}
const roles = [
  [
    "peakflo",
    "Peakflo",
    "Product Manager Intern - (Paid - India/Remote)",
    "India",
    "Internship",
    "Any (new grads ok)",
  ],
  [
    "weekday",
    "Weekday",
    "Founder's Office",
    "Bengaluru, KA, IN",
    "Full-time",
    "1+ years",
  ],
  [
    "cityfurnish",
    "Cityfurnish",
    "Founder’s Office - Intern",
    "Gurugram, HR, IN / Gurugram, Haryana, IN",
    "Internship",
    "Any",
  ],
  [
    "landeed",
    "Landeed",
    "People & Operations Associate (HR & Admin)",
    "Hyderabad, India",
    "Full-time",
    "Any",
  ],
  [
    "spine",
    "Spine",
    "AI & Operations Associate",
    "Remote (CA, US)",
    "Full-time",
    "Any",
  ],
];
const listing = ([slug, name, title, location, type, minExperience]) => ({
  company: { name },
  jobPostings: [
    {
      id: roles.findIndex((r) => r[0] === slug) + 1,
      title,
      location,
      type,
      minExperience,
      url: "/companies/" + slug + "/jobs/example",
      salaryRange: "Published range",
    },
  ],
});
function html(props) {
  return (
    '<div data-page="' +
    JSON.stringify({ props })
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;") +
    '"></div>'
  );
}
test("hiring directories paginate, deduplicate employers and scan their jobs in the same hosted run", async (t) => {
  const s = setup(t);
  await seedYCDirectories(s);
  await s.run(
    "UPDATE sources SET enabled=0 WHERE board NOT IN ('india','bengaluru')",
  );
  for (const source of await s.all("SELECT * FROM sources WHERE enabled=1"))
    await s.enqueue("discovery-source", { sourceId: source.id });
  const times = [],
    paths = [];
  const fetcher = async (url, options) => {
    times.push(Date.now());
    const u = new URL(url);
    paths.push(u.pathname + u.search);
    assert.equal(
      options.headers["User-Agent"],
      "CareerDesk/1.0 public-job-discovery",
    );
    const companies = roles.map(([slug, name]) => ({ slug, name }));
    const props = u.pathname.endsWith("/hiring")
      ? u.pathname.includes("/location/india/")
        ? {
            companies: u.search ? companies.slice(2) : companies.slice(0, 2),
            totalPages: 2,
          }
        : { companies: companies.slice(0, 1), totalPages: 1 }
      : listing(roles.find((r) => u.pathname.endsWith("/" + r[0])));
    return { ok: true, text: async () => html(props) };
  };
  const queue = await runCloudQueue(s, {
    fetcher,
    concurrency: 3,
    budgetMs: 30000,
  });
  assert.equal(queue.queued, 0);
  assert.equal(paths.length, 8);
  assert.equal(new Set(paths).size, 8);
  assert(paths.includes("/companies/location/india/hiring?page=2"));
  assert(!paths.some((p) => p.startsWith("/companies?")));
  for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= 500);
  const jobs = await s.jobs();
  assert.deepEqual(
    jobs
      .filter((j) => !j.unsuitable)
      .map((j) => j.company)
      .sort(),
    ["Peakflo", "Weekday"],
  );
  const peak = jobs.find((j) => j.company === "Peakflo");
  assert.equal(peak.assessment.requiredYears, 0);
  assert.equal(peak.assessment.internshipWorkplace, "Remote");
  assert.equal(peak.compensation, "Published range");
  const city = jobs.find((j) => j.company === "Cityfurnish");
  assert.equal(city.assessment.category, "Founder’s Office");
  assert.match(city.unsuitable, /on-site.*outside Bangalore and Mumbai/);
  assert(!city.closed);
  assert.equal(jobs.length, 3);
  const spine = normalize(
    { kind: "ycombinator", board: "spine" },
    listing(roles[4]),
  )[0];
  assert.deepEqual(spine.remoteCountries, ["CA", "US"]);
  // A failed individual company page cannot mark its historical posting closed.
  await discover(
    s,
    async () => ({
      ok: true,
      text: async () => html({ company: { name: "Cityfurnish" } }),
    }),
    { sourceIds: ["yc-company-cityfurnish"] },
  );
  assert.equal(
    (
      await s.get(
        "SELECT health FROM sources WHERE id='yc-company-cityfurnish'",
      )
    ).health,
    "Error",
  );
  assert(!(await s.job(city.id)).closed);
});
test("YC access is opt-in and rate limiting never retries a blocked request", async (t) => {
  const s = setup(t, false);
  await seedYCDirectories(s);
  assert.equal((await s.all("SELECT * FROM sources")).length, 0);
  let calls = 0;
  const fail = async () => {
    calls++;
    return {
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "120" }),
    };
  };
  const url = "https://www.ycombinator.com/companies/peakflo";
  await assert.rejects(readYC(s, url, fail, Infinity), /authorization/);
  assert.equal(calls, 0);
  process.env.YC_DISCOVERY_AUTHORIZED = "true";
  await assert.rejects(readYC(s, url, fail, Infinity), /429/);
  await assert.rejects(readYC(s, url, fail, Date.now() + 200), /waiting/);
  assert.equal(calls, 1);
  assert(Number(await s.config("ycNextRequest")) > Date.now() + 100000);
});
