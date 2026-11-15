import { uuid, now } from "./ids.mjs";
export class SqlModel {
  async config(key, fallback = null) {
    const r = await this.get("SELECT value FROM config WHERE key=?", key);
    return r ? JSON.parse(r.value) : fallback;
  }
  async set(key, value) {
    await this.run(
      "INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  }
  async event(app, kind, message) {
    await this.run(
      "INSERT INTO events(app_id,kind,message,created) VALUES (?,?,?,?)",
      app,
      kind,
      message,
      now(),
    );
  }
  async job(id) {
    const r = await this.get("SELECT * FROM jobs WHERE id=?", id);
    return r
      ? {
          ...JSON.parse(r.data),
          id: r.id,
          firstSeen: r.first_seen,
          lastChecked: r.last_checked,
        }
      : null;
  }
  async jobs() {
    return (await this.all("SELECT * FROM jobs ORDER BY first_seen DESC")).map(
      (r) => ({
        ...JSON.parse(r.data),
        id: r.id,
        firstSeen: r.first_seen,
        lastChecked: r.last_checked,
      }),
    );
  }
  async app(id) {
    const r = await this.get("SELECT * FROM applications WHERE id=?", id);
    return r
      ? {
          ...JSON.parse(r.data),
          id: r.id,
          jobId: r.job_id,
          resumeId: r.resume_id,
          status: r.status,
          created: r.created,
          updated: r.updated,
        }
      : null;
  }
  async apps() {
    return (
      await this.all("SELECT * FROM applications ORDER BY updated DESC")
    ).map((r) => ({
      ...JSON.parse(r.data),
      id: r.id,
      jobId: r.job_id,
      resumeId: r.resume_id,
      status: r.status,
      created: r.created,
      updated: r.updated,
    }));
  }
  async updateApp(id, patch) {
    const entries = Object.entries(patch);
    if (!entries.length) return this.app(id);
    if (entries.some(([key]) => !/^[A-Za-z][A-Za-z0-9]*$/.test(key)))
      throw new Error("Invalid application field");
    const args = entries.flatMap(([key, value]) => [
        "$." + key,
        JSON.stringify(value),
      ]),
      columns = [
        "data=json_set(data," + entries.map(() => "?,json(?)").join(",") + ")",
        "updated=?",
      ];
    args.push(now());
    if (Object.hasOwn(patch, "resumeId")) {
      columns.push("resume_id=?");
      args.push(patch.resumeId);
    }
    if (Object.hasOwn(patch, "status")) {
      columns.push("status=?");
      args.push(patch.status);
    }
    args.push(id);
    const r = await this.get(
      "UPDATE applications SET " +
        columns.join(",") +
        " WHERE id=? RETURNING *",
      ...args,
    );
    if (!r) throw new Error("Application not found");
    return {
      ...JSON.parse(r.data),
      id: r.id,
      jobId: r.job_id,
      resumeId: r.resume_id,
      status: r.status,
      created: r.created,
      updated: r.updated,
    };
  }
  async enqueue(kind, payload = {}) {
    const encoded = JSON.stringify(payload),
      id = uuid();
    const row = await this.get(
      "INSERT INTO queue(id,kind,payload,created) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM queue WHERE kind=? AND payload=? AND status IN ('queued','running')) RETURNING id",
      id,
      kind,
      encoded,
      now(),
      kind,
      encoded,
    );
    if (row) return row.id;
    return (
      await this.get(
        "SELECT id FROM queue WHERE kind=? AND payload=? AND status IN ('queued','running') ORDER BY created LIMIT 1",
        kind,
        encoded,
      )
    )?.id;
  }
}
