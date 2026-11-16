import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, uuid, now } from "../src/store.mjs";
import { initialProfile, assess, classify } from "../src/matching.mjs";
import {
  upsertJob,
  discover,
  canonical,
  normalize,
  isTargetRole,
  isTargetLocation,
  sourceURL,
} from "../src/connectors.mjs";
import {
  trackFromName,
  untrack,
  addResume,
  prepare,
  overrideResume,
  confirmManual,
  submitFixture,
  setStage,
  approveEligibility,
} from "../src/applications.mjs";
import { tick } from "../src/worker.mjs";
function fixture(fn) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-test-")),
      s = new Store(dir);
    try {
      await fn(s);
    } finally {
      s.close();
      fs.rmSync(dir, {
        recursive: true,
        force: true,
      });
    }
  };
}
const pdf = Buffer.from("%PDF-1.7 test fixture");
const job = (x = {}) => ({
  company: "TEST FIXTURE",
  title: "Product Management Intern",
  location: "Remote India",
  employmentType: "Internship",
  description:
    "Fintech product discovery, user research, roadmap and product metrics. No experience required.",
  originalUrl: "https://example.test/role",
  source: "test-fixture",
  sourceId: "1",
  ...x,
});
const resume = async (s, t = "Product") =>
  await addResume(s, {
    track: t,
    name: "fixture.pdf",
    bytes: pdf,
    mime: "application/pdf",
  });
