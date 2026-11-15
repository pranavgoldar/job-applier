import { sha } from "./ids.mjs";
const tables = [
  "config",
  "sources",
  "jobs",
  "resumes",
  "applications",
  "files",
  "events",
];
export async function migratePrivateData(local, cloud) {
  for (const table of ["jobs", "resumes", "applications"])
    if ((await cloud.get("SELECT COUNT(*) AS n FROM " + table)).n)
      throw new Error(
        "Cloud app already has private records; migration refuses to overwrite them",
      );
  const uploads = [
    ...(await local.all("SELECT path,sha256,mime FROM resumes")),
    ...(await local.all("SELECT path,sha256,mime FROM files")),
  ];
  for (const file of uploads) {
    const bytes = await local.storage.read(file.path);
    if (sha(bytes) !== file.sha256)
      throw new Error("Local private-file checksum mismatch");
    let exists = false;
    try {
      const prior = await cloud.storage.read(file.path);
      if (sha(prior) !== file.sha256)
        throw new Error("A different cloud file already uses this key");
      exists = true;
    } catch (e) {
      if (e.message !== "Private file not found" && e.code !== "ENOENT")
        throw e;
    }
    if (!exists) await cloud.storage.write(file.path, bytes, file.mime);
  }
  const rows = Object.fromEntries(
    await Promise.all(
      tables.map(async (name) => [
        name,
        await local.all("SELECT * FROM " + name),
      ]),
    ),
  );
  await cloud.transaction(async (tx) => {
    for (const table of ["jobs", "resumes", "applications"])
      if ((await tx.get("SELECT COUNT(*) AS n FROM " + table)).n)
        throw new Error(
          "Cloud data changed during migration; no records were overwritten",
        );
    const statements = ["queue", ...tables.slice().reverse()].map((name) => ({
      sql: "DELETE FROM " + name,
      args: [],
    }));
    for (const name of tables) {
      for (const row of rows[name]) {
        const keys = Object.keys(row);
        statements.push({
          sql:
            "INSERT INTO " +
            name +
            "(" +
            keys.join(",") +
            ") VALUES (" +
            keys.map(() => "?").join(",") +
            ")",
          args: keys.map((k) => row[k]),
        });
      }
    }
    await tx.client.batch(statements);
  });
  return {
    jobs: rows.jobs.length,
    applications: rows.applications.length,
    resumes: rows.resumes.length,
    files: uploads.length,
  };
}
