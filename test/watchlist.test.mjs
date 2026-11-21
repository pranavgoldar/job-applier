import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { catalog, ensureWatchlist, watchlistState } from "../src/watchlist.mjs";
import { seed } from "../src/seed.mjs";
import { sourceURL, discover, upsertJob } from "../src/connectors.mjs";
const fixture = (fn) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "company-test-")),
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
test(
  "watchlist keeps all 22 named firms, clarified identities and equal-track preferences",
  fixture(async (s) => {
    await seed(s);
    const c = await watchlistState(s);
    assert.equal(c.filter((x) => x.group === "Your target").length, 22);
    for (const n of [
      "Dozee",
      "Different AI",
      "XPay Checkout",
      "Alaan",
      "Remitly",
      "Brex",
      "NephroPlus",
    ])
      assert(
        c.some((x) => x.name === n),
        n,
      );
    assert.equal(new Set(c.map((x) => x.id)).size, c.length);
    assert(!c.some((x) => x.name === "Vance"));
    assert(c.find((x) => x.id === "aspora").aliases.includes("Vance"));
    assert.deepEqual(
      (await s.config("companySearchPreferences")).trackWeights,
      {
        Product: 0.5,
        "Founder’s Office": 0.5,
      },
    );
    assert(c.every((x) => x.tracks.length === 2));
    assert(c.find((x) => x.id === "revolut").coverage.startsWith("Manual"));
    assert.equal(
      c.find((x) => x.id === "wise").connector.kind,
      "smartrecruiters",
    );
    // Evidence is only recorded with a source; unknowns stay unknown.
    const alaan = c.find((x) => x.id === "alaan");
    assert.match(alaan.fundingStage, /Series A/);
    assert.match(alaan.fundingEvidenceUrl, /^https:\/\//);
    assert.equal(alaan.ycBacked, true);
    // YC pages are not read without YC's permission; Alaan's own board needs a private key.
    assert.equal(alaan.connector, null);
    assert.match(alaan.coverage, /^Manual/);
    assert.match(alaan.note, /private API/);
    assert.deepEqual(c.find((x) => x.id === "cashfree").connector, {
      kind: "kula",
      board: "cashfree",
    });
    assert(
      !c.some((x) => x.connector?.kind === "ycombinator"),
      "no company depends on YC pages",
    );
    assert.equal(c.find((x) => x.id === "tabby").connector.kind, "pinpoint");
    assert(c.find((x) => x.id === "remitly").coverage.startsWith("Manual"));
    for (const x of c.filter((x) => x.ycBacked === true)) {
      assert.match(
        x.ycEvidenceUrl,
        /^https:\/\/www\.ycombinator\.com\/companies\//,
        x.name,
      );
      assert(x.ycBatch, x.name);
    }
    for (const x of c)
      assert(
        !x.fundingEvidenceUrl === /^(Unknown|Not )/.test(x.fundingStage),
        x.name + ": a funding claim needs a source, and a source needs a claim",
      );
    assert(c.filter((x) => x.sourceId).length >= 70);
  }),
);
test(
  "installing the update adds watchlist without replacing records or resuming paused sources",
  fixture(async (s) => {
    await s.set("profile", {
      name: "Existing user",
    });
    await s.set("sourcesInitialized", true);
    await s.run(
      "INSERT INTO sources(id,kind,company,board,enabled,health) VALUES (?,?,?,?,?,?)",
      "existing-aspora",
      "ashby",
      "Aspora",
      "Aspora",
      0,
      "Error",
    );
    const id = await upsertJob(s, {
      company: "Saved employer",
      title: "Product Intern",
      location: "India",
      originalUrl: "https://example.test/saved",
      source: "manual",
      sourceId: "saved",
      description: "Product discovery",
    });
    await seed(s);
    const count = (await s.all("SELECT * FROM sources")).length,
      events = (await s.all("SELECT * FROM events")).length;
    await seed(s);
    assert.equal((await s.config("profile")).name, "Existing user");
    const saved = await s.job(id);
    assert.equal(saved.title, "Product Intern");
    assert.equal(saved.assessment.category, "Product management");
    assert.match(saved.unsuitable, /on-site/);
    assert(!saved.closed);
    assert.equal(
      (await s.get("SELECT enabled FROM sources WHERE id=?", "existing-aspora"))
        .enabled,
      0,
    );
    assert.equal(
      (await watchlistState(s)).find((c) => c.id === "aspora").coverage,
      "Collection paused",
    );
    assert.equal((await s.all("SELECT * FROM sources")).length, count);
    assert.equal((await s.all("SELECT * FROM events")).length, events);
  }),
);
test("Ashby dotted identifiers work and cannot escape the supported host", () => {
  assert.equal(
    sourceURL({
      kind: "ashby",
      board: "flagright.com",
    }),
    "https://api.ashbyhq.com/posting-api/job-board/flagright.com?includeCompensation=true",
  );
  for (const board of [
    "../admin",
    "..",
    undefined,
    "https://evil.test",
    "abc?x=1",
    "x/y",
  ])
    assert.throws(() =>
      sourceURL({
        kind: "ashby",
        board,
      }),
    );
});
test(
  "a watched board collects Product and Founder’s Office with the same pass",
  fixture(async (s) => {
    await ensureWatchlist(s);
    await s.run("UPDATE sources SET enabled=0");
    await s.run("UPDATE sources SET enabled=1 WHERE company='Flagright'");
    const mock = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          jobs: [
            {
              id: "p",
              title: "Product Management Intern",
              location: "Remote India",
              descriptionPlain:
                "Product discovery, user research, product roadmap.",
              jobUrl: "https://jobs.ashbyhq.com/flagright.com/p",
              employmentType: "Internship",
            },
            {
              id: "f",
              title: "Founder’s Office Intern",
              location: "Remote India",
              descriptionPlain:
                "Support founder with business operations and financial modelling.",
              jobUrl: "https://jobs.ashbyhq.com/flagright.com/f",
              employmentType: "Internship",
            },
          ],
        }),
    });
    await discover(s, mock);
    assert.equal((await s.jobs()).length, 2);
    assert((await s.jobs()).some((j) => j.assessment.track === "Product"));
    assert(
      (await s.jobs()).some((j) => j.assessment.track === "Founder’s Office"),
    );
    assert((await s.jobs()).every((j) => j.industry.startsWith("Fintech")));
  }),
);
