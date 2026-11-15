import { uuid, now } from "./ids.mjs";
import { assess, initialProfile } from "./matching.mjs";
export const docs = {
  greenhouse: "https://docs.greenhouse.io/job-board.html",
  lever: "https://github.com/lever/postings-api",
  ashby: "https://developers.ashbyhq.com/docs/public-job-posting-api",
};
export function canonical(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new Error("Use an http(s) job link");
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|ref$|source$)/.test(k)) u.searchParams.delete(k);
  return u.toString().replace(/\/$/, "");
}
export function sourceURL(source) {
  const validBoard =
    source.kind === "ashby"
      ? /^[a-zA-Z0-9_.-]{1,100}$/
      : /^[a-zA-Z0-9_-]{1,100}$/;
  if (
    typeof source.board !== "string" ||
    source.board.includes("..") ||
    !validBoard.test(source.board)
  )
    throw new Error("Invalid board identifier");
  const b = encodeURIComponent(source.board);
  return source.kind === "greenhouse"
    ? `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`
    : source.kind === "lever"
      ? `https://api.lever.co/v0/postings/${b}?mode=json&limit=100&skip=0`
      : source.kind === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`
        : (() => {
            throw new Error("Unsupported source");
          })();
}
export function plain(s = "") {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
export function normalize(source, body) {
  const rows = source.kind === "lever" ? body : body.jobs;
  if (!Array.isArray(rows))
    throw new Error("Unexpected source schema; jobs were not changed");
  return rows
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      company: source.company,
      title: j.title || j.text,
      location:
        j.location?.name || j.location || j.categories?.location || "Unknown",
      description: plain(
        j.descriptionPlain ||
          j.content ||
          (j.description || "") +
            " " +
            (j.lists || []).map((l) => l.text + " " + l.content).join(" "),
      ),
      employmentType: j.employmentType || j.categories?.commitment || "Unknown",
      isRemote: j.isRemote === true,
      originalUrl: j.absolute_url || j.hostedUrl || j.jobUrl,
      applyUrl: j.applyUrl || j.absolute_url || null,
      source: source.kind,
      sourceId: String(j.id || j.jobUrl),
      postedAt:
        j.publishedAt ||
        (j.createdAt && new Date(j.createdAt).toISOString()) ||
        null,
      compensation: j.compensation || j.salaryRange || null,
      active: "Published on source board; submission availability unverified",
      activeEvidence: "Returned by structured public postings endpoint",
      industry: source.industry || "Unknown",
    }))
    .filter((j) => j.title && j.originalUrl);
}
export async function upsertJobs(store, jobs, profile) {
  if (!jobs.length) return [];
  profile ||= await store.config("profile", initialProfile);
  const existing = await store.all("SELECT * FROM jobs"),
    byUrl = new Map(existing.map((r) => [r.canonical, r])),
    bySource = new Map(existing.map((r) => [r.source + "|" + r.source_id, r]));
  const statements = [],
    ids = [],
    seen = new Set();
  for (const job of jobs) {
    const key = canonical(job.originalUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    const old =
        byUrl.get(key) || bySource.get(job.source + "|" + (job.sourceId || "")),
      id = old?.id || uuid(),
      previous = old ? JSON.parse(old.data) : {},
      data = {
        ...job,
        ...(previous.collection ? { collection: previous.collection } : {}),
        assessment: assess(job, profile),
      };
    statements.push({
      sql: "INSERT INTO jobs VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,last_checked=excluded.last_checked ON CONFLICT(canonical) DO UPDATE SET data=excluded.data,last_checked=excluded.last_checked",
      args: [
        id,
        key,
        job.source || "manual",
        job.sourceId || null,
        JSON.stringify(data),
        old?.first_seen || now(),
        now(),
      ],
    });
    ids.push(id);
  }
  await store.batch(statements);
  return ids;
}
export async function upsertJob(store, job) {
  await upsertJobs(store, [job]);
  return (
    (
      await store.get(
        "SELECT id FROM jobs WHERE canonical=?",
        canonical(job.originalUrl),
      )
    )?.id ||
    (
      await store.get(
        "SELECT id FROM jobs WHERE source=? AND source_id=?",
        job.source,
        job.sourceId,
      )
    ).id
  );
}
export function isTargetRole(job) {
  return /(?:product.*(?:manager|management|owner|analyst|strateg)|\bapm\b|founder|business operations|strategy|strategic initiatives|chief of staff|special projects)/i.test(
    job.title || "",
  );
}
export async function fetchJSON(
  url,
  fetcher = fetch,
  { deadline = Infinity } = {},
) {
  let error;
  for (let n = 0; n < 3; n++) {
    try {
      const remaining = deadline - Date.now();
      if (remaining < 200)
        throw new Error(
          "Discovery time budget exhausted; source remains unverified",
        );
      const r = await fetcher(url, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.floor(Math.min(12000, remaining))),
        ),
        redirect: "error",
        headers: {
          Accept: "application/json",
          "User-Agent": "CareerDesk/1.0 public-job-discovery",
        },
      });
      if (!r.ok) {
        const e = new Error(`HTTP ${r.status}`);
        if (r.status < 500 && r.status !== 429) {
          e.permanent = true;
          throw e;
        }
        throw e;
      }
      const text = await r.text();
      if (text.length > 12_000_000)
        throw new Error("Source response too large");
      return JSON.parse(text);
    } catch (e) {
      error = e;
      if (e.permanent || deadline - Date.now() < 1000) break;
      if (n < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** n));
    }
  }
  throw error;
}
export async function discover(
  store,
  fetcher = fetch,
  { sourceIds = null, deadline = Infinity } = {},
) {
  const sources = (
    await store.all("SELECT * FROM sources WHERE enabled=1")
  ).filter((s) => !sourceIds || sourceIds.includes(s.id));
  const profile = await store.config("profile", initialProfile);
  let count = 0;
  const targets = await store.config("companyWatchlist", []);
  for (const rawSource of sources) {
    const target = targets.find((c) => c.sourceId === rawSource.id);
    const s = {
      ...rawSource,
      industry: target?.industry || "Unknown",
    };
    try {
      let jobs = [];
      if (s.kind === "lever") {
        for (let skip = 0; skip < 2000; skip += 100) {
          const body = await fetchJSON(
            sourceURL(s).replace("skip=0", `skip=${skip}`),
            fetcher,
            { deadline },
          );
          const page = normalize(s, body);
          jobs.push(...page);
          if (body.length < 100) break;
          if (skip === 1900)
            throw new Error("Pagination safety limit; board incomplete");
          await new Promise((r) => setTimeout(r, 250));
        }
      } else
        jobs = normalize(
          s,
          await fetchJSON(sourceURL(s), fetcher, { deadline }),
        );
      const relevant = jobs.filter(
        (job) =>
          isTargetRole(job) &&
          !assess(job, profile).blocked.some((x) =>
            /Experience requirement|Seniority/.test(x),
          ),
      );
      await upsertJobs(store, relevant, profile);
      const matches = relevant.length;
      await store.run(
        "UPDATE sources SET health=?,last_run=?,error=NULL,count=? WHERE id=?",
        "Healthy",
        now(),
        matches,
        s.id,
      );
      count += matches;
      await store.event(
        null,
        "discovery",
        `${s.company}: ${matches} potentially relevant postings checked. Missing jobs were not automatically marked closed.`,
      );
    } catch (e) {
      await store.run(
        "UPDATE sources SET health=?,last_run=?,error=? WHERE id=?",
        "Error",
        now(),
        String(e.message).slice(0, 200),
        s.id,
      );
      await store.event(
        null,
        "connector_error",
        `${s.company}: connector failed. Existing jobs remain unchanged.`,
      );
    }
  }
  await store.set("lastDiscovery", now());
  return count;
}
