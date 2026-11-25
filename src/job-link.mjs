// Add a job from the link to its page on the company's own job board.
//
// Many LinkedIn postings send you to the company's own board ("Apply on company
// website"). Those boards publish their jobs openly, so the app reads the
// details from there. The app never opens LinkedIn itself.
import {
  readSource,
  sourceURL,
  upsertJobs,
  addBambooDetails,
} from "./connectors.mjs";
import { assess, initialProfile } from "./matching.mjs";
import { catalog } from "./watchlist.mjs";
import { uuid, now } from "./ids.mjs";

export const linkBoards = [
  "Greenhouse",
  "Lever",
  "Ashby",
  "SmartRecruiters",
  "Workable",
  "Pinpoint",
  "BambooHR",
  "Rippling",
  "Kula",
  "Teamtailor",
  "Recruitee",
  "Personio",
];

const locale = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;
const lead = (x = "") => (String(x).match(/^\d+/) || [])[0] || "";

// Which board, company and posting a job link points to, or null when the link
// is not a posting on a board the app can read.
export function jobLink(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase(),
    seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent),
    q = u.searchParams;
  let link = null;
  if (/^(?:boards|job-boards)\.greenhouse\.io$/.test(host)) {
    if (seg[0] === "embed" && q.get("for"))
      link = { kind: "greenhouse", board: q.get("for"), id: q.get("token") };
    else if (seg[1] === "jobs")
      link = { kind: "greenhouse", board: seg[0], id: seg[2] };
  } else if (host === "jobs.lever.co" && seg.length >= 2)
    link = { kind: "lever", board: seg[0], id: seg[1] };
  else if (host === "jobs.ashbyhq.com" && seg.length >= 2)
    link = { kind: "ashby", board: seg[0], id: seg[1] };
  else if (host === "jobs.smartrecruiters.com" && seg.length >= 2)
    link = { kind: "smartrecruiters", board: seg[0], id: lead(seg[1]) };
  else if (host === "apply.workable.com" && seg[1] === "j")
    link = { kind: "workable", board: seg[0], id: seg[2] };
  else if (host.endsWith(".pinpointhq.com")) {
    const at = seg.indexOf("postings");
    if (at >= 0 && seg[at + 1])
      link = {
        kind: "pinpoint",
        board: host.split(".")[0],
        id: seg[at + 1],
      };
  } else if (host.endsWith(".bamboohr.com")) {
    const id = seg[0] === "careers" ? lead(seg[1]) : q.get("id");
    if (id) link = { kind: "bamboohr", board: host.split(".")[0], id };
  } else if (host === "ats.rippling.com") {
    const s =
      locale.test(seg[0] || "") && seg[2] === "jobs" ? seg.slice(1) : seg;
    if (s[1] === "jobs" && s[2])
      link = { kind: "rippling", board: s[0], id: s[2] };
  } else if (host.endsWith(".recruitee.com")) {
    if (seg[0] === "o" && seg[1])
      link = { kind: "recruitee", board: host.split(".")[0], id: seg[1] };
  } else if (/^[a-z0-9-]+\.jobs\.personio\.(?:com|de)$/.test(host)) {
    const at = seg.indexOf("job");
    if (at >= 0 && lead(seg[at + 1]))
      link = {
        kind: "personio",
        board: host.endsWith(".com") ? host.split(".")[0] : host,
        id: lead(seg[at + 1]),
      };
  } else if (host === "careers.kula.ai" && seg.length >= 2)
    link = { kind: "kula", board: seg[0], id: lead(seg[1]) || seg[1] };
  else {
    // Teamtailor careers sites, on teamtailor.com or the company's own domain.
    const at = seg.indexOf("jobs");
    if (at >= 0 && lead(seg[at + 1]))
      link = {
        kind: "teamtailor",
        board: host,
        id: lead(seg[at + 1]),
        customDomain: !host.endsWith(".teamtailor.com"),
      };
  }
  if (!link?.board || !link.id) return null;
  try {
    sourceURL(link);
  } catch {
    return null;
  }
  return link;
}

