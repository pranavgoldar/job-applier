import { timingSafeEqual } from "node:crypto";
import { now } from "./ids.mjs";
import { canScanSource } from "./yc-discovery.mjs";
import { discover } from "./connectors.mjs";
export function nextCloudRun(stamp = Date.now()) {
  const d = new Date(stamp);
  d.setUTCHours(3, 0, 0, 0);
  if (d.getTime() <= stamp) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
export function validCronAuthorization(
  header,
  secret = process.env.CRON_SECRET,
) {
  if (!secret) return false;
  const a = Buffer.from(String(header || "")),
    b = Buffer.from("Bearer " + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function enqueueCloudDiscovery(store) {
  const sources = (
    await store.all("SELECT id,kind FROM sources WHERE enabled=1")
  ).filter(canScanSource);
  const ids = await Promise.all(
    sources.map((s) => store.enqueue("discovery-source", { sourceId: s.id })),
  );
  return ids;
}
export async function runCloudQueue(
  store,
  { fetcher = fetch, budgetMs = 220000, concurrency = 3 } = {},
) {
  const deadline = Date.now() + budgetMs;
  await store.set("workerHeartbeat", now());
  await store.run(
    "UPDATE queue SET status='queued',started=NULL WHERE kind='discovery-source' AND status='running' AND started<?",
    new Date(Date.now() - 6 * 60000).toISOString(),
  );
  let completed = 0,
    failed = 0;
  const worker = async () => {
    while (Date.now() < deadline - 1500) {
      const task = await store.get(
        "UPDATE queue SET status='running',started=? WHERE id=(SELECT id FROM queue WHERE kind='discovery-source' AND status='queued' ORDER BY created LIMIT 1) RETURNING *",
        now(),
      );
      if (!task) return;
      try {
        const { sourceId } = JSON.parse(task.payload);
        await discover(store, fetcher, {
          sourceIds: [sourceId],
          deadline,
          queueNewSources: true,
        });
        await store.run(
          "UPDATE queue SET status='done',finished=? WHERE id=?",
          now(),
          task.id,
        );
        completed++;
      } catch (e) {
        if (e.deferred) {
          await store.run(
            "UPDATE queue SET status='queued',started=NULL WHERE id=?",
            task.id,
          );
          return;
        }
        failed++;
        await store.run(
          "UPDATE queue SET status='failed',finished=?,error=? WHERE id=?",
          now(),
          String(e.message).slice(0, 200),
          task.id,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await store.set("workerHeartbeat", now());
  return {
    completed,
    failed,
    queued: (
      await store.get(
        "SELECT COUNT(*) AS n FROM queue WHERE kind='discovery-source' AND status='queued'",
      )
    ).n,
  };
}
