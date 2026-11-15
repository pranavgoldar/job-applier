import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
test("HTTP auth, protected files, preparation, packets, confirmations and persistence", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-http-"));
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  let child;
  const start = () =>
    new Promise((resolve, reject) => {
      child = spawn(process.execPath, ["src/server.mjs"], {
        env: {
          ...process.env,
          DATA_DIR: dir,
          PORT: String(port),
          APP_PASSWORD: "test-password-strong-123",
          NODE_ENV: "production",
          EMBEDDED_WORKER: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => {
        if (d.toString().includes("listening")) resolve();
      });
      child.once("exit", (code) => {
        if (code) reject(new Error("Server exited " + code));
      });
    });
  const stop = () =>
    new Promise((r) => {
      child.once("exit", r);
      child.kill("SIGTERM");
    });
  const origin = `http://127.0.0.1:${port}`;
  let cookie = "";
  const call = (p, b, extra = {}) =>
    fetch(
      origin + "/api/" + p,
      b === undefined
        ? { headers: { Cookie: cookie } }
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: origin,
              Cookie: cookie,
              ...extra,
            },
            body: JSON.stringify(b),
          },
    );
  try {
    await start();
    assert.equal((await call("state")).status, 401);
    assert.equal((await call("resumes/nope")).status, 401);
    assert.equal((await call("login", { password: "wrong" })).status, 401);
    const login = await call("login", { password: "test-password-strong-123" });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert(cookie.includes("career_session="));
    assert.equal((await call("settings", { mode: "auto" })).status, 400);
    assert.equal(
      (
        await call(
          "settings",
          { mode: "prepare" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    const r = await call("resumes", {
      track: "Product",
      name: "test.pdf",
      mime: "application/pdf",
      base64: Buffer.from("%PDF-1.7 fixture only").toString("base64"),
    });
    assert.equal(r.status, 200);
    const rid = (await r.json()).id;
    const job = await (
      await call("jobs", {
        title: "Product Intern",
        company: "TEST FIXTURE",
        originalUrl: "https://example.test/jobs/1",
        applyUrl: "https://jobs.lever.co/test/1/apply",
        location: "Remote India",
        employmentType: "Internship",
        description:
          "Product discovery, roadmap, fintech. No experience required.",
      })
    ).json();
    const a = await (await call("prepare", { jobId: job.id })).json();
    assert.equal(a.status, "Needs my input");
    assert.equal(a.resumeId, rid);
    const packet = await (await call("packet/" + a.id)).json();
    assert.equal(packet.resume.id, rid);
    assert.equal(packet.schema, "career-os-handoff-v1");
    assert(packet.resume.base64);
    const confirm = await call("applications/" + a.id, {
      action: "confirm",
      evidence: "TEST FIXTURE user confirmation REF-1",
    });
    assert.equal(confirm.status, 200);
    assert.equal((await confirm.json()).confirmation.type, "user-confirmed");
    assert.equal((await call("packet/" + a.id)).status, 400);
    const csv = await (await call("export")).text();
    assert(csv.includes("user-confirmed"));
    await stop();
    await start();
    const s = await (await call("state")).json();
    assert.equal(
      s.applications[0].confirmation.evidence,
      "TEST FIXTURE user confirmation REF-1",
    );
    assert.equal((await call("resumes/" + rid)).status, 200);
    assert.equal((await call("logout", {})).status, 200);
    assert.equal((await call("state")).status, 401);
  } finally {
    if (child && !child.killed) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
