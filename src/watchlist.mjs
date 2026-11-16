import fs from "node:fs";
import { assess, initialProfile } from "./matching.mjs";
export const catalog = JSON.parse(
  fs.readFileSync(new URL("./target-companies.json", import.meta.url), "utf8"),
);
export const defaultSearchPreferences = {
  tracks: ["Product", "Founder’s Office"],
  trackWeights: {
    Product: 0.5,
    "Founder’s Office": 0.5,
  },
  fintechFirst: true,
  preferYCBacked: true,
  preferredCompanyStages: ["Early stage", "Series A", "Series B"],
  preferIndiaExpansion: true,
  companyCriteriaArePreferences: true,
  keepNamedCompanies: true,
  experienceMaximumYears: 2,
  fullTimeCountries: ["India", "Singapore", "United Arab Emirates"],
  fullTimeFrom: "2027-05-15",
  remoteInternshipsRequireIndiaEligibility: true,
};
export const catalogVersion = 3;
export async function ensureWatchlist(store) {
  if ((await store.config("companyCatalogVersion")) === catalogVersion) return;
  const old = await store.config("companyWatchlist", []),
    byId = new Map(old.map((c) => [c.id, c]));
  let newSources = 0;
  for (const entry of catalog) {
    const existing = byId.get(entry.id);
    // Catalog research wins; only your own on/off choice is carried over.
    const c = {
      ...existing,
      ...entry,
      enabled: existing?.enabled ?? true,
    };
    delete c.sourceId;
    if (c.connector) {
      let source = await store.get(
        "SELECT * FROM sources WHERE kind=? AND lower(board)=lower(?)",
        c.connector.kind,
        c.connector.board,
      );
      if (!source) {
        // A company whose board identifier was corrected keeps its row and settings.
        const stale =
          (existing?.sourceId &&
            (await store.get(
              "SELECT * FROM sources WHERE id=?",
              existing.sourceId,
            ))) ||
          (await store.get(
            "SELECT * FROM sources WHERE lower(company)=lower(?)",
            c.name,
          ));
        if (stale) {
          await store.run(
            "UPDATE sources SET kind=?,board=?,health='Never run',error=NULL WHERE id=?",
            c.connector.kind,
            c.connector.board,
            stale.id,
          );
          source = stale;
        } else {
          const id = "watch-" + c.id;
          await store.run(
            "INSERT OR IGNORE INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
            id,
            c.connector.kind,
            c.name,
            c.connector.board,
          );
          source = await store.get("SELECT * FROM sources WHERE id=?", id);
          newSources++;
        }
      }
      c.sourceId = source.id;
    }
    byId.set(c.id, c);
  }
  await store.set("companyWatchlist", [...byId.values()]);
  await store.set("companySearchPreferences", {
    ...defaultSearchPreferences,
    ...(await store.config("companySearchPreferences", {})),
  });
  // Scoring rules changed with this catalog, so existing matches are re-scored once.
  const profile = await store.config("profile", initialProfile);
  const rescored = (await store.all("SELECT id,data FROM jobs")).map((row) => {
    const job = JSON.parse(row.data);
    return {
      sql: "UPDATE jobs SET data=? WHERE id=?",
      args: [
        JSON.stringify({ ...job, assessment: assess(job, profile) }),
        row.id,
      ],
    };
  });
  if (rescored.length) await store.batch(rescored);
  await store.set("companyCatalogVersion", catalogVersion);
  await store.event(
    null,
    "watchlist",
    `${catalog.length} companies on the watchlist. ${newSources} new job boards connected.`,
  );
}
export function watchlistFrom(sources, watchlist) {
  return watchlist.map((c) => {
    const s = sources.find((s) => s.id === c.sourceId);
    return {
      ...c,
      coverage: s
        ? s.enabled
          ? "Scheduled ATS collection"
          : "Collection paused"
        : "Manual review — collector not connected",
      sourceCount: s?.count ?? null,
      sourceError: s?.error || null,
      sourceLastRun: s?.last_run || null,
      sourceHealth: s?.health || null,
      sourceEnabled: !!s?.enabled,
    };
  });
}
export async function watchlistState(store) {
  return watchlistFrom(
    await store.all("SELECT * FROM sources"),
    await store.config("companyWatchlist", []),
  );
}
