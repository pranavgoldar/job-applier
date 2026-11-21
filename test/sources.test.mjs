import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { normalize, sourceURL, discover } from "../src/connectors.mjs";

const fixture = (fn) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sources-")),
    s = new Store(dir);
  try {
    await fn(s);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const ok = (body) => ({
  ok: true,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const rssItem = (n, title, city = "Dubai", remote = "none") => `<item>
  <title>${title}</title>
  <description>&lt;p&gt;Own product discovery and the roadmap. 0-1 years of experience.&lt;/p&gt;</description>
  <pubDate>Thu, 19 Nov 2026 12:35:03 +0400</pubDate>
  <link>https://careers.example.com/jobs/${n}-role</link>
  <remoteStatus>${remote}</remoteStatus>
  <guid>guid-${n}</guid>
  <tt:locations><tt:location><tt:name>${city}</tt:name><tt:city>${city}</tt:city><tt:country>United Arab Emirates</tt:country></tt:location></tt:locations>
</item>`;
const rss = (items) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>T</title>${items.join("")}</channel></rss>`;

test("Teamtailor RSS items become jobs with city, country, remote status and apply link", () => {
  const [onsite, remote] = normalize(
    { kind: "teamtailor", company: "TEST", board: "careers.example.com" },
    rss([
      rssItem(1, "Associate Product Manager"),
      rssItem(2, "Founder&#39;s Office Associate", "Abu Dhabi", "fully"),
    ]),
  );
  assert.equal(onsite.title, "Associate Product Manager");
  assert.equal(onsite.location, "Dubai; United Arab Emirates");
  assert.equal(onsite.isRemote, false);
  assert.match(onsite.description, /product discovery/);
  assert.equal(
    onsite.applyUrl,
    "https://careers.example.com/jobs/1-role/applications/new",
  );
  assert.equal(onsite.sourceId, "guid-1");
  assert.equal(remote.title, "Founder's Office Associate");
  assert.equal(remote.isRemote, true);
  assert.match(remote.location, /Remote/);
  assert.throws(() =>
    normalize(
      { kind: "teamtailor", company: "T", board: "careers.example.com" },
      "<html></html>",
    ),
  );
});

test("a Teamtailor source must be a public host name, never a path, address or internal name", () => {
  assert.equal(
    sourceURL({ kind: "teamtailor", board: "careers.sarwa.co" }),
    "https://careers.sarwa.co/jobs.rss",
  );
  for (const board of [
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "careers.example.com/admin",
    "a.local",
    "intranet.corp",
    "https://careers.example.com",
    "careers..example.com",
    "-bad.example.com",
  ])
    assert.throws(() => sourceURL({ kind: "teamtailor", board }), board);
  for (const kind of ["bamboohr", "rippling"])
    for (const board of ["../x", "a.b", "UPPER", "a/b"])
      assert.throws(() => sourceURL({ kind, board }), kind + " " + board);
});

test(
  "BambooHR list entries are read, and the posting's own page supplies the description",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('b','bamboohr','TEST','acme')",
    );
    const calls = [];
    await discover(s, async (url) => {
      calls.push(String(url));
      if (/\/careers\/list$/.test(url))
        return ok({
          meta: { totalCount: 2 },
          result: [
            {
              id: "11",
              jobOpeningName: "Associate Product Manager",
              employmentStatusLabel: "Full-Time",
              location: { city: "Bengaluru", state: "Karnataka" },
              atsLocation: {},
              isRemote: null,
              locationType: "0",
            },
            {
              id: "12",
              jobOpeningName: "Senior Backend Engineer",
              employmentStatusLabel: "Full-Time",
              location: { city: "Bengaluru" },
              atsLocation: {},
              isRemote: null,
              locationType: "0",
            },
          ],
        });
      if (/\/careers\/11\/detail$/.test(url))
        return ok({
          result: {
            jobOpening: {
              description:
                "<p>Run product discovery, own the roadmap and product metrics. 0-1 years of experience.</p>",
              datePosted: "2026-11-10",
              location: { addressCountry: "India" },
            },
          },
        });
      return { ok: false, status: 404 };
    });
    const jobs = await s.jobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].originalUrl, "https://acme.bamboohr.com/careers/11");
    assert.equal(jobs[0].descriptionPartial, false);
    assert.match(jobs[0].location, /Bengaluru.*India/);
    // A title that is ruled out never costs a detail request.
    assert(!calls.some((u) => /\/careers\/12\/detail/.test(u)));
    assert.equal((await s.get("SELECT health FROM sources")).health, "Healthy");
  }),
);

test(
  "Rippling boards are read page by page before anything is marked missing",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('r','rippling','TEST','acme')",
    );
    const item = (n, title, city = "Bengaluru") => ({
      id: "id-" + n,
      name: title,
      url: "https://ats.rippling.com/acme/jobs/id-" + n,
      department: { name: "Product" },
      locations: [
        {
          name: city + ", India",
          country: "India",
          city,
          workplaceType: "ON_SITE",
        },
      ],
    });
    const pages = [
      { items: [item(1, "Associate Product Manager")], page: 0, totalPages: 2 },
      {
        items: [item(2, "Founder's Office Associate", "Mumbai")],
        page: 1,
        totalPages: 2,
      },
    ];
    const seen = [];
    await discover(s, async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      seen.push(page);
      return ok(pages[page]);
    });
    assert.deepEqual(seen, [0, 1]);
    const jobs = await s.jobs();
    assert.deepEqual(jobs.map((j) => j.title).sort(), [
      "Associate Product Manager",
      "Founder's Office Associate",
    ]);
    assert(jobs.every((j) => j.applyUrl.endsWith("/apply")));
  }),
);

test("the four companies moved off manual checks have verified sources; the rest say why they stay manual", () => {
  const cat = JSON.parse(fs.readFileSync("src/target-companies.json", "utf8"));
  const by = (id) => cat.find((c) => c.id === id);
  assert.deepEqual(by("ramp").connector, { kind: "ashby", board: "ramp" });
  assert.deepEqual(by("sarwa").connector, {
    kind: "teamtailor",
    board: "careers.sarwa.co",
  });
  assert.deepEqual(by("fasset").connector, {
    kind: "bamboohr",
    board: "fasset",
  });
  assert.deepEqual(by("different").connector, {
    kind: "rippling",
    board: "differentai",
  });
  for (const id of [
    "juspay",
    "monee",
    "nephroplus",
    "navi",
    "revolut",
    "remitly",
  ]) {
    assert.equal(by(id).connector, null, id);
    assert(
      by(id).note && by(id).checkedOn,
      id + " needs a recorded reason and date",
    );
  }
  for (const c of cat.filter((c) => c.connector))
    assert.doesNotThrow(() => sourceURL(c.connector), c.name);
});

test("Pinpoint jobs open straight on the application form", () => {
  const [job] = normalize(
    { kind: "pinpoint", company: "TEST", board: "test" },
    {
      data: [
        {
          id: "1",
          title: "Product Analyst",
          url: "https://test.pinpointhq.com/en/postings/abc",
          location: { city: "Dubai", name: "UAE" },
        },
      ],
    },
  );
  assert.equal(job.originalUrl, "https://test.pinpointhq.com/en/postings/abc");
  assert.equal(
    job.applyUrl,
    "https://test.pinpointhq.com/en/postings/abc/applications/new",
  );
});
