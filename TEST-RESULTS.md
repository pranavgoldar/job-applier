# Validation — Vercel/Git edition

**31 tests passed, 0 failed**, and the Vercel build check passed on 15 November 2026. The test suite covers local behavior and the hosted storage/API paths. Run `npm ci`, `npm test`, and `npm run build`.

Checks include:

- Job/application deduplication and responsibility-based resume routing.
- Remote-country exclusion, graduation/start timing, unknown facts and experience/skill hard filters.
- Connector outages, supported-source imports, company-watchlist installation and preserved source pauses.
- Exact resume files and checksums after default-version updates.
- User-confirmed versus fixture system-confirmed submissions, uncertainty and blocked retries.
- HTTP authentication, protected downloads, Origin checks, logout and persistence across server restarts.
- All dashboard views and the optional extension's partial-fill behavior.
- Real libSQL client integration with its file transport across independent store instances.
- Shared hosted login sessions and private downloads across independent HTTP handlers.
- Per-source cloud queue deduplication, bounded work and stale discovery recovery.
- Exact-record/file migration to an empty cloud target, with refusal to overwrite existing records.
- Private Blob SDK access flags using a mocked SDK.
- Unsigned cron rejection and Vercel rewrite normalization.
- Concurrent independent application edits without losing other changed fields.

Live Turso HTTP service, private Vercel Blob and a production Vercel account were not exercised without owner service configuration. The libSQL tests use the actual client with local file transport, and Blob SDK tests use a mock. Browser visual QA remains unavailable in the cloud environment; DOM tests do not verify visual layout or actual employer forms. No real job application was submitted.
