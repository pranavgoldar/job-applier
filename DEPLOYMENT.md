# Deploy Career OS on Vercel

This repository is prepared for Vercel, but no Vercel deployment or external database/file store is provisioned automatically. Configure your own services below. Costs and limits depend on provider plans; no always-free hosting or exact pricing is promised.

## 1. Create the database

Create a Turso database and authentication token. Keep the database near your Vercel function region where practical. Save these values in Vercel Project Settings → Environment Variables:

- `TURSO_DATABASE_URL`: the database's `libsql://...` URL.
- `TURSO_AUTH_TOKEN`: the database token.

Do not add these values to GitHub or paste them into chat. Schema migrations are applied idempotently when the API starts; applied migration checksums are preserved. Do not edit applied SQL files; append a new migration.

Official reference: [Turso TypeScript SDK](https://docs.turso.tech/sdk/ts/reference).

## 2. Import the repository

In Vercel, choose Add New → Project, connect GitHub and import `pranavgoldar/job-applier`.

- Framework preset: **Other**.
- Node.js: **24.x**.
- Build command: **npm run build**.
- Output directory: **public**.
- Root directory: repository root.

`vercel.json` declares the API rewrite, included runtime files, 300-second function duration and daily cron. `api/index.mjs` runs the shared API without starting a permanent HTTP listener or timer. An initial deployment can build before services are configured, but API requests will show a setup error until all required environment variables are present and you redeploy.

## 3. Attach private file storage

In the Vercel project's Storage area, create a Blob store with **Private** access and connect it to the project. Confirm `BLOB_READ_WRITE_TOKEN` is available to the production deployment.

The application explicitly uploads and reads with `access: 'private'`. File paths and application records are stored in Turso. Download routes require the application login and return file bytes through the server. No resume is exposed as a public asset.

Official reference: [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## 4. Configure access and scheduling secrets

Add:

- `APP_PASSWORD`: a unique private workspace password, at least 16 characters.
- `CRON_SECRET`: a different random secret, at least 16 characters.

Set all five values for Production, then redeploy. Hosted login cookies automatically use Secure. Database-backed sessions survive independent function invocations. Unauthenticated private routes return 401. Scheduled requests require `Authorization: Bearer <CRON_SECRET>`; unsigned requests are rejected before database initialization.

Keep preview deployments separate from production data if you enable them. The public repository contains a blank personal profile; complete it only inside your private deployed app or use the migration tool.

## 5. Verify and use the hosted app

1. Open the deployment URL and sign in with `APP_PASSWORD`.
2. Complete your Profile and upload both resume tracks, or perform the optional migration below.
3. Open Settings → Company watchlist and source health.
4. Click Run discovery and inspect Activity for completed tasks or connector errors. Source errors preserve existing jobs.
5. Check the production cron in Vercel. Your laptop can be off once the app is hosted.

The default cron is `0 3 * * *`: daily at 03:00 UTC, approximately 08:30–09:29 IST on Hobby. Current Hobby limits allow daily cron execution with up to 59 minutes of timing variation. More frequent cron expressions require a plan that permits them. The local interval field is disabled in the hosted UI; edit the deployed schedule in `vercel.json` when changing it.

GitHub Actions also schedules scans at 12:47, 17:47 and 21:47 IST. In the repository’s **Settings → Secrets and variables → Actions**, create the repository secret `CRON_SECRET` with the same value as the production Vercel secret. After the workflow reaches the default branch, **Actions → Scan job boards → Run workflow** can check the connection. Each run reports a paused scan or the numbers processed and still queued. GitHub can delay scheduled runs. The morning Vercel scan runs independently.

Each cloud task handles one employer source. Work is bounded to approximately 220 seconds per invocation, below the configured 300-second limit. Three sources can run concurrently. Tasks not started before the budget expires stay queued; stale running discovery tasks are safely reclaimed after six minutes at a later trigger. Failed source attempts are recorded in source health; no failure marks vacancies closed. Manual discovery uses the same durable queue and Vercel `waitUntil`.

Official references: [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [function limits](https://vercel.com/docs/functions/limitations), [SQLite on Vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel). The app avoids relying on writable deployment files by using Turso and private Blob.

## Optional: migrate your existing Windows records

Use the migration before creating cloud jobs/resumes/applications, since it refuses to overwrite those records.

1. Stop your local launcher so its files are consistent.
2. Clone the repository and run `npm ci` in the clone.
3. Copy `.env.example` to an ignored `.env` file and enter your Turso and Blob values locally.
4. Run:

```powershell
node --env-file=.env scripts/migrate-to-cloud.mjs "C:\path\to\existing-career-os\data"
```

The migration checks file hashes, uploads exact private files, then transactionally transfers profile, sources, jobs, applications, resume versions, evidence and activity. It does not copy old login sessions or discovery queue state. It refuses to overwrite a cloud app containing jobs, applications or resumes. Verify the hosted profile, counts, resume downloads and application notes before retiring the local installation. The migration does not push private data to GitHub.

## Updates

Push source changes to the production Git branch. Vercel deploys them automatically when Git integration is connected. The persistent database and private file store remain separate from code releases. No ZIP extraction or Windows launcher is needed to use the hosted site.

## Current limits

- Live production Turso/Blob credentials and Vercel hosting are not configured by this repository preparation. Tests verify their code paths without operating your accounts.
- Hosted file uploads are capped at 3 MB; local uploads allow 8 MB. This keeps JSON/base64 requests under Vercel's 4.5 MB payload limit.
- The full dashboard is designed for one private user and a bounded early-career job feed. A larger multi-user deployment needs per-user authorization and pagination.
- Ten boards have collectors; unsupported employer sites remain manual. The Add job dialog accepts pasted alert text and links for manual review.
- Real employer browser preparation depends on the optional extension and the actual form. CAPTCHA, MFA, assessments and final submission remain manual.

## Docker or always-on Node alternative

The checked-in Docker Compose setup runs the local SQLite/file-volume variant behind Caddy. Configure `APP_PASSWORD` and `CAREER_DOMAIN`, then run `docker compose up -d --build`. Keep the private data volume persistent. This option uses the embedded worker rather than Vercel cron.