const prettify = (board) =>
  board
    .replace(/\.(?:teamtailor\.com|[a-z]{2,24})$/i, "")
    .replace(/^careers?\./i, "")
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// Does this posting from the board's list match the link?
function samePosting(job, link, kind) {
  if (String(job.sourceId) === String(link.id)) return true;
  for (const url of [job.originalUrl, job.applyUrl]) {
    if (!url) continue;
    const other = jobLink(url);
    if (other && other.kind === kind && String(other.id) === String(link.id))
      return true;
  }
  return false;
}

class LinkError extends Error {}

export async function importJobLink(
  store,
  url,
  { company = "" } = {},
  fetcher = fetch,
  deadline = Date.now() + 60_000,
) {
  const link = jobLink(url);
  const known =
    link &&
    (await store.get(
      "SELECT * FROM sources WHERE kind=? AND lower(board)=lower(?)",
      link.kind,
      link.board,
    ));
  // An unknown company domain is only treated as a Teamtailor site when the
  // company is already on the list that way.
  if (!link || (link.customDomain && !known))
    throw new LinkError(
      `This link isn't a job page on ${linkBoards.slice(0, -1).join(", ")} or ${linkBoards.at(-1)}. Open the company's own job page (on LinkedIn, the "Apply on company website" button) and copy that address, or fill the job in by hand below.`,
    );
  const listed = catalog.find(
    (c) =>
      c.connector?.kind === link.kind &&
      c.connector.board.toLowerCase() === link.board.toLowerCase(),
  );
  const name =
    String(company || "")
      .trim()
      .slice(0, 150) ||
    known?.company ||
    listed?.name ||
    prettify(link.board);
  let source = known,
    added = false;
  if (!source) {
    source = {
      id: uuid(),
      kind: link.kind,
      company: name,
      board: link.board,
      enabled: 1,
    };
    added = true;
  }
  const s = { ...source, industry: listed?.industry || "Unknown" };
  let jobs;
  try {
    ({ jobs } = await readSource(store, s, fetcher, deadline));
  } catch (e) {
    throw new LinkError(
      `Couldn't read ${name}'s job board (${e.message}). Check the link, or fill the job in by hand below.`,
    );
  }
  if (added)
    await store.run(
      "INSERT INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
      source.id,
      source.kind,
      source.company,
      source.board,
    );
  else if (!source.enabled)
    await store.run("UPDATE sources SET enabled=1 WHERE id=?", source.id);
  const profile = await store.config("profile", initialProfile);
  const job = jobs.find((j) => samePosting(j, link, link.kind));
  // The rest of the board's matching roles come in now as well, instead of
  // waiting for the next scan.
  const others = jobs.filter((j) => {
    if (j === job) return false;
    const a = assess(j, profile);
    return !a.unsuitable;
  });
  if (others.length) await upsertJobs(store, others, profile);
  await store.run(
    "UPDATE sources SET health='Healthy',last_run=?,error=NULL,count=? WHERE id=?",
    now(),
    others.length + (job && !assess(job, profile).unsuitable ? 1 : 0),
    source.id,
  );
  const more = others.length
    ? ` ${others.length} more matching role${others.length === 1 ? "" : "s"} from ${name} came in too.`
    : "";
  const watch = added ? ` ${name} is now checked in every scan.` : "";
  if (!job) {
    await store.event(
      null,
      "job",
      `${name}: the linked posting was not on its job board.${watch}`,
    );
    return {
      id: null,
      companyAdded: added,
      message: `That posting isn't on ${name}'s job board any more, so it may have closed.${watch}${more}`,
    };
  }
  if (link.kind === "bamboohr")
    await addBambooDetails(store, s, [job], fetcher, deadline, 1);
  const [id] = await upsertJobs(
    store,
    [{ ...job, addedByYou: now(), collection: "Saved" }],
    profile,
  );
  const a = assess(job, profile);
  await store.event(
    null,
    "job",
    `${name}: "${job.title}" added from its job page.${watch}`,
  );
  return {
    id,
    companyAdded: added,
    outsideFilters: a.unsuitable || null,
    message:
      (a.unsuitable
        ? `Added "${job.title}" and saved it. It is outside your usual filters (${a.unsuitable}), but stays in your list because you added it.`
        : `Added "${job.title}" and saved it.`) +
      watch +
      more,
  };
}
export { LinkError };
