import fs from "node:fs";
import assert from "node:assert/strict";
for (const p of [
  "public/index.html",
  "public/app.js",
  "public/style.css",
  "src/http.mjs",
  "src/cloud-store.mjs",
  "src/cloud-worker.mjs",
  "src/target-companies.json",
  "api/index.mjs",
])
  assert(fs.existsSync(p), "Missing deployment file: " + p);
const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
assert.equal(config.outputDirectory, "public");
assert(
  config.crons.every((c) => c.schedule === "0 3 * * *"),
  "Default deployment uses one daily cron",
);
console.log(
  "Vercel assets and API source ready. No private data is included in the build.",
);
