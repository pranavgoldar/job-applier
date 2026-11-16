import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../src/store.mjs";
import { seed } from "../src/seed.mjs";
import { createHandler } from "../src/http.mjs";
import { upsertJob } from "../src/connectors.mjs";
import { addResume } from "../src/applications.mjs";
test("autofill packet, saved answers, opened marker and extension download", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autofill-test-")),
    store = new Store(dir),
    old = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  await seed(store);
  const server = http.createServer(createHandler(store)).listen(0),
    base = "http://127.0.0.1:" + server.address().port,
    post = (p, b) =>
      fetch(base + p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
  try {
    const pdf = Buffer.from("%PDF-1.7 test fixture");
    await addResume(store, {
      name: "Test APM resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    await addResume(store, {
      name: "Test founder office resume.pdf",
      bytes: pdf,
      mime: "application/pdf",
    });
    const id = await upsertJob(store, {
      company: "TEST FIXTURE",
      title: "Associate Product Manager",
      location: "Bengaluru",
      description: "Product discovery, roadmap and user research.",
      originalUrl: "https://jobs.lever.co/test/1",
      applyUrl: "https://jobs.lever.co/test/1/apply",
      source: "lever",
      sourceId: "1",
    });
    await post("/api/profile", {
      name: "Test Candidate",
      email: "t@example.com",
      phone: "+91 90000 00000",
    });
    // Unknown keys and invalid yes/no values are dropped.
    assert.equal(
      (
        await post("/api/answers", {
          answers: {
            linkedin: " https://linkedin.com/in/t ",
            relocate: "Maybe",
            relativeAtCompany: "No",
            hacker: "x",
          },
        })
      ).status,
      200,
    );
    const state = await (await fetch(base + "/api/state")).json();
    assert.deepEqual(state.answers, {
      linkedin: "https://linkedin.com/in/t",
      relativeAtCompany: "No",
    });
    assert(state.answerFields.some((f) => f.id === "noticePeriod"));
    const packet = await (await fetch(base + "/api/autofill/" + id)).json();
    assert.equal(packet.schema, "career-os-autofill-v1");
    assert.equal(packet.applyUrl, "https://jobs.lever.co/test/1/apply");
    assert.equal(packet.profile.name, "Test Candidate");
    assert.equal(packet.answers.relativeAtCompany, "No");
    // A product role gets the Product resume, byte for byte.
    assert.equal(packet.resume.name, "Test APM resume.pdf");
    assert.equal(
      Buffer.from(packet.resume.base64, "base64").toString(),
      pdf.toString(),
    );
    assert.equal((await fetch(base + "/api/autofill/nope")).status, 404);
    await post(`/api/jobs/${id}/opened`, {});
    assert((await store.job(id)).applyOpened);
    await post(`/api/jobs/${id}/opened`, { clear: true });
    assert.equal((await store.job(id)).applyOpened, undefined);
    const zip = await fetch(base + "/career-os-extension.zip");
    assert.equal(zip.headers.get("content-type"), "application/zip");
    assert.equal(
      Buffer.from(await zip.arrayBuffer()).readUInt32LE(0),
      0x04034b50,
    );
  } finally {
    server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (old !== undefined) process.env.APP_PASSWORD = old;
  }
});