test(
  "deduplicates tracking URLs and prevents duplicate applications",
  fixture(async (s) => {
    await resume(s);
    const id = await upsertJob(s, job());
    assert.equal(
      await upsertJob(
        s,
        job({
          originalUrl: "https://example.test/role?utm_source=test",
        }),
      ),
      id,
    );
    const a = await prepare(s, id);
    assert.equal((await prepare(s, id)).id, a.id);
    assert.equal((await s.apps()).length, 1);
  }),
);
test("classifies responsibilities over misleading title", () => {
  const c = classify(
    job({
      title: "Founder’s Associate",
      description:
        "Own product discovery, user research, roadmap, product metrics and product requirements.",
    }),
  );
  assert.equal(c.track, "Product");
  assert.equal(
    classify(
      job({
        title: "Product Strategy Associate",
        description:
          "Support founder, business operations, fundraising, market expansion and financial modelling.",
      }),
    ).track,
    "Founder’s Office",
  );
});
test(
  "overlap requests review and resume can be overridden",
  fixture(async (s) => {
    await resume(s);
    const f = await resume(s, "Founder’s Office");
    const id = await upsertJob(
      s,
      job({
        description:
          "Product discovery and user research with founder support and business operations.",
      }),
    );
    const a = await prepare(s, id);
    assert.equal(a.status, "Needs my input");
    assert.equal((await overrideResume(s, a.id, f)).resumeId, f);
  }),
);
test("remote location excludes India and explicit US-only restriction wins", () => {
  const a = assess(
    job({
      location: "Remote, US only",
      description:
        "Product discovery. Must be located in the United States. 0–1 years experience.",
    }),
  );
  assert.equal(a.decision, "Skip");
  assert.equal(a.remoteEligibility, "Remote restricted to another country");
});
test("joining before graduation is blocked for full-time", () => {
  const a = assess(
    job({
      title: "Graduate Product Manager",
      employmentType: "Full-time",
      location: "India",
      startDate: "2027-01-01",
    }),
  );
  assert(a.blocked.some((x) => /joining date/.test(x)));
});
test("unknown eligibility is review, never inferred eligible", () => {
  const a = assess(
    job({
      location: "Remote",
      description: "Own the roadmap.",
    }),
  );
  assert.equal(a.decision, "Review");
  assert(a.review.some((x) => /permit work from India/.test(x)));
  assert(a.review.some((x) => /authorization/.test(x)));
});
test("greater than two years and missing mandatory Figma hard block", () => {
  assert.equal(
    assess(
      job({
        description: "Product discovery. 3–5 years required.",
      }),
    ).decision,
    "Skip",
  );
  // A range is judged by its lower bound: 1–3 years is a stretch, not a block.
  assert.equal(
    assess(
      job({
        description: "Product discovery. 1–3 years required.",
      }),
    ).decision,
    "Review",
  );
  assert.equal(
    assess(
      job({
        description: "Product discovery. Figma required.",
      }),
    ).decision,
    "Skip",
  );
});
test(
  "connector outage preserves existing job and exposes health",
  fixture(async (s) => {
    const id = await upsertJob(s, job());
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
      "test",
      "greenhouse",
      "TEST",
      "test",
    );
    const mock = async () => ({
      ok: false,
      status: 404,
    });
    await discover(s, mock);
    assert.equal((await s.job(id)).title, job().title);
    assert.equal((await s.get("SELECT health FROM sources")).health, "Error");
    assert.notEqual((await s.job(id)).active, "Closed");
  }),
);
test(
  "public connector normalization and dedupe source id",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
      "test",
      "ashby",
      "TEST",
      "test",
    );
    const mock = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          jobs: [
            {
              id: "a",
              title: "Product Analyst",
              location: "India",
              descriptionPlain: "Fintech product analytics and SQL.",
              jobUrl: "https://example.test/a",
              applyUrl: "https://example.test/a/apply",
              isListed: true,
            },
          ],
        }),
    });
    await discover(s, mock);
    await discover(s, mock);
    assert.equal((await s.jobs()).length, 1);
    assert.equal((await s.get("SELECT health FROM sources")).health, "Healthy");
  }),
);
test(
  "resume update preserves exact earlier application file and checksum",
  fixture(async (s) => {
    const r1 = await resume(s),
      id = await upsertJob(s, job()),
      a = await prepare(s, id);
    await addResume(s, {
      track: "Product",
      name: "new.pdf",
      bytes: Buffer.from("%PDF-1.7 second version"),
      mime: "application/pdf",
    });
    assert.equal((await s.app(a.id)).resumeId, r1);
    assert.equal((await s.app(a.id)).resumeSnapshot.version, 1);
    assert.equal(
      fs
        .readFileSync(
          s.file((await s.get("SELECT path FROM resumes WHERE id=?", r1)).path),
        )
        .toString(),
      pdf.toString(),
    );
  }),
);
test(
  "manual confirmation requires evidence and is labeled user-confirmed",
  fixture(async (s) => {
    await resume(s);
    const a = await prepare(s, await upsertJob(s, job()));
    await assert.rejects(
      async () =>
        await confirmManual(s, a.id, {
          evidence: "",
        }),
    );
    const applied = await confirmManual(s, a.id, {
      evidence: "Employer confirmation email received, ref TEST-1",
    });
    assert.equal(applied.status, "Applied");
    assert.equal(applied.confirmation.type, "user-confirmed");
    await assert.rejects(
      async () =>
        await confirmManual(s, a.id, {
          evidence: "Duplicate user confirmation",
        }),
    );
    await assert.rejects(async () => await overrideResume(s, a.id, a.resumeId));
  }),
);
test(
  "timeout is uncertain and blocks retries until reconciliation",
  fixture(async (s) => {
    await resume(s);
    const a = await prepare(s, await upsertJob(s, job()));
    const result = await submitFixture(s, a.id, async () => {
      throw new Error("timeout");
    });
    assert.equal(result.status, "Submission uncertain");
    await assert.rejects(
      async () =>
        await submitFixture(s, a.id, async () => ({
          receipt: "duplicate",
        })),
      /Reconcile/,
    );
    await assert.rejects(
      async () => await setStage(s, a.id, "Ready for final step"),
      /Reconcile/,
    );
  }),
);
test(
  "system confirmation only follows adapter receipt, live submission rejected",
  fixture(async (s) => {
    await resume(s);
    const a = await prepare(s, await upsertJob(s, job()));
    const applied = await submitFixture(s, a.id, async () => ({
      receipt: "TEST FIXTURE confirmation receipt",
    }));
    assert.equal(applied.confirmation.type, "system-confirmed");
    const b = await prepare(
      s,
      await upsertJob(
        s,
        job({
          source: "manual",
          sourceId: "2",
          originalUrl: "https://example.test/live",
        }),
      ),
    );
    await assert.rejects(
      async () =>
        await submitFixture(s, b.id, async () => ({
          receipt: "bad",
        })),
      /unsupported/,
    );
  }),
);
test(
  "new discovery tasks are durable and concurrent requests deduplicate",
  fixture(async (s) => {
    assert.equal(await s.enqueue("discovery"), await s.enqueue("discovery"));
    assert.equal((await s.all("SELECT * FROM queue")).length, 1);
  }),
);
test("ATS identifiers reject URL and private network injection", () => {
  assert.throws(() => canonical("javascript:alert(1)"));
  assert.throws(() =>
    normalize(
      {
        kind: "ashby",
      },
      {
        unexpected: true,
      },
    ),
  );
});
test("negated remote wording does not convert a hybrid graduate role into India remote", () => {
  const a = assess(
    job({
      title: "Graduate Product Owner",
      location: "Dubai UAE, hybrid",
      employmentType: "Full-time",
      description:
        "Fintech product strategy. Conditional visa assistance. No India-remote option stated.",
    }),
  );
  assert.equal(a.remoteEligibility, "Onsite / hybrid / unknown");
});
test(
  "unresolved review cannot become ready through ordinary stage changes",
  fixture(async (s) => {
    await resume(s);
    const a = await prepare(s, await upsertJob(s, job()));
    await assert.rejects(
      async () => await setStage(s, a.id, "Ready for final step"),
      /eligibility/,
    );
    await assert.rejects(
      async () => await setStage(s, a.id, "Applied"),
      /workflow/,
    );
    const ready = await approveEligibility(
      s,
      a.id,
      "TEST ONLY: user checked all employer eligibility and hours requirements.",
    );
    assert.equal(ready.status, "Ready for final step");
    const bad = await prepare(
      s,
      await upsertJob(
        s,
        job({
          originalUrl: "https://example.test/senior",
          sourceId: "senior",
          description: "Product discovery. 3–5 years required.",
        }),
      ),
    );
    await assert.rejects(
      async () =>
        await approveEligibility(
          s,
          bad.id,
          "TEST: attempt to approve hard block",
        ),
      /hard eligibility/,
    );
  }),
);

