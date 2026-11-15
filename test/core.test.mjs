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
} from "../src/connectors.mjs";
import {
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
        description: "Product discovery. 2–3 years required.",
      }),
    ).decision,
    "Skip",
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
