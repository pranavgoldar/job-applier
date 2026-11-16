import { ensureWatchlist } from "./watchlist.mjs";
import { initialProfile } from "./matching.mjs";
export async function seed(store) {
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
}
