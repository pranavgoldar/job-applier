import { setTimeout as delay } from "node:timers/promises";

// Only these hiring paths, and numbered pages under them, are directory inputs.
export const ycDirectories = new Map([
  ...[
    "bengaluru",
    "mumbai",
    "hyderabad",
    "new-delhi",
    "gurugram",
    "pune",
    "noida",
    "chennai",
    "singapore",
    "dubai",
    "india",
  ].map((city) => [city, "/companies/location/" + city + "/hiring"]),
  ...["fintech", "consumer"].map((sector) => [
    sector + "-india",
    "/companies/industry/" + sector + "/india/hiring",
  ]),
]);
export const ycAuthorized = () =>
  process.env.YC_DISCOVERY_AUTHORIZED === "true";
export const canScanSource = (source) =>
  !["yc-directory", "ycombinator"].includes(source.kind) || ycAuthorized();
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function ycProps(html) {
  const match = String(html).match(/\bdata-page=(["'])([\s\S]*?)\1/);
  if (!match) throw new Error("YC page has no embedded data");
  return JSON.parse(
    match[2]
      .replace(/&quot;|&#34;/g, '"')
      .replace(/&#39;|&#x27;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  ).props;
}

// A database lease serializes reads even across concurrent Vercel invocations.
// Release only after the response is read, then leave a half-second gap.
export async function readYC(store, url, fetcher, deadline) {
  if (!ycAuthorized())
    throw new Error(
      "Manual check: automated YC reads require YC authorization.",
    );
  const key = "ycNextRequest";
  while (Date.now() + 500 < deadline) {
    const time = Date.now();
    const lease = String(time + 15000);
    const acquired = await store.get(
      "INSERT INTO config(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=? RETURNING value",
      key,
      lease,
      time,
    );
    if (!acquired) {
      await delay(500);
      continue;
    }
    let cooldown = 500;
    try {
      const response = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(12000, deadline - Date.now())),
        ),
        headers: {
          Accept: "text/html",
          "User-Agent": "CareerDesk/1.0 public-job-discovery",
        },
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers?.get("Retry-After");
          const when =
            retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Date.parse(retry) - Date.now();
          cooldown = Math.max(60000, Number.isFinite(when) ? when : 0);
        }
        throw new Error("YC HTTP " + response.status);
      }
      const html = await response.text();
      if (html.length > 12_000_000) throw new Error("YC response too large");
      return ycProps(html);
    } finally {
      await store.run(
        "UPDATE config SET value=? WHERE key=? AND value=?",
        String(Date.now() + cooldown),
        key,
        lease,
      );
    }
  }
  throw Object.assign(new Error("YC source waiting for the next scan window"), {
    deferred: true,
  });
}
export async function seedYCDirectories(store) {
  const authorized = ycAuthorized();
  if (authorized) {
    await store.batch(
      [...ycDirectories.keys()].map((board) => ({
        sql: "INSERT OR IGNORE INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
        args: [
          "yc-directory-" + board,
          "yc-directory",
          "YC hiring · " + board,
          board,
        ],
      })),
    );
  }
  await store.set("ycDirectoriesAuthorized", authorized);
}
export async function hiringCompanies(store, board, fetcher, deadline) {
  const path = ycDirectories.get(board);
  if (!path) throw new Error("Unsupported YC directory");
  const companies = new Map();
  for (let page = 1; page <= 100; page++) {
    const url =
      "https://www.ycombinator.com" +
      path +
      (page === 1 ? "" : "?page=" + page);
    const props = await readYC(store, url, fetcher, deadline);
    if (!Array.isArray(props?.companies))
      throw new Error("YC directory has no company list");
    const before = companies.size;
    for (const c of props.companies) {
      if (
        !slugPattern.test(c.slug || "") ||
        typeof c.name !== "string" ||
        !c.name.trim()
      )
        throw new Error("Incomplete YC directory entry");
      companies.set(c.slug, c.name);
    }
    const pages =
      props.totalPages ??
      props.total_pages ??
      props.pagination?.totalPages ??
      props.pagination?.total_pages;
    const total =
      props.totalCompanies ?? props.totalCount ?? props.pagination?.total_count;
    const more =
      pages != null
        ? page < Number(pages)
        : (props.hasMore ??
          props.has_more ??
          (typeof total === "number"
            ? companies.size < total
            : (board === "india" && page === 1) ||
              props.companies.length >= 50));
    if (
      page > 1 &&
      (props.companies.length || more) &&
      before === companies.size
    )
      throw new Error("YC directory repeated a page");
    if (!more) return companies;
  }
  throw new Error("YC pagination incomplete");
}
