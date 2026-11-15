import { waitUntil } from "@vercel/functions";
import { createStore } from "../src/create-store.mjs";
import { seed } from "../src/seed.mjs";
import { createHandler } from "../src/http.mjs";
import {
  enqueueCloudDiscovery,
  runCloudQueue,
  nextCloudRun,
  validCronAuthorization,
} from "../src/cloud-worker.mjs";
let initialized;
async function initialize() {
  if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 16)
    throw new Error("Configure APP_PASSWORD with at least 16 characters");
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 16)
    throw new Error("Configure CRON_SECRET with at least 16 characters");
  const store = await createStore({ cloud: true });
  await seed(store);
  const kick = async () => {
    const ids = await enqueueCloudDiscovery(store);
    waitUntil(
      runCloudQueue(store).catch(async () => {
        await store.event(
          null,
          "worker_error",
          "Hosted discovery interrupted. Check connector health and retry queued work.",
        );
      }),
    );
    return ids[0] || null;
  };
  return {
    store,
    handler: createHandler(store, { hosted: true, onDiscoveryQueued: kick }),
  };
}
export async function getApp() {
  if (!initialized)
    initialized = initialize().catch((e) => {
      initialized = null;
      throw e;
    });
  return initialized;
}
export function originalAPIURL(raw) {
  const u = new URL(raw, "https://local.invalid"),
    route = u.searchParams.get("route");
  if (route !== null) {
    u.searchParams.delete("route");
    return "/api/" + route + (u.search ? "?" + u.searchParams.toString() : "");
  }
  return u.pathname + u.search;
}
export default async function handler(req, res) {
  req.url = originalAPIURL(req.url);
  const path = new URL(req.url, "https://local.invalid").pathname;
  if (
    path === "/api/cron" &&
    (!validCronAuthorization(req.headers.authorization) || req.method !== "GET")
  ) {
    res.writeHead(401, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    return res.end(JSON.stringify({ error: "Cron authorization required" }));
  }
  try {
    const { store, handler } = await getApp();
    if (path === "/api/cron") {
      const settings = await store.config("settings");
      if (settings.paused) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ paused: true }));
      }
      await store.set("nextDiscovery", nextCloudRun());
      await enqueueCloudDiscovery(store);
      const result = await runCloudQueue(store);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify(result));
    }
    return handler(req, res);
  } catch {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        error:
          "Hosted services are not ready. Check APP_PASSWORD, CRON_SECRET, Turso and private Blob settings in Vercel.",
      }),
    );
  }
}
