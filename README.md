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

## Speed

The hosted function runs in Mumbai (`bom1`, set in `vercel.json`). Keep the Turso database in a nearby region: every database round trip from a far region adds about 0.2 s. The dashboard loads with one batched read, and clicks update the screen immediately while the change is saved in the background.

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

- **Jobs:** one feed of matched roles with search, an All India filter and city chips. The default sort shows Bangalore, Mumbai, Hyderabad and Delhi first, in that order, then ranks jobs within each city by match score. Other Indian locations, Dubai and Singapore are also eligible. Filter by category, job or internship, and sector. Save, hide, or open a role to see why it matched.
- **Applications:** a four-column board (To apply, Applied, Interviewing, Outcome). Mark a job applied in one click, then update its stage, notes and follow-up date.
- **Resumes:** one slot each for Product / APM and Founder’s Office. Drag in a PDF or DOCX. A file named like `… APM resume.pdf` or `… founder office resume.pdf` is filed automatically. Old versions are kept.
- **Companies:** every watched company with its scan status, an on/off switch and its matches. Add your own by job-board name.
- **Discovery without AI:** ordinary HTTP reads of public job-board feeds from Greenhouse, Lever, Ashby, SmartRecruiters, Workable and Pinpoint, and of Y Combinator company pages. No AI key, no paid API, no subscription.
- **Internships:** business-side internships (product, strategy, operations, analytics, growth, marketing) are kept from every company board, and the Himalayas feed adds remote internships open to India. That feed allows only a few requests a day without a key; setting the optional free `HIMALAYAS_API_KEY` environment variable in Vercel lifts the limit. Everything else works without it.

### How discovery decides what to keep

1. Read every posting from each enabled source.
2. Keep titles in the Product family or Founder’s Office family. A generic title such as “Associate” is also kept when the described work is clearly one of the two (three or more matching responsibilities). Engineering, design, sales, legal, compliance and HR titles are dropped. Internships are judged more loosely: any business-side internship is kept.
3. Keep locations in India, the UAE or Singapore, plus remote roles open to India, Asia or worldwide. A remote role keeps the actual list of countries it is open to; India is never assumed.
4. Drop senior titles and roles asking for more than two years. A number of years only counts when the sentence is about the candidate’s experience, so “we have operated for 10 years” is ignored.
5. Score what is left out of 100: role fit 30, experience 20, sector 20, location 20, job detail 10.
6. SmartRecruiters lists carry only a summary, so the full description is fetched (and reused on later scans) before a role is judged and a resume suggested.

### What happens to a job after it is found

Presence and suitability are tracked separately, and nothing is deleted:

- **Still listed and still fits:** stays open.
- **Still listed but changed so it no longer fits:** kept, marked “no longer matches” with the reason. It returns to the open list if it changes back.
- **Not in a complete read of the board:** kept, marked “no longer listed”.
- **Partial or failed read:** nothing is concluded. Jobs keep their previous state.

Closed and no-longer-matching jobs are under **Jobs → Closed**.

### Scan status

Every scan reports how many sources were checked, how many failed and how many are still waiting. It is called finished only when none are waiting. If the hosted function runs out of time, the dashboard says the scan did not finish and offers **Continue scan**.

### Coverage

The watchlist has 82 companies plus one remote-internship feed. 72 companies are read automatically: 61 through their own job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Pinpoint) and 11 through their Y Combinator company page. 10 need a manual check because their careers sites refuse automated reads or have no public feed (Revolut, Remitly, Navi, Juspay, Ramp, Sarwa, Fasset, Monee, NephroPlus, Different AI). The Companies page shows Product and Founder’s Office coverage separately and each company’s sourced evidence. See [COMPANY-WATCHLIST.md](COMPANY-WATCHLIST.md).

## Applying

Job boards do not accept applications from a server: Greenhouse, Lever and Ashby only take submissions with the employer’s own key, and every public form carries a captcha. So applying happens in your browser, with a Chrome extension doing the typing.

- **Applications → To apply** lists every open match with an **Apply** button.
- **Needs my attention** lists every prepared packet that is waiting on you, and any submission whose outcome is unclear, with what is left to do.
- **All applications** shows every application in one of four columns with its exact status. Nothing drops off the board.
- A job’s panel holds its whole packet: why it is waiting, the exact resume version (which you can change), the remaining-action checklist, prepared answers with copy buttons, the submission record and its history.
- With the extension installed ([extension/README.md](extension/README.md)), Apply opens the form filled in. You check it and press Submit.
- **Settings → Application answers** holds the answers forms keep asking for.

### Recording a submission

An application becomes **Applied** only with a record of what was sent:

- **user-confirmed**: you fill a short form with the exact resume version, the date, what confirms it, and an optional attachment.
- **browser-detected**: the extension saw the employer’s confirmation page and attached the resume itself.
- **system-confirmed**: a receipt the system obtained itself. Only the test fixture produces this today.

A submission marked **Submission uncertain** cannot be moved on by a stage change or by the extension. It is resolved by recording your own evidence, or by marking it Withdrawn or Closed. Submitted applications are never deleted.

## If the hosted app will not start

The error page names the setting or service at fault: which of `APP_PASSWORD`, `CRON_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `BLOB_READ_WRITE_TOKEN` is missing or not valid, or whether the database or file storage refused the connection. Values of secrets are never shown.

## Development

Tests run on every pull request and on `main` through GitHub Actions (`.github/workflows/test.yml`). `test/regression.test.mjs` holds one test per fault found in review; each fails on the code it was written against.

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
- `src/applications.mjs`, `src/matching.mjs`, `src/watchlist.mjs`: tracking, role/location/experience rules and scoring, company targets.
- `src/target-companies.json`: the company list and each company’s job-board identifier.
- `migrations/`: append-only schema migrations, recorded by checksum on startup.
- `scripts/migrate-to-cloud.mjs`: private data transfer into an empty cloud app.
- `public/`: responsive browser app.
- `extension/`: Chrome extension that fills application forms; `src/answers.mjs` lists the saved answers it can use.
