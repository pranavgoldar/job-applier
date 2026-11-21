import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { discover } from "../src/connectors.mjs";
import { jobLink, importJobLink, LinkError } from "../src/job-link.mjs";

const fixture = (fn) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-link-")),
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
  status: 200,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const lever = (id, text, place = "Bengaluru") => ({
  id,
  text,
  categories: { location: place, commitment: "Full-time" },
  hostedUrl: `https://jobs.lever.co/acme/${id}`,
  applyUrl: `https://jobs.lever.co/acme/${id}/apply`,
  descriptionPlain:
    "Own product discovery, write specs and work with engineering. 0-1 years of experience.",
});

test("job links are read for every supported board", () => {
  const cases = [
    [
      "https://job-boards.greenhouse.io/acme/jobs/4567?gh_src=li",
      ["greenhouse", "acme", "4567"],
    ],
    [
      "https://boards.greenhouse.io/embed/job_app?for=acme&token=4567",
      ["greenhouse", "acme", "4567"],
    ],
    [
      "https://jobs.lever.co/acme/1b2c-3d/apply?lever-source=LinkedIn",
      ["lever", "acme", "1b2c-3d"],
    ],
    [
      "https://jobs.ashbyhq.com/acme/9f8e-7d/application",
      ["ashby", "acme", "9f8e-7d"],
    ],
    [
      "https://jobs.smartrecruiters.com/Acme1/744000012345678-associate-product-manager",
      ["smartrecruiters", "Acme1", "744000012345678"],
    ],
    [
      "https://apply.workable.com/acme/j/ABC123DEF/",
      ["workable", "acme", "ABC123DEF"],
    ],
    [
      "https://acme.pinpointhq.com/en/postings/5d1c-aa",
      ["pinpoint", "acme", "5d1c-aa"],
    ],
    ["https://acme.bamboohr.com/careers/42", ["bamboohr", "acme", "42"]],
    [
      "https://ats.rippling.com/en-GB/acme/jobs/77aa-bb",
      ["rippling", "acme", "77aa-bb"],
    ],
    [
      "https://ats.rippling.com/acme/jobs/77aa-bb",
      ["rippling", "acme", "77aa-bb"],
    ],
    [
      "https://careers.kula.ai/cashfree/12345-product-analyst",
      ["kula", "cashfree", "12345"],
    ],
    [
      "https://acme.teamtailor.com/jobs/6789012-associate-product-manager",
      ["teamtailor", "acme.teamtailor.com", "6789012"],
    ],
  ];
  for (const [url, [kind, board, id]] of cases) {
    const link = jobLink(url);
    assert.ok(link, url);
    assert.deepEqual([link.kind, link.board, link.id], [kind, board, id], url);
  }
  // A company's own domain is only a guess at Teamtailor.
  assert.equal(
    jobLink("https://careers.sarwa.co/jobs/123-product-manager").customDomain,
    true,
  );
  for (const bad of [
    "https://www.linkedin.com/jobs/view/4012345678",
    "https://jobs.lever.co/acme",
    "https://boards.greenhouse.io/acme",
    "javascript:alert(1)",
    "not a link",
    "https://intranet.local/jobs/12-x",
  ])
    assert.equal(jobLink(bad)?.customDomain ? null : jobLink(bad), null, bad);
});

test(
  "a pasted Lever link adds the job, saves it and puts the company on the scan list",
  fixture(async (store) => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      assert.match(url, /^https:\/\/api\.lever\.co\/v0\/postings\/acme\?/);
      return ok([
        lever("aaa-1", "Associate Product Manager"),
        lever("bbb-2", "Founder's Office Associate", "Mumbai"),
        lever("ccc-3", "Senior Backend Engineer"),
      ]);
    };
    const r = await importJobLink(
      store,
      "https://jobs.lever.co/acme/aaa-1/apply?lever-source=LinkedIn",
      { company: "Acme Pay" },
      fetcher,
    );
    assert.ok(r.id);
    assert.equal(r.companyAdded, true);
    assert.match(r.message, /Associate Product Manager/);
    assert.match(r.message, /checked in every scan/);
    assert.match(r.message, /1 more matching role/);
    assert.equal(
      calls.length,
      1,
      "the board is read once, from its public feed",
    );
    const sources = await store.all("SELECT * FROM sources WHERE kind='lever'");
    assert.equal(sources.length, 1);
    assert.equal(sources[0].company, "Acme Pay");
    assert.equal(sources[0].board, "acme");
    const jobs = await store.jobs();
    const added = jobs.find((j) => j.id === r.id);
    assert.equal(added.title, "Associate Product Manager");
    assert.equal(added.company, "Acme Pay");
    assert.equal(added.collection, "Saved");
    assert.ok(added.addedByYou);
    assert.ok(jobs.some((j) => j.title === "Founder's Office Associate"));
    assert.ok(!jobs.some((j) => /Backend/.test(j.title)));

    // Pasting another link from the same company reuses its board.
    const again = await importJobLink(
      store,
      "https://jobs.lever.co/acme/bbb-2",
      {},
      fetcher,
    );
    assert.equal(again.companyAdded, false);
    assert.equal(
      (await store.all("SELECT * FROM sources WHERE kind='lever'")).length,
      1,
    );

    // The next scan keeps what you did with the job.
    await discover(store, fetcher);
    const after = (await store.jobs()).find((j) => j.id === r.id);
    assert.equal(after.collection, "Saved");
    assert.ok(after.addedByYou);
  }),
);

