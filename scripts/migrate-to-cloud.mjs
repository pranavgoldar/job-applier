import fs from "node:fs";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { CloudStore } from "../src/cloud-store.mjs";
import { migratePrivateData } from "../src/migrate-cloud.mjs";
const root = path.resolve(process.argv[2] || process.env.DATA_DIR || "data");
if (!fs.existsSync(path.join(root, "career.sqlite")))
  throw new Error(
    "Local data/career.sqlite not found. Supply the existing private data directory.",
  );
const local = new Store(root),
  cloud = await CloudStore.open();
try {
  console.log(await migratePrivateData(local, cloud));
  console.log(
    "Private records and exact resume files migrated. No credentials were printed.",
  );
} finally {
  local.close();
  cloud.close();
}
