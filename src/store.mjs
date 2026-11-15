import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SqlModel } from "./sql-model.mjs";
import { LocalFiles } from "./files.mjs";
import { sha } from "./ids.mjs";
export { now, uuid, sha } from "./ids.mjs";
export class Store extends SqlModel {
  constructor(root = process.env.DATA_DIR || "data") {
    super();
    this.root = path.resolve(root);
    this.storage = new LocalFiles(this.root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.root, "career.sqlite"));
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
    this.transactionTail = Promise.resolve();
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
    );
    for (const name of fs
      .readdirSync(new URL("../migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = fs.readFileSync(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
        checksum = sha(sql),
        old = this.db
          .prepare("SELECT checksum FROM schema_migrations WHERE name=?")
          .get(name);
      if (old) {
        if (old.checksum !== checksum)
          throw new Error("Migration checksum changed: " + name);
        continue;
      }
      this.db.exec(sql);
      this.db
        .prepare("INSERT OR IGNORE INTO schema_migrations VALUES (?,?)")
        .run(name, checksum);
    }
  }
  file(key) {
    return this.storage.path(key);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  async batch(statements) {
    return this.transaction(async (tx) => {
      const results = [];
      for (const { sql, args = [] } of statements)
        results.push(tx.run(sql, ...args));
      return results;
    });
  }
  async transaction(fn) {
    let unlock;
    const previous = this.transactionTail;
    this.transactionTail = new Promise((r) => (unlock = r));
    await previous;
    let begun = false;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      begun = true;
      const value = await fn(this);
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      if (begun) this.db.exec("ROLLBACK");
      throw e;
    } finally {
      unlock();
    }
  }
  close() {
    this.db.close();
  }
}