test(
  "a job you add that falls outside your filters is kept, with the reason",
  fixture(async (store) => {
    const r = await importJobLink(
      store,
      "https://jobs.lever.co/acme/ccc-3",
      {},
      async () => ok([lever("ccc-3", "Senior Backend Engineer")]),
    );
    assert.ok(r.id);
    assert.ok(r.outsideFilters);
    assert.match(r.message, /outside your usual filters/);
    const job = (await store.jobs()).find((j) => j.id === r.id);
    assert.equal(job.company, "Acme", "company name is made from the board");
    assert.ok(job.addedByYou);
    assert.equal(job.assessment.track, "Founder’s Office");
    const pm = await importJobLink(
      store,
      "https://jobs.lever.co/acme/ddd-4",
      {},
      async () => ok([lever("ddd-4", "Senior Product Manager")]),
    );
    assert.equal(
      (await store.jobs()).find((j) => j.id === pm.id).assessment.track,
      "Product",
      "the APM resume goes with a product role you added",
    );
  }),
);

test(
  "links that can't be read say why and change nothing",
  fixture(async (store) => {
    const never = async () => {
      throw new Error("must not fetch");
    };
    await assert.rejects(
      importJobLink(
        store,
        "https://www.linkedin.com/jobs/view/4012345678",
        {},
        never,
      ),
      (e) => e instanceof LinkError && /company's own job page/.test(e.message),
    );
    // An unknown company domain is not fetched.
    await assert.rejects(
      importJobLink(store, "https://careers.example.org/jobs/12-pm", {}, never),
      LinkError,
    );
    // A board that can't be read is not added to the list.
    await assert.rejects(
      importJobLink(
        store,
        "https://jobs.lever.co/nobody/aaa-1",
        {},
        async () => ({ ok: false, status: 404, text: async () => "" }),
      ),
      (e) => e instanceof LinkError && /HTTP 404/.test(e.message),
    );
    assert.equal((await store.all("SELECT * FROM sources")).length, 0);
  }),
);

test(
  "a closed posting still adds the company, and says the posting is gone",
  fixture(async (store) => {
    const r = await importJobLink(
      store,
      "https://jobs.lever.co/acme/gone-9",
      {},
      async () => ok([lever("aaa-1", "Associate Product Manager")]),
    );
    assert.equal(r.id, null);
    assert.equal(r.companyAdded, true);
    assert.match(r.message, /may have closed/);
    assert.equal((await store.all("SELECT * FROM sources")).length, 1);
  }),
);

test(
  "a Teamtailor site on the company's own domain works once that company is on the list",
  fixture(async (store) => {
    await store.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('s1','teamtailor','Sarwa','careers.sarwa.co')",
    );
    const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><item><title>Associate Product Manager</title><description>Own the roadmap. 0-1 years of experience.</description><link>https://careers.sarwa.co/jobs/555-associate-product-manager</link><remoteStatus>none</remoteStatus><guid>g-555</guid><tt:locations><tt:location><tt:city>Dubai</tt:city><tt:country>United Arab Emirates</tt:country></tt:location></tt:locations></item></channel></rss>`;
    const r = await importJobLink(
      store,
      "https://careers.sarwa.co/en/jobs/555-associate-product-manager",
      {},
      async (url) => {
        assert.equal(url, "https://careers.sarwa.co/jobs.rss");
        return ok(rss);
      },
    );
    assert.ok(r.id);
    assert.equal(r.companyAdded, false);
    const job = (await store.jobs()).find((j) => j.id === r.id);
    assert.equal(job.company, "Sarwa");
  }),
);

test("the dashboard shows a job you added even outside your filters, and explains bad links", async () => {
  const http = await import("node:http");
  const { createHandler } = await import("../src/http.mjs");
  const { upsertJob } = await import("../src/connectors.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-link-http-")),
    store = new Store(dir),
    old = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  const server = http.createServer(createHandler(store)).listen(0),
    base = "http://127.0.0.1:" + server.address().port;
  try {
    const job = {
      company: "Acme",
      title: "Senior Backend Engineer",
      location: "Bengaluru",
      description: "Build services. 5+ years of experience.",
      source: "lever",
      sourceId: "x-1",
    };
    const mine = await upsertJob(store, {
      ...job,
      originalUrl: "https://jobs.lever.co/acme/x-1",
      addedByYou: "2026-11-21T00:00:00Z",
    });
    const scanned = await upsertJob(store, {
      ...job,
      sourceId: "x-2",
      originalUrl: "https://jobs.lever.co/acme/x-2",
    });
    const state = await (await fetch(base + "/api/state")).json();
    const a = state.jobs.find((j) => j.id === mine),
      b = state.jobs.find((j) => j.id === scanned);
    assert.equal(a.unsuitable, null);
    assert.ok(a.outsideFilters);
    assert.ok(b.unsuitable, "jobs found by a scan are still filtered");
    const r = await fetch(base + "/api/jobs/from-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.linkedin.com/jobs/view/1" }),
    });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /Apply on company website/);
  } finally {
    server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (old !== undefined) process.env.APP_PASSWORD = old;
  }
});
