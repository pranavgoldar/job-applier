# Career OS

A private job-search dashboard with equal Product and Founder’s Office tracks, a company watchlist, versioned resumes, application preparation packets, and an independent discovery worker.

**Deploy from GitHub to Vercel.** Once hosted, open the website in your browser; your PC and the Windows launcher can be off. Future pushes to the production branch trigger Vercel deployments. ZIP extraction is only needed when installing an older downloadable release.

## Vercel setup

See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete instructions.

1. Import this repository in Vercel. Use **Other**, **Node.js 24.x**, build command `npm run build`, and output directory `public`. The checked-in `vercel.json` supplies routing and the daily cron.
2. Create a [Turso](https://turso.tech/) database. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the Vercel project.
3. Create a **private Vercel Blob store** and connect it to the project. Vercel supplies `BLOB_READ_WRITE_TOKEN`.
4. Set a unique `APP_PASSWORD` and a separate `CRON_SECRET`, each at least 16 characters, in Vercel Environment Variables. Redeploy after configuring all five variables.
5. Open the deployed URL, sign in, complete the private Profile, and upload the Product and Founder’s Office resumes. A fresh installation contains no personal details or private resumes.
6. Click **Run discovery**, inspect source health, and review **Needs my attention**. The daily production cron runs without an open browser.

The default Vercel schedule is daily at `03:00 UTC` (approximately `08:30–09:29 IST` on Hobby). Vercel currently restricts Hobby cron jobs to daily execution and approximate timing. Changing the dashboard's local interval does not change Vercel's schedule. More frequent supported schedules can be configured in `vercel.json` for an appropriate plan. See [Vercel's cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Storage and access

- **Vercel:** API functions + Turso/libSQL database + private Vercel Blob files + authenticated daily cron. No writable deployment filesystem is used for private records or uploads.
- **Local/Docker:** SQLite database and private files in `data/`, with an embedded background scheduler.
- Password-protected APIs use shared, persistent sessions, HttpOnly cookies, Secure cookies when hosted, Origin checks, and a database-backed login attempt limit.
- `.env*`, private data, generated ZIPs, resume files and scratch work are excluded from Git and Vercel uploads. The repository contains a blank profile template; personal facts are entered into private storage.
- Hosted uploads are limited to **3 MB per file** to fit Vercel's request limit. Local uploads allow 8 MB.

## Bring existing local data online

You can migrate your existing profile, jobs, applications, notes, exact resume versions and evidence files. The cloud target must have no existing jobs, resumes or applications; migration refuses to overwrite those records.

Install dependencies, put your own cloud credentials in an ignored `.env` file using `.env.example`, then run from your cloned repository:

```powershell
npm ci
node --env-file=.env scripts/migrate-to-cloud.mjs "C:\path\to\your-existing-career-os\data"
```

The tool copies private files to the private Blob store, checks their SHA-256 hashes, then imports database records in a transaction. It does not upload private files to GitHub or print credentials. Existing sessions and stale worker queue entries are not imported. Keep the original local data until you verify the hosted records and downloads.

## Run locally from Git

Requires Node.js 24.x.

```sh
git clone https://github.com/pranavgoldar/job-applier.git
cd job-applier
npm ci
npm start
```

Open `http://127.0.0.1:4173`. Local development binds to loopback. Set `APP_PASSWORD` for authenticated local use; production requires at least 16 characters. Your existing private `data/` directory can be retained beside the code. To update, stop the server, run `git pull` and `npm ci`, then restart. Keep the server running for local background discovery.

## What works

- Overview, job feed, attention queue, application tracker, resume library, profile and answers, company watchlist, source health, activity, follow-ups and CSV export.
- PDF/DOCX resume versioning with exact files and checksums attached to each preparation/application. New defaults do not replace older application versions.
- Responsibilities-based track classification, transparent relevance scores and mandatory eligibility review. Scores are not hiring probabilities. Internships are not counted as full-time tenure.
- Copyable and editable answer packets, remaining-action checklists, pause reasons, original job/application links, notes, follow-up dates and user-confirmed evidence uploads.
- Ordinary HTTP discovery from Greenhouse, Lever and Ashby. No AI key or chat session is required. Timeouts, retries, batching, deduplication, pagination and source health are included.
- Durable per-source cloud tasks with atomic claims and recovery of stale discovery attempts. Manual Run discovery starts bounded work through Vercel's `waitUntil`; pending work can resume at the next trigger.
- Optional user-triggered Chrome preparation extension. It never submits. See [extension/README.md](extension/README.md).

The watchlist includes 22 named firms and 12 similar/research targets, with ten configured ATS boards. Other companies remain clearly marked for manual checks. A configured source is not a successful live fetch or evidence of a suitable vacancy. Funding-stage and India-expansion notes are dated research, not an automatically refreshed company-news feed. See [COMPANY-WATCHLIST.md](COMPANY-WATCHLIST.md).

## Application boundaries

Default mode is Prepare for review. Missing facts or overlapping responsibilities require input; the user can approve or override the recommended resume. Application packets preserve their selected version and factual answers. The app states when no employer fields have been filled.

**Live automatic submission adapters are not implemented.** All employer final submissions, logins, verification, declarations, custom assessments and personal decisions remain human tasks. Automatic mode is reserved configuration and does not make unsupported sites submit. Manual confirmation is labeled user-confirmed. System-confirmed receipts exist only in isolated test fixtures. Uncertain submission results block retries until reconciled.

## Development

```sh
npm ci
npm test
npm run build
```

See [TEST-RESULTS.md](TEST-RESULTS.md). Cloud integration tests use the real libSQL client with its local file transport and a private filesystem adapter; Blob access uses a mocked SDK. Live Turso, Blob and production Vercel deployment require your service configuration and were not tested using your accounts.

## Layout

- `api/index.mjs`: Vercel API entrypoint, rewrite normalization, cron authorization and bounded work.
- `src/http.mjs`: shared API and access control; `src/server.mjs`: local server.
- `src/cloud-store.mjs`, `src/store.mjs`, `src/sql-model.mjs`: cloud/local persistent storage.
- `src/files.mjs`: private Blob and local file adapters.
- `src/connectors.mjs`, `src/cloud-worker.mjs`, `src/worker.mjs`: discovery and scheduling.
- `src/applications.mjs`, `src/matching.mjs`, `src/watchlist.mjs`: preparation, eligibility and company targets.
- `migrations/`: append-only schema migrations, recorded by checksum on startup.
- `scripts/migrate-to-cloud.mjs`: private data transfer into an empty cloud app.
- `public/`: responsive browser app.