test("resume track is read from the file name", () => {
  assert.equal(trackFromName("Pranav Goldar APM resume.pdf"), "Product");
  assert.equal(
    trackFromName("Pranav Goldar founder office resume.pdf"),
    "Founder’s Office",
  );
  assert.equal(trackFromName("Founders_Office_v3.docx"), "Founder’s Office");
  assert.equal(trackFromName("resume.pdf"), null);
});
test(
  "a resume uploaded without a track is filed by its name, and an unclear name is refused",
  fixture(async (s) => {
    const id = await addResume(s, {
      name: "Pranav Goldar APM resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    assert.equal(
      (await s.get("SELECT track FROM resumes WHERE id=?", id)).track,
      "Product",
    );
    await assert.rejects(
      async () =>
        await addResume(s, {
          name: "cv.pdf",
          bytes: pdf,
          mime: "application/pdf",
        }),
    );
  }),
);
test(
  "an unsubmitted packet can be removed; a submitted application is kept as history",
  fixture(async (s) => {
    const r = await resume(s);
    const id = await upsertJob(s, job());
    await prepare(s, id);
    await untrack(s, id);
    assert.equal((await s.apps()).length, 0);
    const a = await prepare(s, id);
    await confirmManual(s, a.id, {
      resumeId: r,
      evidence: "TEST ONLY: confirmation email received",
    });
    await assert.rejects(async () => await untrack(s, id), /history/);
    assert.equal((await s.apps()).length, 1);
  }),
);
test("only early-career Product and Founder’s Office titles are targeted", () => {
  for (const title of [
    "Associate Product Manager",
    "APM",
    "Product Analyst",
    "Product Management Intern",
    "Founder’s Office",
    "Chief of Staff",
    "Associate, Strategy & Operations",
    "Business Analyst Intern",
    "Binance Accelerator Program - Growth Operations",
  ])
    assert(isTargetRole({ title }), title);
  for (const title of [
    "Product Engineer II",
    "Senior Product Designer",
    "Product Marketing Manager",
    "Account Executive, Product Sales",
    "Product Counsel",
    "HR Operations Intern",
    "Backend Developer",
    "Card Risk Strategy Specialist",
  ])
    assert(!isTargetRole({ title }), title);
});
test("locations outside India, Dubai and Singapore are dropped; preferred cities rank highest", () => {
  for (const location of [
    "Bengaluru",
    "Mumbai, Maharashtra",
    "Gurugram, India",
    "Dubai, United Arab Emirates",
    "Hong Kong; Singapore",
    "Remote - APAC",
    "Remote",
  ])
    assert(isTargetLocation({ location }), location);
  for (const location of [
    "San Francisco, CA",
    "Remote - US",
    "London",
    "Indianapolis, IN",
    "Unknown",
  ])
    assert(!isTargetLocation({ location }), location);
  const points = (location) =>
    assess(job({ employmentType: "Full-time", title: "APM", location })).parts
      .location;
  assert(points("Bangalore") > points("Mumbai"));
  assert(points("Mumbai") > points("Dubai"));
  assert(points("Dubai") > points("Singapore"));
});
test("seniority words, level II titles and years stated in the title block a role", () => {
  for (const title of [
    "Senior Product Manager",
    "Product Manager II",
    "Group Product Manager",
    "Product Management - UPI | Experience : 6-9 yrs",
  ])
    assert(
      assess(job({ title, employmentType: "Full-time" })).blocked.length,
      title,
    );
  assert.equal(
    assess(job({ title: "Chief of Staff", employmentType: "Full-time" }))
      .blocked.length,
    0,
  );
  assert.equal(
    assess(
      job({
        title: "Product Manager I - International",
        employmentType: "Full-time",
      }),
    ).employmentType,
    "Full-time",
  );
});
test("SmartRecruiters and Workable boards are normalized", () => {
  const sr = normalize(
    { kind: "smartrecruiters", company: "TEST", board: "Test" },
    {
      totalFound: 1,
      content: [
        {
          id: "42",
          name: "Associate Product Manager",
          company: { identifier: "Test" },
          location: {
            city: "Bengaluru",
            country: "in",
            fullLocation: "Bengaluru, India",
          },
          experienceLevel: { id: "entry_level", label: "Entry Level" },
          typeOfEmployment: { label: "Full-time" },
        },
      ],
    },
  )[0];
  assert.equal(sr.originalUrl, "https://jobs.smartrecruiters.com/Test/42");
  assert.equal(sr.location, "Bengaluru, India");
  assert.equal(sr.experienceLevel, "Entry Level");
  const w = normalize(
    { kind: "workable", company: "TEST", board: "test" },
    {
      jobs: [
        {
          title: "Product Intern",
          shortcode: "ABC",
          url: "https://apply.workable.com/j/ABC",
          city: "Singapore",
          country: "Singapore",
          employment_type: "Internship",
        },
      ],
    },
  )[0];
  assert.equal(w.location, "Singapore, Singapore");
  assert.equal(w.sourceId, "ABC");
  assert.match(
    sourceURL({ kind: "smartrecruiters", board: "Wise" }),
    /^https:\/\/api\.smartrecruiters\.com\/v1\/companies\/Wise\/postings/,
  );
  assert.throws(() => sourceURL({ kind: "workday", board: "x" }));
});
test(
  "a scan keeps only matching roles and marks ones the board no longer lists, without deleting them",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('t','greenhouse','TEST','test')",
    );
    const board = (jobs) => async () => ({
      ok: true,
      text: async () => JSON.stringify({ jobs }),
    });
    const posting = (id, title, location) => ({
      id,
      title,
      location: { name: location },
      content: "Product discovery and roadmap. 0-1 years experience.",
      absolute_url: "https://example.test/jobs/" + id,
    });
    await discover(
      s,
      board([
        posting(1, "Associate Product Manager", "Bengaluru"),
        posting(2, "Product Analyst", "Mumbai"),
        posting(3, "Associate Product Manager", "New York"),
        posting(4, "Senior Product Manager", "Bengaluru"),
        posting(5, "Backend Engineer", "Bengaluru"),
      ]),
    );
    let jobs = await s.jobs();
    assert.deepEqual(jobs.map((j) => j.sourceId).sort(), ["1", "2"]);
    assert.equal(
      jobs[0].assessment.region,
      jobs[0].location === "Mumbai" ? "Mumbai" : "Bangalore",
    );
    // Job 2 is saved by the user, then both disappear from the board.
    const saved = jobs.find((j) => j.sourceId === "2");
    await s.run(
      "UPDATE jobs SET data=? WHERE id=?",
      JSON.stringify({ ...saved, collection: "Saved" }),
      saved.id,
    );
    await discover(s, board([]));
    jobs = await s.jobs();
    // Nothing is deleted: both are kept as history and marked no longer listed.
    assert.equal(jobs.length, 2);
    assert(jobs.every((j) => j.closed === true && j.closedAt));
    assert.equal(jobs.find((j) => j.sourceId === "2").collection, "Saved");
  }),
);

