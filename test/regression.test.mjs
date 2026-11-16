// Each test here reproduces a fault found in review of 3.1.0 and keeps it fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../src/store.mjs";
import { seed } from "../src/seed.mjs";
import { createHandler } from "../src/http.mjs";
import { assess, isTargetRole } from "../src/matching.mjs";
import {
  discover,
  normalize,
  upsertJob,
  isTargetLocation,
} from "../src/connectors.mjs";
import { addResume, prepare, submitFixture } from "../src/applications.mjs";

const fixture = (fn) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-")),
    s = new Store(dir);
  try {
    await fn(s);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const pdf = Buffer.from("%PDF-1.7 test fixture");
const board = (jobs) => async () => ({
  ok: true,
  text: async () => JSON.stringify({ jobs }),
});
const posting = (id, title, location, content) => ({
  id,
  title,
  location: { name: location },
  content: content || "Product discovery and roadmap. 0-1 years of experience.",
  absolute_url: "https://example.test/jobs/" + id,
});
const greenhouse = (s) =>
  s.run(
    "INSERT INTO sources(id,kind,company,board) VALUES ('t','greenhouse','TEST','test')",
  );

// ---- 3. Vacancy cleanup -------------------------------------------------
test(
  "a job the employer still lists is not removed or called closed when its new description stops matching",
  fixture(async (s) => {
    await greenhouse(s);
    await discover(
      s,
      board([posting(1, "Associate Product Manager", "Bengaluru")]),
    );
    const before = (await s.jobs())[0];
    // Same posting, still on the board, now asking for far more experience.
    await discover(
      s,
      board([
        posting(
          1,
          "Associate Product Manager",
          "Bengaluru",
          "Own the roadmap. 8+ years of experience required.",
        ),
      ]),
    );
    const jobs = await s.jobs();
    assert.equal(jobs.length, 1, "the record is kept");
    assert.equal(jobs[0].id, before.id);
    assert.notEqual(jobs[0].closed, true, "it is still listed, so not closed");
    assert.match(jobs[0].unsuitable, /Experience requirement/);
    assert.equal(jobs[0].active, "Still listed on the source board");
    assert.match(
      jobs[0].description,
      /8\+ years/,
      "stored description is refreshed",
    );
    // If it changes back, it returns to the open list.
    await discover(
      s,
      board([posting(1, "Associate Product Manager", "Bengaluru")]),
    );
    const back = (await s.jobs())[0];
    assert.equal(back.unsuitable, undefined);
    assert(back.reopenedAt);
    assert.equal(back.firstSeen, before.firstSeen, "history is continuous");
  }),
);
test(
  "a role is marked missing only after a complete scan, and is never deleted",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('h','himalayas','Feed','intern')",
    );
    const item = (n) => ({
      title: "Product Management Intern",
      companyName: "Employer " + n,
      employmentType: "Intern",
      locationRestrictions: ["India"],
      description: "Product discovery.",
      applicationLink: "https://himalayas.app/jobs/" + n,
      guid: "https://himalayas.app/jobs/" + n,
    });
    const feed =
      (jobs, { failPage2 = false, total = jobs.length } = {}) =>
      async (url) =>
        /page=1\b/.test(url)
          ? {
              ok: true,
              text: async () => JSON.stringify({ totalCount: total, jobs }),
            }
          : failPage2
            ? { ok: false, status: 429 }
            : {
                ok: true,
                text: async () =>
                  JSON.stringify({ totalCount: total, jobs: [] }),
              };
    await discover(s, feed([item(1), item(2)]));
    assert.equal((await s.jobs()).length, 2);
    // Partial read (page 2 refused): job 2 is absent from what was read, but that proves nothing.
    await discover(s, feed([item(1)], { failPage2: true, total: 40 }));
    assert(
      !(await s.jobs()).some((j) => j.closed),
      "nothing marked missing after a partial scan",
    );
    // Complete read without job 2: now it is missing, and it is kept as history.
    await discover(s, feed([item(1)]));
    const jobs = await s.jobs();
    assert.equal(jobs.length, 2, "no record deleted");
    const gone = jobs.find((j) => j.company === "Employer 2");
    assert.equal(gone.closed, true);
    assert(gone.closedAt);
    assert.equal(gone.active, "No longer listed on the source board");
    // A failed scan changes nothing either.
    await discover(s, async () => ({ ok: false, status: 500 }));
    assert.equal((await s.jobs()).filter((j) => j.closed).length, 1);
  }),
);
test(
  "what the person did with a job survives a re-scan",
  fixture(async (s) => {
    await greenhouse(s);
    await discover(
      s,
      board([posting(1, "Associate Product Manager", "Bengaluru")]),
    );
    const j = (await s.jobs())[0];
    await s.run(
      "UPDATE jobs SET data=json_set(data,'$.collection','Saved','$.applyOpened','2026-11-16T00:00:00Z') WHERE id=?",
      j.id,
    );
    await discover(
      s,
      board([posting(1, "Associate Product Manager", "Bengaluru")]),
    );
    const after = (await s.jobs())[0];
    assert.equal(after.collection, "Saved");
    assert.equal(after.applyOpened, "2026-11-16T00:00:00Z");
  }),
);

