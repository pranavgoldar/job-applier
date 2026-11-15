import http from "node:http";
import { createStore } from "./create-store.mjs";
import { seed } from "./seed.mjs";
import { createHandler } from "./http.mjs";
import { startWorker } from "./worker.mjs";
const store = await createStore({ cloud: false });
await seed(store);
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? d : process.argv[i + 1];
};
const port = Number(arg("--port", process.env.PORT || 4173)),
  host = arg("--host", process.env.HOST || "127.0.0.1");
const server = http.createServer(createHandler(store));
server.listen(port, host, () =>
  console.log(`Career OS listening on http://${host}:${port}`),
);
if (process.env.EMBEDDED_WORKER !== "0") await startWorker(store);
process.on("SIGTERM", () =>
  server.close(async () => {
    await store.close();
    process.exit(0);
  }),
);
