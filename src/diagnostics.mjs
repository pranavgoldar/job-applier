// Startup checks that say WHICH setting or service is wrong, without ever
// showing a secret's value. Only names, yes/no results and plain hints leave here.
const SETTINGS = [
  {
    name: "APP_PASSWORD",
    test: (v) => !!v && v.length >= 16,
    hint: "Set a sign-in password of at least 16 characters.",
  },
  {
    name: "CRON_SECRET",
    test: (v) => !!v && v.length >= 16,
    hint: "Set a separate secret of at least 16 characters for the daily scan.",
  },
  {
    name: "TURSO_DATABASE_URL",
    test: (v) => /^(libsql|https|wss):\/\/[^\s/]+/.test(v || ""),
    hint: "Set the database address from Turso. It starts with libsql://",
  },
  {
    name: "TURSO_AUTH_TOKEN",
    test: (v) => !!v && v.length >= 20,
    hint: "Set the database token from Turso.",
  },
  {
    name: "BLOB_READ_WRITE_TOKEN",
    test: (v) => !!v,
    hint: "Connect a private Vercel Blob store to this project.",
  },
];
export function configChecks(env = process.env) {
  return SETTINGS.map(({ name, test, hint }) => {
    const ok = test(env[name]);
    return {
      check: name,
      ok,
      detail: ok
        ? "Set"
        : env[name]
          ? "Set, but not valid. " + hint
          : "Missing. " + hint,
    };
  });
}
// Remove anything that could be an address, token or key from an error message.
export function safeMessage(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/\b(?:libsql|https?|wss?):\/\/\S+/gi, "[address hidden]")
    .replace(/\b[A-Za-z0-9_\-]{24,}(?:\.[A-Za-z0-9_\-]{8,})*\b/g, "[hidden]")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}
// Turn a failure while opening a service into something a person can act on.
export function explainFailure(stage, error) {
  const text = safeMessage(error),
    raw = String(error?.message || error || "");
  let detail = text;
  if (stage === "database") {
    if (/401|403|unauthori[sz]ed|forbidden|auth|jwt|token/i.test(raw))
      detail =
        "The database refused the token. Check TURSO_AUTH_TOKEN belongs to this database and has not expired.";
    else if (
      /ENOTFOUND|EAI_AGAIN|fetch failed|ECONNREFUSED|ETIMEDOUT|network|404/i.test(
        raw,
      )
    )
      detail =
        "The database could not be reached. Check TURSO_DATABASE_URL and that the database still exists.";
    else if (/checksum/i.test(raw))
      detail =
        "A database migration file was changed after it was applied. Restore the original migration files.";
  }
  if (stage === "storage")
    detail =
      "File storage could not be opened. Check the private Vercel Blob store is connected (BLOB_READ_WRITE_TOKEN).";
  const check = {
    database: "Database (Turso)",
    storage: "File storage (Vercel Blob)",
    setup: "First-time setup",
  }[stage];
  return { check, ok: false, detail, technical: text };
}
export class StartupError extends Error {
  constructor(summary, diagnostics) {
    super(summary);
    this.diagnostics = diagnostics;
  }
}
