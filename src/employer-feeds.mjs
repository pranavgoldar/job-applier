import robotsParser from "robots-parser";
import { setTimeout as delay } from "node:timers/promises";
import { SaxesParser } from "saxes";

export const employerFeedDocs = {
  recruitee: "https://support.recruitee.com/en/articles/8213076-faq-api",
  teamtailor:
    "https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide",
  personio: "https://support.personio.de/hc/en-us/articles/207576365",
};
export function employerFeedURL({ kind, board }) {
  if (typeof board !== "string") throw new Error("Invalid board identifier");
  const slug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (kind === "teamtailor") {
    if (
      !/^(?=.{4,120}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(
        board,
      ) ||
      /(?:^|\.)(?:local|localhost|internal|lan|home|corp|test|example|invalid)$/.test(
        board,
      )
    )
      throw new Error("Invalid board identifier");
    return "https://" + board + "/jobs.rss";
  }
  if (
    kind === "personio" &&
    /^[a-z0-9-]{1,63}\.jobs\.personio\.(?:de|com)$/i.test(board)
  )
    return "https://" + board + "/xml";
  if (!slug.test(board)) throw new Error("Invalid board identifier");
  if (kind === "recruitee")
    return "https://" + board + ".recruitee.com/api/feeds/offers.xml";
  return "https://" + board + ".jobs.personio.com/xml";
}

function parseXML(xml) {
  const parser = new SaxesParser();
  const stack = [];
  let root;
  parser.on("doctype", () => {
    throw new Error("Unexpected feed document type");
  });
  parser.on("opentag", ({ name, attributes }) => {
    const node = {
      name: name.split(":").pop().toLowerCase(),
      attributes,
      richText:
        stack.at(-1)?.richText ||
        /^(?:value|description|description_requirements|requirements)$/i.test(
          name,
        ),
      text: "",
      children: [],
    };
    if (stack.length) stack.at(-1).children.push(node);
    else root = node;
    stack.push(node);
  });
  const append = (value) => {
    if (stack.length) stack.at(-1).text += value;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const node = stack.pop();
    if (stack.at(-1)?.richText) stack.at(-1).text += " " + node.text + " ";
  });
  parser.write(xml).close();
  return root;
}
const children = (node, name) =>
  node?.children.filter((child) => child.name === name) || [];
const child = (node, name) => children(node, name)[0];
const value = (node, name) => child(node, name)?.text.trim() || "";
const join = (...parts) =>
  [...new Set(parts.flat().filter(Boolean))].join("; ");