// ---- 4. Remote eligibility ---------------------------------------------
test("a remote role restricted to other countries is never labelled as open to India", () => {
  const one = (countries) =>
    normalize(
      { kind: "himalayas", company: "Feed", board: "intern" },
      {
        jobs: [
          {
            title: "Product Management Intern",
            companyName: "Employer",
            employmentType: "Intern",
            locationRestrictions: countries,
            description: "Product discovery.",
            applicationLink: "https://himalayas.app/jobs/x",
          },
        ],
      },
    )[0];
  const us = one(["United States"]);
  assert.equal(us.location, "Remote · United States");
  assert.equal(us.indiaEligible, false);
  assert.deepEqual(us.remoteCountries, ["United States"]);
  assert.equal(isTargetLocation(us), false, "dropped by the location filter");
  assert.notEqual(assess(us).remoteEligibility, "India remote");
  const mixed = one(["United States", "India", "Canada", "Germany", "France"]);
  assert.equal(
    mixed.location,
    "Remote · India, United States, Canada + 2 more countries",
  );
  assert.equal(mixed.indiaEligible, true);
  assert.equal(assess(mixed).remoteEligibility, "India remote");
  const anywhere = one([]);
  assert.equal(anywhere.location, "Remote · Worldwide");
  assert.equal(assess(anywhere).remoteEligibility, "Worldwide remote");
});

