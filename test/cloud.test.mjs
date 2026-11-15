import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { CloudStore } from "../src/cloud-store.mjs";
import { Store, sha, now } from "../src/store.mjs";
import { LocalFiles, BlobFiles } from "../src/files.mjs";
import { seed } from "../src/seed.mjs";
import { upsertJob } from "../src/connectors.mjs";
import { addResume, prepare, confirmManual } from "../src/applications.mjs";
import {
  enqueueCloudDiscovery,
  runCloudQueue,
  nextCloudRun,
  validCronAuthorization,
} from "../src/cloud-worker.mjs";
import { createHandler } from "../src/http.mjs";
import { migratePrivateData } from "../src/migrate-cloud.mjs";
import api, { originalAPIURL } from "../api/index.mjs";
const withCloud = (fn) => async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-cloud-")),
    url = "file:" + path.join(root, "cloud.sqlite"),
    storage = new LocalFiles(path.join(root, "files")),
    cloud = await CloudStore.open({ url, storage });
  try {
    await fn({ root, url, storage, cloud });
  } finally {
    cloud.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};
const job = {
  company: "TEST employer",
  title: "Product Intern",
  location: "Remote India",
  employmentType: "Internship",
  description:
    "Fintech product discovery, user research and roadmap. No experience required.",
  originalUrl: "https://example.test/cloud-job",
  source: "manual",
  sourceId: "cloud",
};
const bytes = Buffer.from("%PDF-1.7 cloud fixture");
test(
  "libSQL storage survives independent instances and preserves exact application resume versions",
  withCloud(async ({ url, storage, cloud }) => {
    await seed(cloud);
    await cloud.set("profile", {
      name: "Private Test Candidate",
      email: "candidate@example.test",
      education: "Test university",
      graduation: "2027-05",
      fullTimeStart: "2027-05-15",
      internshipAvailability: "Remote study-compatible hours",
      facts: "Verified TEST FIXTURE research",
    });
    const one = await addResume(cloud, {
        track: "Product",
        name: "one.pdf",
        bytes,
        mime: "application/pdf",
      }),
      id = await upsertJob(cloud, job),
      a = await prepare(cloud, id);
    await addResume(cloud, {
      track: "Product",
      name: "two.pdf",
      bytes: Buffer.from("%PDF-1.7 new fixture"),
      mime: "application/pdf",
    });
    const second = await CloudStore.open({ url, storage });
    try {
      assert.equal((await second.app(a.id)).resumeId, one);
      assert.equal((await second.app(a.id)).resumeSnapshot.sha256, sha(bytes));
      assert((await second.storage.read("resumes/" + one)).equals(bytes));
      assert.equal(
        (await second.config("profile")).name,
        "Private Test Candidate",
      );
      await confirmManual(second, a.id, {
        evidence: "TEST receipt from candidate, reference 100",
      });
      assert.equal((await cloud.app(a.id)).confirmation.type, "user-confirmed");
    } finally {
      second.close();
    }
  }),
);
test(
  "cloud discovery queue deduplicates source work, collects both tracks and recovers stale reads",
  withCloud(async ({ cloud }) => {
    await seed(cloud);
    await cloud.run("UPDATE sources SET enabled=0");
    await cloud.run(
      "UPDATE sources SET enabled=1 WHERE company IN ('Aspora','Flagright')",
    );
    await enqueueCloudDiscovery(cloud);
    await enqueueCloudDiscovery(cloud);
    assert.equal(
      (await cloud.all("SELECT * FROM queue WHERE status='queued'")).length,
      2,
    );
    await cloud.run(
      "UPDATE queue SET status='running',started='2020-01-01T00:00:00.000Z' WHERE id=(SELECT id FROM queue LIMIT 1)",
    );
    const mock = async (url) => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          jobs: [
            {
              id: url,
              title: "Founder’s Office Intern",
              location: "Remote India",
              descriptionPlain: "Founder support and business operations.",
              jobUrl: "https://example.test/" + encodeURIComponent(url),
              employmentType: "Internship",
            },
          ],
        }),
    });
    const result = await runCloudQueue(cloud, {
      fetcher: mock,
      budgetMs: 10000,
      concurrency: 2,
    });
    assert.equal(result.completed, 2);
    assert.equal(result.queued, 0);
    assert.equal((await cloud.jobs()).length, 2);
    assert(
      (await cloud.jobs()).every(
        (j) => j.assessment.track === "Founder’s Office",
      ),
    );
    assert(
      (await cloud.all("SELECT health FROM sources WHERE enabled=1")).every(
        (s) => s.health === "Healthy",
      ),
    );
  }),
);
test(
  "hosted API login sessions and private downloads work across handlers",
  withCloud(async ({ cloud, url, storage }) => {
    const prior = process.env.APP_PASSWORD;
    process.env.APP_PASSWORD = "cloud-test-strong-password";
    await seed(cloud);
    const r = await addResume(cloud, {
      track: "Product",
      name: "fixture.pdf",
      bytes,
      mime: "application/pdf",
    });
    const other = await CloudStore.open({ url, storage }),
      a = http.createServer(
        createHandler(cloud, {
          hosted: true,
          onDiscoveryQueued: async () => "queued-test",
        }),
      ),
      b = http.createServer(
        createHandler(other, {
          hosted: true,
          onDiscoveryQueued: async () => "queued-test",
        }),
      );
    await new Promise((r) => a.listen(0, "127.0.0.1", r));
    await new Promise((r) => b.listen(0, "127.0.0.1", r));
    const first = "http://127.0.0.1:" + a.address().port,
      second = "http://127.0.0.1:" + b.address().port;
    try {
      assert.equal((await fetch(second + "/api/resumes/" + r)).status, 401);
      const login = await fetch(first + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: process.env.APP_PASSWORD }),
      });
      assert.equal(login.status, 200);
      assert(login.headers.get("set-cookie").includes("Secure"));
      const cookie = login.headers.get("set-cookie").split(";")[0],
        file = await fetch(second + "/api/resumes/" + r, {
          headers: { Cookie: cookie },
        });
      assert.equal(file.status, 200);
      assert(Buffer.from(await file.arrayBuffer()).equals(bytes));
      const s = await (
        await fetch(second + "/api/state", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(s.runtime, "vercel");
      assert.equal(s.maxUploadBytes, 3 * 1024 * 1024);
      const task = await fetch(second + "/api/discover", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal((await task.json()).id, "queued-test");
    } finally {
      await Promise.all([
        new Promise((r) => a.close(r)),
        new Promise((r) => b.close(r)),
      ]);
      other.close();
      if (prior === undefined) delete process.env.APP_PASSWORD;
      else process.env.APP_PASSWORD = prior;
    }
  }),
);
test(
  "private local-to-cloud migration preserves records, files and checksums and refuses overwrite",
  withCloud(async ({ root, cloud }) => {
    await seed(cloud);
    const local = new Store(path.join(root, "local"));
    try {
      await seed(local);
      await local.set("profile", { name: "Private migrated candidate" });
      const resume = await addResume(local, {
          track: "Product",
          name: "old.pdf",
          bytes,
          mime: "application/pdf",
        }),
        j = await upsertJob(local, job),
        app = await prepare(local, j);
      await local.updateApp(app.id, { notes: "Private TEST notes" });
      const result = await migratePrivateData(local, cloud);
      assert.equal(result.applications, 1);
      assert.equal((await cloud.app(app.id)).notes, "Private TEST notes");
      assert.equal((await cloud.app(app.id)).resumeId, resume);
      assert.equal(
        (await cloud.config("profile")).name,
        "Private migrated candidate",
      );
      assert((await cloud.storage.read("resumes/" + resume)).equals(bytes));
      await assert.rejects(
        () => migratePrivateData(local, cloud),
        /refuses to overwrite/,
      );
    } finally {
      local.close();
    }
  }),
);
test("Blob storage always requests private access and does not overwrite versioned files", async () => {
  const calls = [],
    sdk = {
      put: async (k, b, o) => {
        calls.push({ kind: "put", o });
        return { pathname: k };
      },
      get: async (k, o) => {
        calls.push({ kind: "get", o });
        return { statusCode: 200, stream: new Blob([bytes]).stream() };
      },
      del: async (k, o) => calls.push({ kind: "del", o }),
    };
  const files = new BlobFiles("TEST-TOKEN", sdk);
  await files.write("resumes/test", bytes, "application/pdf");
  assert((await files.read("resumes/test")).equals(bytes));
  await files.remove("resumes/test");
  assert.equal(calls[0].o.access, "private");
  assert.equal(calls[0].o.allowOverwrite, false);
  assert.equal(calls[1].o.access, "private");
  assert.equal(calls[1].o.useCache, false);
});
test("cron denies unsigned calls before database initialization and normalizes Vercel routes", async () => {
  assert(!validCronAuthorization(undefined, "secret"));
  assert(!validCronAuthorization("Bearer wrong", "secret"));
  assert(validCronAuthorization("Bearer secret", "secret"));
  assert.equal(
    nextCloudRun(Date.parse("2026-11-15T04:00:00Z")),
    "2026-11-16T03:00:00.000Z",
  );
  assert.equal(
    originalAPIURL("/api/index?route=resumes%2Fid&preview=1"),
    "/api/resumes/id?preview=1",
  );
  let status, body;
  await api(
    { url: "/api/index?route=cron", method: "GET", headers: {} },
    { writeHead: (s) => (status = s), end: (s) => (body = s) },
  );
  assert.equal(status, 401);
  assert(JSON.parse(body).error.includes("authorization"));
});
test(
  "concurrent cloud edits preserve independently changed application fields",
  withCloud(async ({ cloud, url, storage }) => {
    await seed(cloud);
    await addResume(cloud, {
      track: "Product",
      name: "test.pdf",
      bytes,
      mime: "application/pdf",
    });
    const app = await prepare(cloud, await upsertJob(cloud, job)),
      other = await CloudStore.open({ url, storage });
    try {
      await Promise.all([
        cloud.updateApp(app.id, { notes: "A private TEST note" }),
        other.updateApp(app.id, { checks: [0, 2] }),
      ]);
      const current = await cloud.app(app.id);
      assert.equal(current.notes, "A private TEST note");
      assert.deepEqual(current.checks, [0, 2]);
      assert.equal(current.resumeId, app.resumeId);
    } finally {
      other.close();
    }
  }),
);
