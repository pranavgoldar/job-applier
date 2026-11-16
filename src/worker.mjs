import { now } from "./ids.mjs";
import { Store } from "./store.mjs";
import { discover } from "./connectors.mjs";
import { pathToFileURL } from "node:url";
export async function tick(store) {
  const settings = await store.config("settings", {
    paused: false,
    intervalHours: 12,
    mode: "prepare",
  });
  const next = await store.config("nextDiscovery");
  if (!settings.paused && (!next || next <= now())) {
    await store.set("scanStarted", now());
    await store.enqueue("discovery");
    await store.set(
      "nextDiscovery",
      new Date(
        Date.now() + (settings.intervalHours || 12) * 3600000,
      ).toISOString(),
    );
  }
  const task = await store.get(
    "UPDATE queue SET status='running',started=? WHERE id=(SELECT id FROM queue WHERE status='queued' ORDER BY created LIMIT 1) RETURNING *",
    now(),
  );
  if (!task) return;
  try {
    if (task.kind === "discovery") await discover(store);
    else throw new Error("Unknown task kind");
    await store.run(
      "UPDATE queue SET status='done',finished=? WHERE id=?",
      now(),
      task.id,
    );
  } catch (e) {
    await store.run(
      "UPDATE queue SET status='failed',finished=?,error=? WHERE id=?",
      now(),
      String(e.message).slice(0, 200),
      task.id,
    );
  }
}
export async function startWorker(store) {
  let running = false;
  await store.run(
    "UPDATE queue SET status='queued',started=NULL WHERE status='running' AND kind='discovery'",
  );
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await store.set("workerHeartbeat", now());
      await tick(store);
    } catch (e) {
      await store.event(null, "worker_error", String(e.message).slice(0, 200));
    } finally {
      running = false;
    }
  };
  run();
  const timer = setInterval(run, 5000);
  timer.unref();
  return timer;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const store = new Store();
  await startWorker(store);
  console.log(
    "Independent discovery worker running; no AI key or browser required.",
  );
  setInterval(() => {}, 60000);
}