// ---- 5. Matching --------------------------------------------------------
test("years in a company's history are not read as an experience requirement", () => {
  const years = (description, title = "Associate Product Manager") =>
    assess({
      title,
      description,
      location: "Bengaluru",
      employmentType: "Full-time",
    });
  const history = years(
    "Our company has operated for 10 years; no experience required.",
  );
  assert.equal(history.requiredYears, 0);
  assert(!history.blocked.some((b) => /Experience requirement/.test(b)));
  assert(
    !years(
      "Trusted by banks for over 15 years. Product discovery and roadmap work.",
    ).blocked.length,
  );
  // Real requirements are still read, wherever they are written.
  assert.equal(
    years("You have 5+ years of experience in product management.")
      .requiredYears,
    5,
  );
  assert.equal(years("Minimum 3 years in a similar role.").requiredYears, 3);
  assert.equal(
    years(
      "Product discovery.",
      "Product Management - UPI | Experience : 6-9 yrs",
    ).requiredYears,
    6,
  );
  assert.equal(
    years("We have operated for 12 years. 1-2 years of experience needed.")
      .requiredYears,
    1,
  );
  assert(
    years("8+ years of experience required.").blocked.some((b) =>
      /Experience requirement/.test(b),
    ),
  );
});
test("a generic title is kept when the described work is clearly Product or Founder's Office work", () => {
  const generic = {
    title: "Associate",
    location: "Bengaluru",
    description:
      "You will run product discovery and user research, shape the roadmap and track product metrics with the team.",
  };
  assert(isTargetRole(generic));
  assert.equal(assess(generic).matchedBy, "responsibilities");
  assert.equal(assess(generic).track, "Product");
  // A generic title with no such work, and other job families, stay out.
  assert(
    !isTargetRole({
      title: "Associate",
      description: "Process invoices and vendor payments.",
    }),
  );
  assert(
    !isTargetRole({
      title: "Backend Engineer",
      description:
        "Product discovery, user research, roadmap, product metrics.",
    }),
  );
  assert.equal(
    assess({ title: "Associate Product Manager", description: "" }).matchedBy,
    "title",
  );
});
test(
  "SmartRecruiters postings are judged on their full description, fetched before a resume is suggested",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('sr','smartrecruiters','TEST SR','TestSR')",
    );
    const calls = [];
    const api = async (url) => {
      calls.push(String(url));
      const u = new URL(url);
      if (/\/postings\/42$/.test(u.pathname))
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              applyUrl: "https://jobs.smartrecruiters.com/TestSR/42?oga=true",
              jobAd: {
                sections: {
                  jobDescription: {
                    text: "<p>Support the founder on business operations, fundraising and market expansion. Build the financial model.</p>",
                  },
                  qualifications: { text: "<p>0-1 years of experience.</p>" },
                },
              },
            }),
        };
      return {
        ok: true,
        text: async () =>
          JSON.stringify(
            u.searchParams.get("country") === "in"
              ? {
                  totalFound: 1,
                  content: [
                    {
                      id: "42",
                      name: "Product Strategy Associate",
                      company: { identifier: "TestSR" },
                      location: {
                        city: "Bengaluru",
                        country: "in",
                        fullLocation: "Bengaluru, India",
                      },
                      experienceLevel: {
                        id: "entry_level",
                        label: "Entry Level",
                      },
                      typeOfEmployment: { label: "Full-time" },
                    },
                  ],
                }
              : { totalFound: 0, content: [] },
          ),
      };
    };
    await discover(s, api);
    const j = (await s.jobs())[0];
    assert.match(j.description, /fundraising and market expansion/);
    assert.equal(j.descriptionPartial, false);
    // The title says Product; the real work is Founder's Office. The description decides.
    assert.equal(j.assessment.track, "Founder’s Office");
    assert.equal(j.assessment.requiredYears, 0);
    // The stored description is reused on the next scan instead of fetched again.
    const detailCalls = () =>
      calls.filter((c) => /\/postings\/42$/.test(new URL(c).pathname)).length;
    assert.equal(detailCalls(), 1);
    await discover(s, api);
    assert.equal(detailCalls(), 1);
  }),
);

// ---- 7. Coverage --------------------------------------------------------
test("Pinpoint boards and YC company pages are read as job sources", () => {
  const pin = normalize(
    { kind: "pinpoint", company: "TEST", board: "test" },
    {
      data: [
        {
          id: "9",
          title: "Product Analyst",
          url: "https://test.pinpointhq.com/en/postings/abc",
          description: "<p>About us</p>",
          key_responsibilities: "<ul><li>Run product discovery</li></ul>",
          skills_knowledge_expertise: "<p>1-2 years of experience</p>",
          employment_type_text: "Full Time",
          workplace_type: "onsite",
          location: { city: "Dubai", name: "UAE" },
        },
        {
          id: "10",
          title: "Product Analyst",
          url: "https://test.pinpointhq.com/en/postings/def",
          workplace_type: "remote",
          location: { city: "Belgrade", name: "Remote/Serbia" },
        },
      ],
    },
  );
  assert.equal(pin[0].location, "Dubai; UAE");
  assert.match(pin[0].description, /Run product discovery .*1-2 years/);
  assert(isTargetLocation(pin[0]));
  // Remote, but tied to another country: not a target location.
  assert(!isTargetLocation(pin[1]));
  const page =
    '<div data-page="' +
    JSON.stringify({
      props: {
        company: {
          name: "TEST",
          one_liner: "Payments for SaaS",
          batch_name: "Winter 2024",
        },
        jobPostings: [
          {
            id: 7,
            title: "Founder’s Office Associate",
            url: "/companies/test/jobs/abc-founders-office",
            location: "Bengaluru, KA, IN / Bengaluru, Karnataka, IN",
            type: "Full-time",
            minExperience: "1+ years",
            prettyRole: "Operations",
          },
        ],
      },
    })
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;") +
    '"></div>';
  const yc = normalize(
    { kind: "ycombinator", company: "TEST", board: "test" },
    page,
  )[0];
  assert.equal(yc.location, "Bengaluru, KA, IN");
  assert.equal(
    yc.originalUrl,
    "https://www.ycombinator.com/companies/test/jobs/abc-founders-office",
  );
  assert.equal(yc.descriptionPartial, true);
  assert.equal(assess(yc).requiredYears, 1);
  assert(isTargetRole(yc) && isTargetLocation(yc));
  assert.throws(() =>
    normalize(
      { kind: "ycombinator", company: "T", board: "t" },
      "<html>no data</html>",
    ),
  );
});