test("business-side internships are kept; engineering, design and HR internships are not", () => {
  for (const title of [
    "Product Management Intern",
    "Founder’s Office Intern",
    "Operations Intern",
    "Data Analytics Intern",
    "Financial Data Analyst Intern, Technical Operations",
    "Community Marketing Intern",
    "Project Management Intern",
    "Management Trainee",
  ])
    assert(isTargetRole({ title }), title);
  for (const title of [
    "Software Engineer Intern",
    "UX Design - Intern",
    "Talent Acquisition Intern",
    "HR Intern",
    "Compliance Intern, KYC",
    "Social Media Intern",
    "Sales Intern",
  ])
    assert(!isTargetRole({ title }), title);
});
test(
  "the remote internship feed keeps India-eligible business internships from many employers",
  fixture(async (s) => {
    await s.run(
      "INSERT INTO sources(id,kind,company,board) VALUES ('h','himalayas','Himalayas remote internships','intern')",
    );
    const posting = (n, title, countries = ["India"]) => ({
      title,
      companyName: "Employer " + n,
      employmentType: "Intern",
      seniority: ["Entry-level"],
      locationRestrictions: countries,
      description: "<p>Help the team.</p>",
      pubDate: 1794824260,
      applicationLink: "https://himalayas.app/companies/e/jobs/" + n,
      guid: "https://himalayas.app/companies/e/jobs/" + n,
    });
    let calls = 0;
    const feed = async (url) => {
      calls++;
      assert.match(String(url), /country=IN/);
      // The second page is refused, as the keyless rate limit does.
      if (/page=2/.test(url)) return { ok: false, status: 429 };
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            totalCount: 40,
            jobs: [
              posting(1, "Product Management Intern"),
              posting(2, "Founder’s Office Intern", ["India", "Nepal"]),
              posting(3, "Java Intern"),
              posting(4, "HR Intern"),
            ],
          }),
      };
    };
    await discover(s, feed);
    const jobs = await s.jobs();
    assert.deepEqual(jobs.map((j) => j.title).sort(), [
      "Founder’s Office Intern",
      "Product Management Intern",
    ]);
    assert(jobs.every((j) => j.assessment.employmentType === "Internship"));
    assert(
      jobs.every((j) => j.assessment.remoteEligibility === "India remote"),
    );
    assert(jobs.some((j) => j.company === "Employer 1"));
    // A partial read still counts as a healthy source with its matches kept.
    assert.equal((await s.get("SELECT health FROM sources")).health, "Healthy");
    assert(calls >= 2);
  }),
);
test(
  "several reads are answered together and the state endpoint needs one batch",
  fixture(async (s) => {
    await s.set("a", 1);
    const [config, jobs] = await s.readMany([
      { sql: "SELECT key FROM config WHERE key=?", args: ["a"] },
      { sql: "SELECT * FROM jobs" },
    ]);
    assert.equal(config[0].key, "a");
    assert.deepEqual(jobs, []);
  }),
);
