import { uuid, now } from "./ids.mjs";
import { assess, geo, initialProfile, isTargetRole } from "./matching.mjs";
export const docs = {
  greenhouse: "https://docs.greenhouse.io/job-board.html",
  lever: "https://github.com/lever/postings-api",
  ashby: "https://developers.ashbyhq.com/docs/public-job-posting-api",
  smartrecruiters: "https://developers.smartrecruiters.com/docs/posting-api",
  workable: "https://workable.readme.io/reference/jobs",
};
export const kinds = Object.keys(docs);
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
  switch (source.kind) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`;
    case "lever":
      return `https://api.lever.co/v0/postings/${b}?mode=json&limit=100&skip=0`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${b}/postings?limit=100&offset=0`;
    case "workable":
      return `https://apply.workable.com/api/v1/widget/accounts/${b}?details=true`;
    default:
      throw new Error("Unsupported source");
  }
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
const joined = (...parts) =>
  [...new Set(parts.flat().map((x) => String(x || "").trim()))]
    .filter(Boolean)
    .join("; ");
const base = (source) => ({
  company: source.company,
  source: source.kind,
  active: "Published on source board; submission availability unverified",
  activeEvidence: "Returned by structured public postings endpoint",
  industry: source.industry || "Unknown",
});
function normalizeSmartRecruiters(source, body) {
  if (!Array.isArray(body?.content))
    throw new Error("Unexpected source schema; jobs were not changed");
  return body.content.map((j) => {
    const l = j.location || {},
      url = `https://jobs.smartrecruiters.com/${encodeURIComponent(j.company?.identifier || source.board)}/${encodeURIComponent(j.id)}`;
    return {
      ...base(source),
      title: j.name,
      location:
        joined(
          l.fullLocation || [l.city, l.region, l.country],
          l.remote ? "Remote" : "",
        ) || "Unknown",
      description: plain(
        [
          j.department?.label,
          j.function?.label,
          j.experienceLevel?.label && "Level: " + j.experienceLevel.label,
          j.typeOfEmployment?.label,
        ]
          .filter(Boolean)
          .join(". "),
      ),
      descriptionPartial: true,
      employmentType:
        j.experienceLevel?.id === "internship"
          ? "Internship"
          : j.typeOfEmployment?.label || "Unknown",
      experienceLevel: j.experienceLevel?.label || null,
      isRemote: l.remote === true,
      originalUrl: url,
      applyUrl: url,
      sourceId: String(j.id),
      postedAt: j.releasedDate || null,
      compensation: null,
    };
  });
}
function normalizeWorkable(source, body) {
  if (!Array.isArray(body?.jobs))
    throw new Error("Unexpected source schema; jobs were not changed");
  return body.jobs.map((j) => ({
    ...base(source),
    title: j.title,
    location:
      joined(
        (j.locations?.length ? j.locations : [j]).map((l) =>
          [l.city, l.country].filter(Boolean).join(", "),
        ),
        j.telecommuting ? "Remote" : "",
      ) || "Unknown",
    description: plain(j.description || ""),
    employmentType: j.employment_type || "Unknown",
    experienceLevel: j.experience || null,
    isRemote: j.telecommuting === true,
    originalUrl: j.url || j.shortlink,
    applyUrl: j.application_url || j.url || null,
    sourceId: String(j.shortcode || j.url),
    postedAt: j.published_on ? new Date(j.published_on).toISOString() : null,
    compensation: null,
  }));
}
export function normalize(source, body) {
  if (source.kind === "smartrecruiters")
    return normalizeSmartRecruiters(source, body).filter(
      (j) => j.title && j.originalUrl,
    );
  if (source.kind === "workable")
    return normalizeWorkable(source, body).filter(
      (j) => j.title && j.originalUrl,
    );
  const rows = source.kind === "lever" ? body : body.jobs;
  if (!Array.isArray(rows))
    throw new Error("Unexpected source schema; jobs were not changed");
  return rows
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      ...base(source),
      title: j.title || j.text,
      location:
        joined(
          j.location?.name || j.location || j.categories?.location,
          j.categories?.allLocations || [],
          (j.secondaryLocations || []).map((l) => l.location),
          j.address?.postalAddress?.addressCountry,
        ) || "Unknown",
      description: plain(
        [
          j.descriptionPlain || j.content || j.description || "",
          ...(j.lists || []).map((l) => l.text + " " + l.content),
          j.additionalPlain || "",
        ].join(" "),
      ),
      employmentType:
        {
          FullTime: "Full-time",
          PartTime: "Part-time",
          Intern: "Internship",
        }[j.employmentType] ||
        j.employmentType ||
        j.categories?.commitment ||
        "Unknown",
      isRemote:
        j.isRemote === true ||
        String(j.workplaceType || "").toLowerCase() === "remote",
      originalUrl: j.absolute_url || j.hostedUrl || j.jobUrl,
      applyUrl: j.applyUrl || j.absolute_url || null,
      sourceId: String(j.id || j.jobUrl),
      postedAt:
        j.publishedAt ||
        j.first_published ||
        j.updated_at ||
        (j.createdAt && new Date(j.createdAt).toISOString()) ||
        null,
      compensation: j.compensation || j.salaryRange || null,
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
export { isTargetRole };
export function isTargetLocation(job) {
  return geo(job).region !== null;
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
      } else if (s.kind === "smartrecruiters") {
        // Ask the board only for the three target countries instead of every posting.
        for (const country of ["in", "ae", "sg"])
          for (let offset = 0; offset < 1000; offset += 100) {
            const body = await fetchJSON(
              sourceURL(s).replace("offset=0", `offset=${offset}`) +
                "&country=" +
                country,
              fetcher,
              { deadline },
            );
            jobs.push(...normalize(s, body));
            if (!(offset + 100 < Number(body.totalFound))) break;
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
          isTargetLocation(job) &&
          !assess(job, profile).blocked.some((x) =>
            /Experience requirement|Seniority|mid-senior|restriction excludes India/.test(
              x,
            ),
          ),
      );
      const kept = new Set(await upsertJobs(store, relevant, profile));
      // The board answered in full, so anything it no longer lists has closed.
      // Untouched matches are removed; ones you saved or applied to are kept and marked.
      let closed = 0;
      for (const row of await store.all(
        "SELECT id,data FROM jobs WHERE source=?",
        s.kind,
      )) {
        if (kept.has(row.id)) continue;
        const data = JSON.parse(row.data);
        if (data.company !== s.company || data.closed) continue;
        const used =
          ["Saved", "Shortlisted"].includes(data.collection) ||
          (await store.get(
            "SELECT id FROM applications WHERE job_id=?",
            row.id,
          ));
        if (used)
          await store.run(
            "UPDATE jobs SET data=? WHERE id=?",
            JSON.stringify({
              ...data,
              closed: true,
              active: "No longer listed on the source board",
            }),
            row.id,
          );
        else await store.run("DELETE FROM jobs WHERE id=?", row.id);
        closed++;
      }
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
        `${s.company}: scanned ${jobs.length} postings, kept ${matches} matching roles${closed ? `, cleared ${closed} no longer listed` : ""}.`,
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