// ---- 2. Recording a submission -----------------------------------------
async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regression-http-")),
    store = new Store(dir),
    old = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  await seed(store);
  const server = http.createServer(createHandler(store)).listen(0),
    base = "http://127.0.0.1:" + server.address().port,
    post = async (p, b) => {
      const r = await fetch(base + p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      return { status: r.status, body: await r.json() };
    };
  try {
    await fn({ store, base, post });
  } finally {
    server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (old !== undefined) process.env.APP_PASSWORD = old;
  }
}
const sampleJob = (n = 1) => ({
  company: "TEST FIXTURE",
  title: "Associate Product Manager",
  location: "Bengaluru",
  description: "Product discovery, roadmap and user research.",
  originalUrl: "https://example.test/role/" + n,
  source: "test-fixture",
  sourceId: String(n),
});
test("an application cannot be marked Applied without the exact resume, a date and confirmation text", async () => {
  await withServer(async ({ store, post }) => {
    const id = await upsertJob(store, sampleJob());
    // The old one-click endpoint is gone.
    assert.equal(
      (await post(`/api/jobs/${id}/track`, { status: "Applied" })).status,
      404,
    );
    // No resume exists yet: nothing can be recorded.
    let r = await post(`/api/jobs/${id}/confirm`, {
      submittedAt: "2026-11-15",
      evidence: "TEST ONLY: confirmation email received",
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /exact resume/);
    assert.notEqual((await store.apps())[0]?.status, "Applied");
    const v1 = await addResume(store, {
      name: "Test APM resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    const v2 = await addResume(store, {
      name: "Test APM resume.pdf",
      bytes: Buffer.from("%PDF-1.7 second"),
      mime: "application/pdf",
    });
    const fo = await addResume(store, {
      name: "Test founder office resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    for (const bad of [
      {
        resumeId: "does-not-exist",
        submittedAt: "2026-11-15",
        evidence: "TEST ONLY: confirmation email",
      },
      { resumeId: v1, submittedAt: "2026-11-15", evidence: "short" },
      {
        resumeId: v1,
        submittedAt: "2999-01-01",
        evidence: "TEST ONLY: confirmation email",
      },
      {
        resumeId: v1,
        submittedAt: "yesterday",
        evidence: "TEST ONLY: confirmation email",
      },
    ])
      assert.equal(
        (await post(`/api/jobs/${id}/confirm`, bad)).status,
        400,
        JSON.stringify(bad),
      );
    // The person sent the OLDER version, not the current default, and says so.
    r = await post(`/api/jobs/${id}/confirm`, {
      resumeId: v1,
      submittedAt: "2026-11-15",
      evidence: "TEST ONLY: confirmation email received",
      attachment: {
        name: "confirmation.txt",
        mime: "text/plain",
        base64: Buffer.from("TEST receipt").toString("base64"),
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "Applied");
    assert.equal(r.body.resumeId, v1);
    assert.equal(r.body.resumeSnapshot.version, 1);
    assert.equal(r.body.confirmation.type, "user-confirmed");
    assert.equal(r.body.confirmation.submittedAt, "2026-11-15");
    assert(r.body.confirmation.fileId, "attachment stored");
    assert.notEqual(v1, v2);
    // A second record is refused, and a submitted application cannot be erased.
    assert.equal(
      (
        await post(`/api/jobs/${id}/confirm`, {
          resumeId: fo,
          submittedAt: "2026-11-15",
          evidence: "TEST ONLY: another one",
        })
      ).status,
      400,
    );
    assert.equal((await post(`/api/jobs/${id}/untrack`, {})).status, 400);
    assert.equal((await store.apps()).length, 1);
  });
});
test("an uncertain submission cannot be skipped past; only evidence or closing it resolves it", async () => {
  await withServer(async ({ store, post }) => {
    const r1 = await addResume(store, {
      name: "Test APM resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    const id = await upsertJob(store, sampleJob(2));
    const a = await prepare(store, id);
    const uncertain = await submitFixture(store, a.id, async () => {
      throw new Error("TEST: network dropped mid-submit");
    });
    assert.equal(uncertain.status, "Submission uncertain");
    // Stage shortcuts are refused.
    for (const status of [
      "Assessment / Interview",
      "Offer",
      "Applied",
      "Ready for final step",
    ])
      assert.equal(
        (await post(`/api/applications/${a.id}`, { action: "stage", status }))
          .status,
        400,
        status,
      );
    // So is the browser extension's automatic record, and so is removing it.
    const auto = await post(`/api/jobs/${id}/confirm`, {
      detected: true,
      resumeId: r1,
      url: "https://example.test/thanks",
    });
    assert.equal(auto.status, 400);
    assert.match(auto.body.error, /uncertain/i);
    assert.equal((await post(`/api/jobs/${id}/untrack`, {})).status, 400);
    assert.equal((await store.app(a.id)).status, "Submission uncertain");
    // Reconciling with the person's own evidence is the way through.
    const fixed = await post(`/api/jobs/${id}/confirm`, {
      resumeId: r1,
      submittedAt: "2026-11-15",
      evidence: "TEST ONLY: employer email confirms receipt",
    });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.status, "Applied");
    assert.equal(fixed.body.confirmation.type, "user-confirmed");
    assert(
      (await store.all("SELECT message FROM events WHERE app_id=?", a.id)).some(
        (e) => /reconciled/.test(e.message),
      ),
    );
  });
});
test("the three kinds of confirmation stay distinct", async () => {
  await withServer(async ({ store, post }) => {
    const r1 = await addResume(store, {
      name: "Test APM resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    // Seen by the browser extension: its own label, with the resume it attached.
    const seen = await upsertJob(store, sampleJob(3));
    const detected = await post(`/api/jobs/${seen}/confirm`, {
      detected: true,
      resumeId: r1,
      url: "https://jobs.lever.co/test/1/thanks",
    });
    assert.equal(detected.body.confirmation.type, "browser-detected");
    assert.match(detected.body.confirmation.evidence, /jobs\.lever\.co/);
    assert.equal(detected.body.resumeSnapshot.id, r1);
    // The extension attached nothing: it may not claim a resume.
    const blind = await upsertJob(store, sampleJob(4));
    assert.equal(
      (
        await post(`/api/jobs/${blind}/confirm`, {
          detected: true,
          url: "https://example.test",
        })
      ).status,
      400,
    );
    // Obtained by the system itself (test fixture adapter only).
    const fx = await upsertJob(store, sampleJob(5));
    const a = await prepare(store, fx);
    const system = await submitFixture(store, a.id, async () => ({
      receipt: "TEST-RECEIPT-1",
    }));
    assert.equal(system.confirmation.type, "system-confirmed");
    // Reported by the person.
    const mine = await upsertJob(store, sampleJob(6));
    const user = await post(`/api/jobs/${mine}/confirm`, {
      resumeId: r1,
      submittedAt: "2026-11-15",
      evidence: "TEST ONLY: reference ABC-123",
    });
    assert.equal(user.body.confirmation.type, "user-confirmed");
  });
});

// ---- 6. Scan status and diagnostics ------------------------------------
test("scan progress counts completed, failed and waiting sources and is complete only when none wait", async () => {
  const { scanProgress } = await import("../src/http.mjs");
  const started = "2026-11-16T10:00:00.000Z",
    src = (health, last_run, enabled = 1) => ({ health, last_run, enabled });
  const mid = scanProgress(
    [
      src("Healthy", "2026-11-16T10:00:05.000Z"),
      src("Error", "2026-11-16T10:00:06.000Z"),
      src("Healthy", "2026-11-15T03:00:00.000Z"), // checked yesterday, not in this scan
      src("Never run", null),
      src("Healthy", "2026-11-16T10:00:07.000Z", 0), // paused: not counted
    ],
    started,
    2,
  );
  assert.deepEqual(
    {
      total: mid.total,
      done: mid.done,
      failed: mid.failed,
      waiting: mid.waiting,
      active: mid.active,
      complete: mid.complete,
    },
    { total: 4, done: 1, failed: 1, waiting: 2, active: true, complete: false },
  );
  // The queue drained but two sources were never reached: still not complete.
  assert.equal(
    scanProgress(
      [src("Healthy", "2026-11-16T10:00:05.000Z"), src("Never run", null)],
      started,
      0,
    ).complete,
    false,
  );
  assert.equal(
    scanProgress(
      [
        src("Healthy", "2026-11-16T10:00:05.000Z"),
        src("Error", "2026-11-16T10:00:09.000Z"),
      ],
      started,
      0,
    ).complete,
    true,
  );
  assert.equal(scanProgress([src("Healthy", null)], null, 0).complete, false);
});
test("startup diagnostics name the failing setting or service and never reveal a secret", async () => {
  const { configChecks, explainFailure, safeMessage } =
    await import("../src/diagnostics.mjs");
  const secret = "s3cr3t-token-value-that-must-never-appear-1234567890";
  const checks = configChecks({
    APP_PASSWORD: "short",
    CRON_SECRET: secret,
    TURSO_DATABASE_URL: "libsql://my-private-db.turso.io",
    TURSO_AUTH_TOKEN: secret,
  });
  const by = Object.fromEntries(checks.map((c) => [c.check, c]));
  assert.equal(by.APP_PASSWORD.ok, false);
  assert.match(by.APP_PASSWORD.detail, /16 characters/);
  assert.equal(by.CRON_SECRET.ok, true);
  assert.equal(by.TURSO_AUTH_TOKEN.ok, true);
  assert.equal(by.BLOB_READ_WRITE_TOKEN.ok, false);
  assert.match(by.BLOB_READ_WRITE_TOKEN.detail, /Missing/);
  const all = JSON.stringify([
    checks,
    explainFailure(
      "database",
      new Error(
        `SERVER_ERROR: HTTP 401 from libsql://my-private-db.turso.io with ${secret}`,
      ),
    ),
    safeMessage(
      new Error(
        `fetch failed for https://my-private-db.turso.io/v2/pipeline token=${secret}`,
      ),
    ),
  ]);
  assert(!all.includes(secret), "secret value leaked");
  assert(!all.includes("my-private-db"), "database address leaked");
  assert.match(
    explainFailure("database", new Error("HTTP status 401")).detail,
    /TURSO_AUTH_TOKEN/,
  );
  assert.match(
    explainFailure("database", new Error("fetch failed ENOTFOUND")).detail,
    /TURSO_DATABASE_URL/,
  );
  assert.match(explainFailure("storage", new Error("blob")).detail, /Blob/);
  // The hosted entry point returns these instead of a generic message.
  const saved = { ...process.env };
  for (const k of [
    "APP_PASSWORD",
    "CRON_SECRET",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "BLOB_READ_WRITE_TOKEN",
  ])
    delete process.env[k];
  process.env.APP_PASSWORD = "a-long-enough-test-password";
  try {
    const { default: handler } = await import("../api/index.mjs?diagnostics");
    let status, body;
    await handler(
      { url: "/api/state", method: "GET", headers: {} },
      {
        writeHead: (c) => (status = c),
        end: (b) => (body = JSON.parse(b)),
        setHeader() {},
      },
    );
    assert.equal(status, 503);
    assert.match(body.error, /CRON_SECRET/);
    assert.match(body.error, /TURSO_DATABASE_URL/);
    assert(
      !body.error.includes("APP_PASSWORD"),
      "a valid setting is not blamed",
    );
    assert.equal(
      body.diagnostics.find((d) => d.check === "APP_PASSWORD").ok,
      true,
    );
    assert(!JSON.stringify(body).includes("a-long-enough-test-password"));
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
