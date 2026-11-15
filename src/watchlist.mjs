import fs from "node:fs";
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
export async function ensureWatchlist(store) {
  if ((await store.config("companyCatalogVersion")) === 1) return;
  const old = await store.config("companyWatchlist", []),
    byId = new Map(old.map((c) => [c.id, c]));
  let newSources = 0;
  for (const entry of catalog) {
    const existing = byId.get(entry.id);
    const c = {
      ...entry,
      ...existing,
      enabled: existing?.enabled ?? true,
    };
    if (c.connector) {
      let source = await store.get(
        "SELECT * FROM sources WHERE kind=? AND lower(board)=lower(?)",
        c.connector.kind,
        c.connector.board,
      );
      if (!source) {
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
      c.sourceId = source.id;
    }
    byId.set(c.id, c);
  }
  await store.set("companyWatchlist", [...byId.values()]);
  await store.set("companySearchPreferences", {
    ...defaultSearchPreferences,
    ...(await store.config("companySearchPreferences", {})),
  });
  await store.set("companyCatalogVersion", 1);
  await store.event(
    null,
    "watchlist",
    `${catalog.length} company targets saved for equal Product and Founder’s Office coverage. ${newSources} supported ATS boards added; remaining companies are marked for manual review.`,
  );
}
export async function watchlistState(store) {
  const sources = await store.all("SELECT * FROM sources");
  return (await store.config("companyWatchlist", [])).map((c) => {
    const s = sources.find((s) => s.id === c.sourceId);
    return {
      ...c,
      coverage: s
        ? s.enabled
          ? "Scheduled ATS collection"
          : "Collection paused"
        : "Manual review — collector not connected",
      sourceHealth: s?.health || null,
      sourceEnabled: !!s?.enabled,
    };
  });
}
