import { uuid, now } from "./ids.mjs";
import {
  assess,
  geo,
  initialProfile,
  isTargetRole,
  blockedTitle,
} from "./matching.mjs";
export const docs = {
  greenhouse: "https://docs.greenhouse.io/job-board.html",
  lever: "https://github.com/lever/postings-api",
  ashby: "https://developers.ashbyhq.com/docs/public-job-posting-api",
  smartrecruiters: "https://developers.smartrecruiters.com/docs/posting-api",
  workable: "https://workable.readme.io/reference/jobs",
  pinpoint: "https://developers.pinpointhq.com/docs/job-postings",
  ycombinator: "https://www.ycombinator.com/companies",
};
// Company boards a user can add by name.
export const kinds = Object.keys(docs);
// Multi-company feeds: one source returns postings from many employers.
export const feeds = ["himalayas"];
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
      : source.kind === "pinpoint" || source.kind === "ycombinator"
        ? /^[a-z0-9-]{1,80}$/
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
    case "pinpoint":
      return `https://${b}.pinpointhq.com/postings.json`;
    case "ycombinator":
      return `https://www.ycombinator.com/companies/${b}`;
    case "himalayas":
      // Remote roles open to people based in India, searched by keyword.
      return `https://himalayas.app/jobs/api/search?q=${b}&country=IN&limit=20&page=1`;
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
// Where a remote role may be done from, as the feed states it.
export function remoteLocation(countries = []) {
  const list = [...new Set(countries.map((c) => String(c).trim()))].filter(
    Boolean,
  );
  if (!list.length) return "Remote · Worldwide";
  // Lead with India when it is genuinely on the list; never add it otherwise.
  const india = list.includes("India"),
    shown = [...(india ? ["India"] : []), ...list.filter((c) => c !== "India")],
    head = shown.slice(0, 3).join(", "),
    more = shown.length - 3;
  return `Remote · ${head}${more > 0 ? ` + ${more} more countries` : ""}`;
}
function normalizeHimalayas(source, body) {
  if (!Array.isArray(body?.jobs))
    throw new Error("Unexpected source schema; jobs were not changed");
  return body.jobs.map((j) => {
    const countries = (j.locationRestrictions || []).map(String);
    return {
      ...base(source),
      company: j.companyName,
      title: j.title,
      location: remoteLocation(countries),
      remoteCountries: countries,
      indiaEligible: !countries.length || countries.includes("India"),
      description: plain(j.description || j.excerpt || "").slice(0, 8000),
      employmentType:
        j.employmentType === "Intern"
          ? "Internship"
          : j.employmentType || "Unknown",
      experienceLevel: (j.seniority || []).join(", ") || null,
      isRemote: true,
      originalUrl: j.applicationLink || j.guid,
      applyUrl: j.applicationLink || null,
      sourceId: String(j.guid || j.applicationLink),
      postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
      compensation: null,
      activeEvidence: "Listed on the Himalayas remote jobs feed",
    };
  });
}
function normalizePinpoint(source, body) {
  if (!Array.isArray(body?.data))
    throw new Error("Unexpected source schema; jobs were not changed");
  return body.data.map((j) => {
    const l = j.location || {},
      remote = j.workplace_type === "remote";
    return {
      ...base(source),
      title: j.title,
      location: joined([l.city, l.name], remote ? "Remote" : "") || "Unknown",
      description: plain(
        [j.description, j.key_responsibilities, j.skills_knowledge_expertise]
          .filter(Boolean)
          .join(" "),
      ).slice(0, 12000),
      employmentType: j.employment_type_text || "Unknown",
      isRemote: remote,
      originalUrl: j.url,
      applyUrl: j.url || null,
      sourceId: String(j.id),
      postedAt: null,
      compensation: null,
    };
  });
}
// A YC company page carries its data, including open roles, as JSON in the HTML.
export function ycPage(htmlText) {
  const m = String(htmlText).match(/data-page="([^"]+)"/);
  if (!m) throw new Error("Unexpected source schema; jobs were not changed");
  const props = JSON.parse(plainEntities(m[1])).props || {};
  if (!props.company)
    throw new Error("Unexpected source schema; jobs were not changed");
  return props;
}
const plainEntities = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function normalizeYC(source, props) {
  return (props.jobPostings || []).map((j) => ({
    ...base(source),
    title: j.title,
    location: String(j.location || "Unknown").split(" / ")[0],
    // The listing page gives facts, not the full write-up.
    description: plain(
      [
        j.prettyRole && "Role: " + j.prettyRole + ".",
        j.minExperience && "Minimum experience: " + j.minExperience + ".",
        j.salaryRange && "Salary: " + j.salaryRange + ".",
        props.company.one_liner,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    descriptionPartial: true,
    employmentType: j.type || "Unknown",
    isRemote: /remote/i.test(j.location || ""),
    originalUrl: "https://www.ycombinator.com" + j.url,
    applyUrl: null,
    sourceId: String(j.id),
    postedAt: null,
    compensation: j.salaryRange || null,
    activeEvidence: "Listed on the company’s Y Combinator page",
  }));
}
export function normalize(source, body) {
  if (source.kind === "pinpoint")
    return normalizePinpoint(source, body).filter(
      (j) => j.title && j.originalUrl,
    );
  if (source.kind === "ycombinator")
    return normalizeYC(
      source,
      typeof body === "string" ? ycPage(body) : body,
    ).filter((j) => j.title);
  if (source.kind === "himalayas")
    return normalizeHimalayas(source, body).filter(
      (j) => j.title && j.originalUrl && j.company,
    );
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
        // What the person did with this job survives every re-scan.
        ...(previous.collection ? { collection: previous.collection } : {}),
        ...(previous.applyOpened ? { applyOpened: previous.applyOpened } : {}),
        ...(previous.closed || previous.unsuitable
          ? { reopenedAt: now() }
          : previous.reopenedAt
            ? { reopenedAt: previous.reopenedAt }
            : {}),
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
  { deadline = Infinity, headers = {}, text = false } = {},
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
          Accept: text ? "text/html" : "application/json",
          "User-Agent": "CareerDesk/1.0 public-job-discovery",
          ...headers,
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
      const body = await r.text();
      if (body.length > 12_000_000)
        throw new Error("Source response too large");
      return text ? body : JSON.parse(body);
    } catch (e) {
      error = e;
      if (e.permanent || deadline - Date.now() < 1000) break;
      if (n < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** n));
    }
  }
  throw error;
}
// The SmartRecruiters list only carries a summary. Read the full description for
// postings that could plausibly fit, so they are judged on their real content.
// Descriptions already stored are reused; at most `limit` are fetched per scan.
export async function addSmartRecruitersDescriptions(
  store,
  source,
  jobs,
  fetcher = fetch,
  deadline = Infinity,
  limit = 40,
) {
  const stored = new Map(
    (
      await store.all(
        "SELECT source_id,data FROM jobs WHERE source='smartrecruiters'",
      )
    ).map((r) => [r.source_id, JSON.parse(r.data)]),
  );
  let fetched = 0;
  for (const job of jobs) {
    if (!isTargetLocation(job) || blockedTitle(job)) continue;
    const old = stored.get(job.sourceId);
    if (old && !old.descriptionPartial && old.description) {
      job.description = old.description;
      job.descriptionPartial = false;
      continue;
    }
    if (fetched >= limit) continue;
    fetched++;
    try {
      const detail = await fetchJSON(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.board)}/postings/${encodeURIComponent(job.sourceId)}`,
          fetcher,
          { deadline },
        ),
        sections = detail?.jobAd?.sections || {},
        text = plain(
          ["jobDescription", "qualifications", "additionalInformation"]
            .map((k) => sections[k]?.text || "")
            .join(" "),
        );
      if (text) {
        job.description = text.slice(0, 12000);
        job.descriptionPartial = false;
        if (detail.applyUrl) job.applyUrl = detail.applyUrl;
      }
    } catch {
      // Keep the summary; the job stays marked as partially described.
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return fetched;
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
      let jobs = [],
        // False when the board could not be read to the end, so absence of a
        // posting proves nothing.
        complete = true;
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
      } else if (s.kind === "himalayas") {
        // The feed allows few requests without a key. A free key (optional,
        // HIMALAYAS_API_KEY) raises the limit. If the limit is hit part-way,
        // keep the pages already read instead of failing the whole source.
        const headers = process.env.HIMALAYAS_API_KEY
          ? { Authorization: "Bearer " + process.env.HIMALAYAS_API_KEY }
          : {};
        for (let page = 1; page <= 10; page++) {
          let body;
          try {
            body = await fetchJSON(
              sourceURL(s).replace("page=1", "page=" + page),
              fetcher,
              { deadline, headers },
            );
          } catch (e) {
            if (!jobs.length) throw e;
            complete = false;
            break;
          }
          const rows = normalize(s, body);
          jobs.push(...rows);
          if (!(page * 20 < Number(body.totalCount)) || !body.jobs.length)
            break;
          if (page === 10) complete = false;
          await new Promise((r) => setTimeout(r, 1200));
        }
      } else if (s.kind === "ycombinator") {
        jobs = normalize(
          s,
          await fetchJSON(sourceURL(s), fetcher, { deadline, text: true }),
        );
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
            if (offset === 900) complete = false;
            await new Promise((r) => setTimeout(r, 250));
          }
      } else
        jobs = normalize(
          s,
          await fetchJSON(sourceURL(s), fetcher, { deadline }),
        );
      for (const job of jobs) job.sourceRef = s.id;
      if (s.kind === "smartrecruiters")
        await addSmartRecruitersDescriptions(store, s, jobs, fetcher, deadline);
      const unsuitable = (job) => {
        if (!isTargetRole(job))
          return "The role no longer matches your target roles.";
        if (!isTargetLocation(job))
          return "The location is now outside your target locations.";
        if (job.indiaEligible === false)
          return "This remote role is not open to people based in India.";
        return (
          assess(job, profile).blocked.find((x) =>
            /Experience requirement|Seniority|mid-senior|restriction excludes India/.test(
              x,
            ),
          ) || null
        );
      };
      const relevant = jobs.filter((job) => !unsuitable(job));
      const kept = new Set(await upsertJobs(store, relevant, profile));
      // Two separate questions for every job stored from this source:
      //   1. Is the posting still on the board?  (presence, from ALL postings)
      //   2. Does it still fit the search?       (suitability)
      // Nothing is deleted. A job is only called "no longer listed" when a
      // complete read of the board did not contain it.
      const listed = new Map();
      for (const job of jobs) {
        listed.set("id:" + job.sourceId, job);
        try {
          listed.set("url:" + canonical(job.originalUrl), job);
        } catch {}
      }
      const feed = feeds.includes(s.kind),
        updates = [];
      let closed = 0,
        dropped = 0;
      for (const row of await store.all(
        "SELECT id,canonical,source_id,data FROM jobs WHERE source=?",
        s.kind,
      )) {
        if (kept.has(row.id)) continue;
        const data = JSON.parse(row.data);
        if (
          data.sourceRef
            ? data.sourceRef !== s.id
            : !feed && data.company !== s.company
        )
          continue;
        const posting =
          listed.get("id:" + row.source_id) ||
          listed.get("url:" + row.canonical);
        let next = null;
        if (posting) {
          // Still advertised, but it has changed and no longer fits.
          const reason = unsuitable(posting);
          next = {
            ...data,
            ...posting,
            assessment: assess(posting, profile),
            unsuitable: reason,
            unsuitableSince: data.unsuitableSince || now(),
            closed: false,
            active: "Still listed on the source board",
          };
          delete next.closedAt;
          if (!data.unsuitable) dropped++;
        } else if (complete && !data.closed) {
          next = {
            ...data,
            closed: true,
            closedAt: now(),
            active: "No longer listed on the source board",
          };
          closed++;
        }
        if (next)
          updates.push({
            sql: "UPDATE jobs SET data=?,last_checked=? WHERE id=?",
            args: [JSON.stringify(next), now(), row.id],
          });
      }
      if (updates.length) await store.batch(updates);
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
        `${s.company}: read ${jobs.length} postings${complete ? "" : " (partial read)"}, ${matches} match${matches === 1 ? "" : "es"}${dropped ? `, ${dropped} still listed but no longer matching` : ""}${closed ? `, ${closed} no longer listed` : ""}.`,
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
