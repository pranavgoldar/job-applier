import { ensureWatchlist, catalogVersion } from "./watchlist.mjs";
import { initialProfile } from "./matching.mjs";
import { ycAuthorized, seedYCDirectories } from "./yc-discovery.mjs";
export async function seed(store) {
  // A settled installation needs nothing: answer that with one query.
  const [rows] = await store.readMany([
    {
      sql: "SELECT key,value FROM config WHERE key IN ('profile','settings','sourcesInitialized','companyCatalogVersion','ycDirectoriesAuthorized')",
    },
  ]);
  const have = new Map(rows.map((r) => [r.key, JSON.parse(r.value)]));
  if (
    have.has("profile") &&
    have.has("settings") &&
    have.get("sourcesInitialized") &&
    have.get("ycDirectoriesAuthorized") === ycAuthorized() &&
    have.get("companyCatalogVersion") === catalogVersion
  )
    return;
  await store.run(
    "INSERT OR IGNORE INTO config VALUES (?,?)",
    "profile",
    JSON.stringify(initialProfile),
  );
  if (!(await store.config("settings")))
    await store.set("settings", {
      paused: false,
      intervalHours: 12,
      mode: "prepare",
      dailyLimit: 5,
    });
  if (!(await store.config("sourcesInitialized"))) {
    for (const [id, kind, company, board] of [
      ["aspora", "ashby", "Aspora", "aspora"],
      ["nium", "lever", "Nium", "nium"],
      ["razorpay", "greenhouse", "Razorpay", "razorpaysoftwareprivatelimited"],
    ])
      await store.run(
        "INSERT OR IGNORE INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
        id,
        kind,
        company,
        board,
      );
    await store.set("sourcesInitialized", true);
  }
  await ensureWatchlist(store);
  if (have.get("ycDirectoriesAuthorized") !== ycAuthorized())
    await seedYCDirectories(store);
}
