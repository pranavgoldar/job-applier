import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { readEmployerFeed } from "../src/employer-feeds.mjs";
import { discover, sourceURL } from "../src/connectors.mjs";
import { assess } from "../src/matching.mjs";
import { catalog } from "../src/watchlist.mjs";

const board = { kind: "teamtailor", board: "fixture.teamtailor.com" };
const rss = (items, extra = "") =>
  '<rss xmlns:tt="urn:teamtailor"><channel><title>Open jobs</title>' +
  extra +
  items +
  "</channel></rss>";
const item = (id, title = "Product Analyst") =>
  "<item><guid>" +
  id +
  "</guid><title>" +
  title +
  "</title><link>https://example.test/jobs/" +
  id +
  "</link><tt:locations><tt:location><tt:city>Bengaluru</tt:city><tt:country>India</tt:country></tt:location></tt:locations><remoteStatus>fully</remoteStatus></item>";
const policy = "User-agent: *\nAllow: /";
const read = (xml) => async (url) =>
  url.endsWith("/robots.txt") ? policy : xml;

test("Recruitee and Personio preserve requirements, locations and employment type", async () => {
  const xml =
    "<jobs><job><reference>24</reference><title>Product Management Intern</title><url>https://example.test/jobs/24</url><remote>true</remote><locations><location><city>Bengaluru</city><country>IN</country></location></locations><contract_type>internship</contract_type><description_requirements><![CDATA[Work on product discovery.]]></description_requirements></job></jobs>";
  const [r] = await readEmployerFeed(
    { kind: "recruitee", board: "fixture" },
    read(xml),
  );
  assert.equal(r.employmentType, "internship");
  assert.equal(assess(r).unsuitable, null);
  assert.match(r.location, /Bengaluru; India; Remote/);
  assert.match(r.description, /discovery/);
  const source = { kind: "personio", board: "fixture.jobs.personio.de" };
  assert.equal(sourceURL(source), "https://fixture.jobs.personio.de/xml");
  const [p] = await readEmployerFeed(
    source,
    read(
      "<workzag-jobs><position><id>24</id><name>Product Analyst</name><office>Singapore</office><additionalOffices><office>Bangalore</office></additionalOffices><jobDescriptions><jobDescription><value><p>Requires <strong>5+ years</strong> of product management.</p></value></jobDescription></jobDescriptions><employmentType>permanent</employmentType><schedule>full-time</schedule></position></workzag-jobs>",
    ),
  );
  assert.equal(p.originalUrl, "https://fixture.jobs.personio.de/job/24");
  assert.match(p.location, /Singapore.*Bangalore/);
  assert.equal(p.employmentType, "full-time");
  assert.match(assess(p).unsuitable, /experience/i);
});

test("only a complete Teamtailor scan may close an existing posting", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "employer-feed-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await store.run(
    "INSERT INTO sources(id,kind,company,board) VALUES ('board','teamtailor','Fixture','fixture.teamtailor.com')",
  );
  const fullPage = rss(
    Array.from({ length: 100 }, (_, i) =>
      item(i, "Senior Software Engineer"),
    ).join(""),
  );
  let lastPage = rss(item(101));
  const offsets = [];
  const fetcher = async (url, opts) => {
    assert.match(opts.headers["User-Agent"], /CareerDesk/);
    if (url.endsWith("/robots.txt")) return new Response(policy);
    const offset = new URL(url).searchParams.get("offset");
    offsets.push(offset);
    if (!offset) return new Response(fullPage);
    if (lastPage === null) return new Response("", { status: 429 });
    return new Response(lastPage);
  };
  await discover(store, fetcher);
  assert.deepEqual(offsets, [null, "100"]);
  const [job] = await store.jobs();
  assert.equal(job.sourceId, "101");
  assert.equal(job.isRemote, true);
  for (const broken of [null, "<rss><channel>", fullPage, rss("<item/>")]) {
    lastPage = broken;
    await discover(store, fetcher);
    assert.equal(
      (await store.get("SELECT health FROM sources WHERE id='board'")).health,
      "Error",
    );
    assert.ok(!(await store.jobs())[0].closed);
  }
  lastPage = rss("");
  await discover(store, fetcher);
  assert.equal((await store.jobs())[0].closed, true);
});

test("feed continuations stay on the board and blocked feeds remain unread", async () => {
  const calls = [];
  const rows = await readEmployerFeed(board, async (url) => {
    calls.push(url);
    if (url.endsWith("/robots.txt")) return policy;
    if (url.includes("page=2&")) return rss(item(2));
    return rss(item(1), '<link rel="next" href="?page=2&amp;size=10"/>');
  });
  assert.equal(rows.length, 2);
  assert.equal(calls.length, 3);
  await assert.rejects(
    readEmployerFeed(
      board,
      read(
        rss(
          item(1),
          '<link rel="next" href="https://elsewhere.test/jobs.rss"/>',
        ),
      ),
    ),
    /continuation/,
  );
  let requests = 0;
  await assert.rejects(
    readEmployerFeed(board, async () => {
      requests++;
      return "User-agent: *\nDisallow: /jobs";
    }),
    /disallows/,
  );
  assert.equal(requests, 1);
  for (const kind of ["personio", "recruitee", "teamtailor"])
    assert.throws(() => sourceURL({ kind, board: "elsewhere.test" }));
});
test("new watchlist records link a dated target-city vacancy to an official board", () => {
  const additions = catalog.filter((c) => c.hiringEvidence);
  assert.ok(additions.length >= 29);
  for (const c of additions) {
    assert.ok(c.hiringEvidence.title);
    assert.ok(
      ["Bangalore", "Mumbai", "Singapore", "Dubai"].includes(
        c.hiringEvidence.city,
      ),
    );
    assert.equal(new URL(c.hiringEvidence.url).protocol, "https:");
    assert.equal(new URL(c.careersUrl).protocol, "https:");
    assert.match(c.checkedOn, /^\d{4}-\d\d-\d\d$/);
    assert.match(c.industry, /^(Fintech|Consumer) \//);
    if (c.connector) assert.ok(sourceURL(c.connector));
  }
});

test("Recruitee's public offers export preserves nested duties and employment codes", async () => {
  const [row] = await readEmployerFeed(
    { kind: "recruitee", board: "fixture" },
    read(
      "<offers><offer><id>24</id><title>Product Manager</title><careers_url>https://example.test/o/24</careers_url><description><p>Own the roadmap.</p></description><requirements><ul><li>5+ years of product management</li></ul></requirements><employment_type_code>full_time</employment_type_code><experience_code>entry_level</experience_code><city>Mumbai</city><country_code>IN</country_code></offer></offers>",
    ),
  );
  assert.equal(row.employmentType, "full time");
  assert.equal(row.experienceLevel, "entry level");
  assert.match(row.description, /Own the roadmap/);
  assert.match(assess(row).unsuitable, /experience/i);
});