function location(node) {
  const country = value(node, "country") || value(node, "country_code");
  return (
    join(
      value(node, "city") || value(node, "name"),
      { IN: "India", AE: "United Arab Emirates", SG: "Singapore" }[country] ||
        country,
    ) || node.text.trim()
  );
}
function posting(kind, node, origin) {
  const places = children(child(node, "locations"), "location").map(location);
  if (kind === "personio") {
    const rawYears = value(node, "yearsofexperience");
    const years = rawYears
      .replace(/_/g, " ")
      .replace(/^(\d+(?:\s*[-–]\s*\d+|\+)?)$/, "$1 years");
    const id = value(node, "id");
    if (!/^\d+$/.test(id)) throw new Error("Missing Personio position ID");
    return {
      id,
      title: value(node, "name"),
      location: join(
        value(node, "office"),
        children(child(node, "additionaloffices"), "office").map((o) =>
          o.text.trim(),
        ),
      ),
      originalUrl: origin + "/job/" + id,
      description: children(child(node, "jobdescriptions"), "jobdescription")
        .map((d) => value(d, "value"))
        .join(" "),
      employmentType: /intern|trainee|apprentice/i.test(
        value(node, "employmenttype"),
      )
        ? "Internship"
        : value(node, "schedule") || value(node, "employmenttype"),
      experienceLevel: join(years, value(node, "seniority")),
      postedAt: value(node, "createdat"),
    };
  }
  if (kind === "recruitee") {
    return {
      id: value(node, "reference") || value(node, "id"),
      title: value(node, "title"),
      originalUrl: value(node, "url") || value(node, "careers_url"),
      applyUrl: value(node, "apply_url"),
      description:
        value(node, "description_requirements") ||
        join(value(node, "description"), value(node, "requirements")),
      location: join(places.length ? places : location(node)),
      workplaceType:
        value(node, "remote") === "true"
          ? "Remote"
          : value(node, "hybrid") === "true"
            ? "Hybrid"
            : "",
      experienceLevel:
        value(node, "experience") ||
        value(node, "experience_code").replace(/_/g, " "),
      employmentType:
        value(node, "contract_type") ||
        value(node, "employment_type_code").replace(/_/g, " "),
      postedAt: value(node, "posted") || value(node, "published_at"),
    };
  }
  const remote = value(node, "remotestatus").toLowerCase();
  return {
    applyUrl: value(node, "link").replace(/\/?$/, "/applications/new"),
    id: value(node, "guid") || value(node, "link"),
    title: value(node, "title"),
    originalUrl: value(node, "link"),
    description: value(node, "description"),
    location: join(
      places.length ? places : children(node, "location").map(location),
    ),
    workplaceType:
      remote === "fully" ? "Remote" : remote === "hybrid" ? "Hybrid" : "",
    postedAt: value(node, "pubdate")
      ? new Date(value(node, "pubdate")).toISOString()
      : null,
  };
}
export function parseEmployerPage(source, xml) {
  const root = parseXML(xml),
    rss = source.kind === "teamtailor",
    first = new URL(employerFeedURL(source)),
    jobs = [];
  const container = rss ? child(root, "channel") : root;
  const records = rss
    ? "item"
    : source.kind === "personio"
      ? "position"
      : root?.name === "offers"
        ? "offer"
        : "job";
  const allowedRoot = rss
    ? ["rss"]
    : source.kind === "personio"
      ? ["workzag-jobs"]
      : ["jobs", "offers"];
  if (
    !allowedRoot.includes(root?.name) ||
    !container ||
    container.text.trim() ||
    (rss && !value(container, "title"))
  )
    throw new Error("Unrecognized employer feed");
  const entries = children(container, records);
  if (
    !rss &&
    container.children.some((n) => ![records, "link", "next"].includes(n.name))
  )
    throw new Error("Unexpected employer feed contents");
  for (const n of entries) {
    const { id, ...job } = posting(source.kind, n, first.origin);
    if (!id || !job.title || !/^https?:\/\//i.test(job.originalUrl))
      throw new Error("Incomplete job posting");

    jobs.push({
      ...job,
      sourceId: rss ? id : source.board + ":" + id,
      location:
        [job.location, job.workplaceType].filter(Boolean).join("; ") ||
        "Unknown",
      isRemote: job.workplaceType === "Remote",
    });
  }
  const link = children(container, "link").find(
    (n) => n.attributes.rel === "next",
  );
  const next = link?.attributes.href || value(container, "next");
  if (link && !next) throw new Error("Invalid continuation link");
  return { jobs, next };
}
export async function readEmployerFeed(source, readPage, deadline = Infinity) {
  const first = new URL(employerFeedURL(source));
  const policyURL = new URL("/robots.txt", first).href;
  let policy;
  try {
    policy = robotsParser(policyURL, await readPage(policyURL, "text/plain"));
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
  const pause = (policy?.getCrawlDelay("CareerDesk") || 0) * 1000;
  const rss = source.kind === "teamtailor";
  if (rss) first.searchParams.set("per_page", "100");
  let url = first;
  const jobs = [],
    seen = new Set(),
    visited = new Set();
  while (url && visited.size < 100) {
    if (visited.has(url.href)) throw new Error("Repeated feed page");
    visited.add(url.href);
    if (policy?.isAllowed(url.href, "CareerDesk") === false)
      throw new Error(
        "Feed disallows automatic reading. Visit the careers page manually.",
      );
    if (pause) {
      if (pause > Math.min(deadline - Date.now(), 60000))
        throw new Error("Feed crawl delay exceeds the scan window");
      await delay(pause);
    }
    const page = parseEmployerPage(
      source,
      await readPage(
        url.href,
        "application/rss+xml, application/xml, text/xml",
      ),
    );
    for (const job of page.jobs) {
      if (seen.has(job.sourceId))
        throw new Error("Repeated posting in employer feed");
      seen.add(job.sourceId);
      jobs.push(job);
    }
    const next = page.next;
    if (next) {
      url = new URL(next, url);
      if (
        url.origin !== first.origin ||
        url.pathname !== first.pathname ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error("Unexpected continuation link");
    } else if (rss && page.jobs.length >= 100) {
      url = new URL(first);
      url.searchParams.set("offset", String(jobs.length));
    } else return jobs;
  }
  throw new Error("Pagination safety limit; board incomplete");
}
