import {
  employerFeedDocs,
  employerFeedURL,
  parseEmployerPage,
  readEmployerFeed,
} from "./employer-feeds.mjs";
import {
  ycProps,
  readYC,
  hiringCompanies,
  canScanSource,
} from "./yc-discovery.mjs";
import { uuid, now } from "./ids.mjs";
import {
  assess,
  geo,
  isTargetLocation,
  initialProfile,
  isTargetRole,
  blockedTitle,
} from "./matching.mjs";
export const docs = {
  ...employerFeedDocs,
  greenhouse: "https://docs.greenhouse.io/job-board.html",
  lever: "https://github.com/lever/postings-api",
  ashby: "https://developers.ashbyhq.com/docs/public-job-posting-api",
  smartrecruiters: "https://developers.smartrecruiters.com/docs/posting-api",
  workable: "https://workable.readme.io/reference/jobs",
  pinpoint: "https://developers.pinpointhq.com/docs/job-postings",
  // The public job list behind the employer's own BambooHR careers page.
  bamboohr: "https://www.bamboohr.com/applicant-tracking/careers-page",
  // The public job board behind the employer's own Rippling careers page.
  rippling: "https://www.rippling.com/recruiting",
  // The employer's public careers page hosted by Kula (robots.txt allows it).
  kula: "https://www.kula.ai",
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
  if (Object.hasOwn(employerFeedDocs, source.kind))
    return employerFeedURL(source);
  const validBoard =
    source.kind === "ashby" || source.kind === "lever"
      ? /^[a-zA-Z0-9_.-]{1,100}$/
      : source.kind === "pinpoint" ||
          source.kind === "ycombinator" ||
          source.kind === "bamboohr" ||
          source.kind === "rippling" ||
          source.kind === "kula"
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
    case "bamboohr":
      return `https://${b}.bamboohr.com/careers/list`;
    case "kula":
      return `https://careers.kula.ai/${b}`;
    case "rippling":
      return `https://ats.rippling.com/api/v2/board/${b}/jobs?page=0`;
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
      locationCountry: l.country || null,
      locationCity: l.city || null,
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
      workplaceType: j.workplace_type,
      originalUrl: j.url,
      // The posting page only links to the form; open the form itself.
      applyUrl: j.url ? j.url.replace(/\/?$/, "/applications/new") : null,
      sourceId: String(j.id),
      postedAt: null,
      compensation: null,
    };
  });
}
// A YC company page carries its data, including open roles, as JSON in the HTML.
export function ycPage(htmlText) {
  const props = ycProps(htmlText);
  if (!props?.company)
    throw new Error("Unexpected source schema; jobs were not changed");
  return props;
}
function normalizeYC(source, props) {
  if (!props?.company || !Array.isArray(props.jobPostings))
    throw new Error("YC company job list incomplete");
  return props.jobPostings.map((j) => {
    if (
      !j.id ||
      !j.title ||
      !/^\/companies\/[a-z0-9-]+\/jobs\/[^/?#]+/.test(j.url || "")
    )
      throw new Error("Incomplete YC job posting");
    const parts = String(j.location || "Unknown").split(" / ");
    const first = parts[0];
    // YC repeats city/state abbreviations in long form. Keep distinct places
    // and every remote restriction instead of dropping everything after city one.
    const locations = parts.filter(
      (part, i) =>
        !i ||
        !(
          part.split(",").length >= 3 &&
          part.split(",")[0] === first.split(",")[0] &&
          part.split(",").at(-1) === first.split(",").at(-1)
        ),
    );
    const titleRemoteIndia =
      /India\s*\/\s*Remote|Remote\s*[-–/,(]\s*India/i.test(j.title);
    const remoteList = String(j.location || "").match(
      /Remote\s*\(([^)]+)\)/i,
    )?.[1];
    const remoteCountries = remoteList?.split(",").map((c) => c.trim());
    if (
      titleRemoteIndia &&
      !remoteCountries &&
      !locations.some((l) => /remote.*india|india.*remote/i.test(l))
    )
      locations.push("Remote – India");
    const exp = /^Any(?:\s*\(new grads ok\))?$/i.test(j.minExperience || "")
      ? "No experience required"
      : j.minExperience;
    return {
      ...base(source),
      company: props.company.name || source.company,
      title: j.title,
      location: locations.join(" / "),
      description: plain(
        [
          j.prettyRole && "Role: " + j.prettyRole + ".",
          exp && "Minimum experience: " + exp + ".",
          j.salaryRange && "Salary: " + j.salaryRange + ".",
          props.company.one_liner,
        ]
          .filter(Boolean)
          .join(" "),
      ),
      descriptionPartial: true,
      employmentType: j.type || "Unknown",
      isRemote: /remote/i.test(locations.join(" ")),
      ...(remoteCountries ? { remoteCountries } : {}),
      originalUrl: "https://www.ycombinator.com" + j.url,
      applyUrl: null,
      sourceId: String(j.id),
      postedAt: null,
      compensation: j.salaryRange || null,
      activeEvidence: "Listed on the company’s Y Combinator page",
    };
  });
}
const xmlText = (s = "") =>
  s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
function normalizeBamboo(source, body) {
  if (!Array.isArray(body?.result))
    throw new Error("Unexpected source schema; jobs were not changed");
  return body.result.map((j) => {
    const l = j.location || {},
      a = j.atsLocation || {},
      remote = j.isRemote === true || String(j.locationType) === "1",
      url = `https://${source.board}.bamboohr.com/careers/${encodeURIComponent(j.id)}`;
    return {
      ...base(source),
      title: j.jobOpeningName,
      location:
        joined(
          l.city || a.city,
          l.state || a.state,
          a.country,
          remote ? "Remote" : "",
        ) || "Unknown",
      description: "",
      descriptionPartial: true,
      employmentType: j.employmentStatusLabel || "Unknown",
      isRemote: remote,
      originalUrl: url,
      applyUrl: url,
      sourceId: String(j.id),
      postedAt: null,
      compensation: null,
    };
  });
}
function normalizeRippling(source, body) {
  if (!Array.isArray(body?.items))
    throw new Error("Unexpected source schema; jobs were not changed");
  return body.items.map((j) => {
    const places = (j.locations || []).map((l) =>
        l.workplaceType === "REMOTE"
          ? joined("Remote", l.country)
          : l.name || joined(l.city, l.country),
      ),
      remote = (j.locations || []).some((l) => l.workplaceType === "REMOTE");
    return {
      ...base(source),
      title: j.name,
      location: joined(places) || "Unknown",
      // The public board lists titles and places; the write-up is on the job page.
      description: j.department?.name ? "Department: " + j.department.name : "",
      descriptionPartial: true,
      employmentType: "Unknown",
      isRemote: remote,
      originalUrl: j.url,
      applyUrl: j.url ? j.url.replace(/\/?$/, "/apply") : null,
      sourceId: String(j.id),
      postedAt: null,
      compensation: null,
    };
  });
}
// Kula careers pages list each opening as a card: team, title, place, type, link.
function normalizeKula(source, page) {
  const html = String(page);
  if (!/careers\.kula\.ai|chakra-card/.test(html))
    throw new Error("Unexpected source schema; jobs were not changed");
  // Each piece starts inside the card's opening tag: drop the rest of that tag.
  const cards = html
    .split(/<div class="chakra-card\b/)
    .slice(1)
    .map((c) => c.slice(c.indexOf(">") + 1));
  return cards
    .map((card) => {
      const href = (card.match(
        new RegExp(`href="(/${source.board}/[^"#?]+)"`),
      ) || [])[1];
      const parts = xmlText(
        card
          .replace(/<svg[\s\S]*?<\/svg>/g, " ")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<[^>]+>/g, "\n"),
      )
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x && !/^apply now$/i.test(x));
      // [team, title, place, "Full time • On-Site"]
      const [team, title, place, kind = ""] = parts;
      if (!href || !title) return null;
      const url = "https://careers.kula.ai" + href;
      return {
        ...base(source),
        title,
        location: joined(place, /remote/i.test(kind) ? "Remote" : ""),
        description: team ? "Team: " + team : "",
        descriptionPartial: true,
        employmentType: kind.split("•")[0].trim() || "Unknown",
        isRemote: /remote/i.test(kind),
        originalUrl: url,
        applyUrl: url,
        sourceId: href.split("/").pop().split("-")[0] || href,
        postedAt: null,
        compensation: null,
      };
    })
    .filter(Boolean);
}
function employerJob(source, row) {
  return {
    ...base(source),
    employmentType: "Unknown",
    compensation: null,
    ...row,
    description: plain(row.description).slice(0, 12000),
  };
}
export function normalize(source, body) {
  if (source.kind === "kula") return normalizeKula(source, body);
  if (Object.hasOwn(employerFeedDocs, source.kind))
    return parseEmployerPage(source, body).jobs.map((row) =>
      employerJob(source, row),
    );
  if (source.kind === "bamboohr")
    return normalizeBamboo(source, body).filter((j) => j.title);
  if (source.kind === "rippling")
    return normalizeRippling(source, body).filter(
      (j) => j.title && j.originalUrl,
    );
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
      startDate: j.startDate || null,
      workplaceType: j.workplaceType,
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
      assessment = assess(job, profile),
      data = {
        ...job,
        // What the person did with this job survives every re-scan.
        ...(previous.collection ? { collection: previous.collection } : {}),
        ...(previous.applyOpened ? { applyOpened: previous.applyOpened } : {}),
        ...(previous.closed || (previous.unsuitable && !assessment.unsuitable)
          ? { reopenedAt: now() }
          : previous.reopenedAt
            ? { reopenedAt: previous.reopenedAt }
            : {}),
        assessment,
        ...(assessment.unsuitable
          ? {
              unsuitable: assessment.unsuitable,
              unsuitableSince: previous.unsuitableSince || now(),
            }
          : {}),
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
export { isTargetRole, isTargetLocation };
export async function fetchJSON(
  url,
  fetcher = fetch,
  { deadline = Infinity, headers = {}, text = false, attempts = 3 } = {},
) {
  let error;
  for (let n = 0; n < attempts; n++) {
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
        const e = Object.assign(new Error(`HTTP ${r.status}`), {
          status: r.status,
        });
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
      if (n + 1 < attempts)
        await new Promise((r) => setTimeout(r, 500 * 2 ** n));
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
    if (blockedTitle(job)) continue;
    const place = geo(job);
    if (!place.region && !place.remote) continue;
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
// The BambooHR list has titles and places only. Read the posting itself for
// jobs that could fit, reusing descriptions stored by earlier scans.
export async function addBambooDetails(
  store,
  source,
  jobs,
  fetcher = fetch,
  deadline = Infinity,
  limit = 25,
) {
  const stored = new Map(
    (
      await store.all("SELECT source_id,data FROM jobs WHERE source='bamboohr'")
    ).map((r) => [r.source_id, JSON.parse(r.data)]),
  );
  let fetched = 0;
  for (const job of jobs) {
    if (blockedTitle(job)) continue;
    const old = stored.get(job.sourceId);
    if (old && !old.descriptionPartial && old.description) {
      Object.assign(job, {
        description: old.description,
        descriptionPartial: false,
        postedAt: old.postedAt,
      });
      continue;
    }
    if (fetched >= limit) continue;
    fetched++;
    try {
      const d =
        (
          await fetchJSON(
            `https://${source.board}.bamboohr.com/careers/${encodeURIComponent(job.sourceId)}/detail`,
            fetcher,
            { deadline },
          )
        )?.result?.jobOpening || {};
      if (d.description) {
        job.description = plain(d.description).slice(0, 12000);
        job.descriptionPartial = false;
      }
      if (d.location?.addressCountry)
        job.location = joined(job.location, d.location.addressCountry);
      if (d.datePosted) job.postedAt = new Date(d.datePosted).toISOString();
    } catch {
      // Keep the list entry as it is.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return fetched;
}
export async function discover(
  store,
  fetcher = fetch,
  { sourceIds = null, deadline = Infinity, queueNewSources = false } = {},
) {
  const sources = (
    await store.all("SELECT * FROM sources WHERE enabled=1")
  ).filter((s) => canScanSource(s) && (!sourceIds || sourceIds.includes(s.id)));
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
      if (s.kind === "yc-directory") {
        const companies = await hiringCompanies(
          store,
          s.board,
          fetcher,
          deadline,
        );
        const existing = new Set(
          (
            await store.all(
              "SELECT board FROM sources WHERE kind='ycombinator'",
            )
          ).map((row) => row.board),
        );
        for (const [board, company] of companies) {
          if (existing.has(board)) continue;
          if (Date.now() + 1000 >= deadline)
            throw Object.assign(
              new Error("Directory waiting for the next scan window"),
              { deferred: true },
            );
          const id = "yc-company-" + board;
          const added = await store.transaction(async (tx) => {
            const row = await tx.get(
              "INSERT OR IGNORE INTO sources(id,kind,company,board) SELECT ?,'ycombinator',?,? WHERE NOT EXISTS(SELECT 1 FROM sources WHERE kind='ycombinator' AND board=?) RETURNING *",
              id,
              company,
              board,
              board,
            );
            if (row && queueNewSources)
              await tx.enqueue("discovery-source", { sourceId: id });
            return row;
          });
          if (added && !queueNewSources) sources.push(added);
        }
        await store.run(
          "UPDATE sources SET health='Healthy',last_run=?,error=NULL,count=0 WHERE id=?",
          now(),
          s.id,
        );
        await store.event(
          null,
          "discovery",
          s.company +
            ": checked directory, " +
            companies.size +
            " company boards listed.",
        );
        continue;
      }
      if (Object.hasOwn(employerFeedDocs, s.kind)) {
        const rows = await readEmployerFeed(
          s,
          (url, accept) =>
            fetchJSON(url, fetcher, {
              deadline,
              text: true,
              attempts: 1,
              headers: { Accept: accept },
            }),
          deadline,
        );
        jobs = rows.map((row) => employerJob(s, row));
      } else if (s.kind === "lever") {
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
          await readYC(store, sourceURL(s), fetcher, deadline),
        );
      } else if (s.kind === "kula") {
        jobs = normalize(
          s,
          await fetchJSON(sourceURL(s), fetcher, { deadline, text: true }),
        );
      } else if (s.kind === "bamboohr") {
        const body = await fetchJSON(sourceURL(s), fetcher, { deadline });
        jobs = normalize(s, body);
        if (Number(body?.meta?.totalCount) > jobs.length) complete = false;
        await addBambooDetails(store, s, jobs, fetcher, deadline);
      } else if (s.kind === "rippling") {
        for (let page = 0; page < 20; page++) {
          const body = await fetchJSON(
            sourceURL(s).replace("page=0", "page=" + page),
            fetcher,
            { deadline },
          );
          jobs.push(...normalize(s, body));
          if (page + 1 >= Number(body.totalPages || 1)) break;
          if (page === 19) complete = false;
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
      const assessments = new Map(
        jobs.map((job) => [job, assess(job, profile)]),
      );
      const relevant = jobs.filter((job) => !assessments.get(job).unsuitable);
      const retained = jobs.filter((job) => {
        const a = assessments.get(job);
        return !a.unsuitable || a.historyOnly;
      });
      const kept = new Set(await upsertJobs(store, retained, profile));
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
          const assessment = assessments.get(posting);
          const reason = assessment.unsuitable;
          next = {
            ...data,
            ...posting,
            assessment,
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
      if (e.deferred && queueNewSources) throw e;
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
      if (queueNewSources) {
        await store.set("lastDiscovery", now());
        throw e;
      }
    }
  }
  await store.set("lastDiscovery", now());
  return count;
}
