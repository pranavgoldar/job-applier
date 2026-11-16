import fs from "node:fs";
import { createClient } from "@libsql/client";
import { SqlModel } from "./sql-model.mjs";
import { BlobFiles } from "./files.mjs";
import { sha } from "./ids.mjs";
export class CloudStore extends SqlModel {
  constructor(client, storage) {
    super();
    this.client = client;
    this.storage = storage;
    this.hosted = true;
  }
  static async open({
    url = process.env.TURSO_DATABASE_URL,
    authToken = process.env.TURSO_AUTH_TOKEN,
    storage,
  } = {}) {
    if (!url)
      throw new Error("Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN");
    const s = new CloudStore(
      createClient({ url, authToken, intMode: "number" }),
      storage || new BlobFiles(),
    );
    await s.initialize();
    return s;
  }
  async initialize() {
    // One round trip on a normal start: make sure the ledger exists and read it.
    const [, ledger] = await this.client.batch(
      [
        "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
        "SELECT name,checksum FROM schema_migrations",
      ],
      "write",
    );
    const applied = new Map(ledger.rows.map((r) => [r.name, r.checksum]));
    for (const name of fs
      .readdirSync(new URL("../migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const original = fs.readFileSync(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
        checksum = sha(original);
      if (applied.has(name)) {
        if (applied.get(name) !== checksum)
          throw new Error("Migration checksum changed: " + name);
        continue;
      }
      await this.client.executeMultiple(
        original.replace(/^PRAGMA[^;]*;/gm, ""),
      );
      await this.run(
        "INSERT OR IGNORE INTO schema_migrations VALUES (?,?)",
        name,
        checksum,
      );
    }
  }
  async all(sql, ...args) {
    return (await this.client.execute({ sql, args })).rows.map((r) => ({
      ...r,
    }));
  }
  async get(sql, ...args) {
    return (await this.all(sql, ...args))[0];
  }
  async run(sql, ...args) {
    const r = await this.client.execute({ sql, args });
    return {
      changes: r.rowsAffected,
      lastInsertRowid:
        r.lastInsertRowid === undefined ? null : Number(r.lastInsertRowid),
    };
  }
  async batch(statements) {
    return this.client.batch(statements, "write");
  }
  async readMany(statements) {
    return (await this.client.batch(statements, "read")).map((r) =>
      r.rows.map((row) => ({ ...row })),
    );
  }
  async transaction(fn) {
    const client = await this.client.transaction("write"),
      tx = new CloudStore(client, this.storage);
    try {
      const result = await fn(tx);
      await client.commit();
      return result;
    } catch (e) {
      await client.rollback();
      throw e;
    } finally {
      client.close();
    }
  }
  close() {
    this.client.close();
  }
}
