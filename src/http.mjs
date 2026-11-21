import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sha, uuid, now } from "./ids.mjs";
import { canScanSource } from "./yc-discovery.mjs";
import { watchlistFrom, rescoreJobs } from "./watchlist.mjs";
import { jobRow, appRow } from "./sql-model.mjs";
import {
  prepare,
  addResume,
  overrideResume,
  confirmManual,
  setStage,
  approveEligibility,
  confirmDetected,
  untrack,
  trackFromName,
} from "./applications.mjs";
import { upsertJob, sourceURL, kinds } from "./connectors.mjs";
import { importJobLink, LinkError } from "./job-link.mjs";
import { initialProfile, assess } from "./matching.mjs";
import { nextCloudRun } from "./cloud-worker.mjs";
import { answerFields, cleanAnswers } from "./answers.mjs";
import { extensionZip } from "./zip.mjs";
// How far the current (or last) scan has got, source by source.
export function scanProgress(sources, startedAt, pending = 0) {
  const enabled = sources.filter((s) => s.enabled),
    ran = (s) => startedAt && s.last_run && s.last_run >= startedAt,
    done = enabled.filter((s) => ran(s) && s.health === "Healthy").length,
    failed = enabled.filter((s) => ran(s) && s.health === "Error").length,
    waiting = startedAt ? enabled.length - done - failed : 0;
  return {
    startedAt: startedAt || null,
    total: enabled.length,
    done,
    failed,
    waiting,
    // Work is still queued or running on the server.
    active: pending > 0,
    complete: !!startedAt && waiting === 0,
  };
}
export function createHandler(
  store,
  { hosted = false, onDiscoveryQueued = null } = {},
) {
  const password = process.env.APP_PASSWORD;
  if (
    (hosted || process.env.NODE_ENV === "production") &&
    (!password || password.length < 16)
  )
    throw new Error(
      "Production requires APP_PASSWORD with at least 16 characters",
    );
  const salt = randomBytes(16),
    expected = password ? scryptSync(password, salt, 32) : null;
  if (!password)
    console.log(
      "Local development auth: password not configured. Keep the listener on loopback or behind the managed private preview.",
    );
  const json = (res, code, data) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    if (req.body !== undefined) {
      const raw =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > (hosted ? 4_400_000 : 12 * 1024 * 1024))
        throw new Error("Request too large");
      return JSON.parse(raw);
    }

    let chunks = [],
      size = 0;
    for await (const b of req) {
      size += b.length;
      if (size > (hosted ? 4_400_000 : 12 * 1024 * 1024))
        throw new Error("Request too large");
      chunks.push(b);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  }
  // A session already checked on this server instance is trusted for two minutes,
  // which saves a database round trip on almost every request.
  const sessions = new Map();
  async function authenticated(req) {
    if (!password) return true;
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("career_session="))
      ?.split("=")[1];
    if (!token) return false;
    const hash = sha(token);
    if (sessions.get(hash) > Date.now()) return true;
    const row = await store.get(
      "SELECT hash FROM sessions WHERE hash=? AND expires>?",
      hash,
      now(),
    );
    if (!row) return false;
    if (sessions.size > 500) sessions.clear();
    sessions.set(hash, Date.now() + 120000);
    return true;
  }

  const handler = async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
      );
      const url = new URL(req.url, "http://localhost"),
        p = url.pathname;
      if (!["GET", "HEAD"].includes(req.method)) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host)
          return json(res, 403, {
            error: "Cross-origin writes rejected",
          });
        if (req.headers["content-type"] !== "application/json")
          return json(res, 415, {
            error: "JSON content type required",
          });
      }
      if (p === "/api/login" && req.method === "POST") {
        const key = sha(
            String(
              req.headers["x-real-ip"] ||
                req.socket?.remoteAddress ||
                "unknown",
            ),
          ),
          stamp = Date.now(),
          cutoff = stamp - 600000;
        const rate = await store.get(
          "INSERT INTO rate_limits(key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<? THEN ? ELSE window_start END RETURNING count",
          key,
          stamp,
          cutoff,
          cutoff,
          stamp,
        );
        if (rate.count > 20)
          return json(res, 429, {
            error: "Too many attempts. Try again in 10 minutes.",
          });
        const b = await body(req);
        if (
          expected &&
          !timingSafeEqual(
            scryptSync(String(b.password || ""), salt, 32),
            expected,
          )
        )
          return json(res, 401, {
            error: "Incorrect password",
          });
        const token = randomBytes(32).toString("hex");
        await store.run(
          "INSERT INTO sessions VALUES (?,?)",
          sha(token),
          new Date(Date.now() + 7 * 86400000).toISOString(),
        );
        res.setHeader(
          "Set-Cookie",
          `career_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${hosted || process.env.COOKIE_SECURE === "1" ? "; Secure" : ""}`,
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p.startsWith("/api/") && !(await authenticated(req)))
        return json(res, 401, {
          error: "Sign in required",
        });
      if (p === "/api/logout" && req.method === "POST") {
        const token = (req.headers.cookie || "").match(
          /career_session=([^;]+)/,
        )?.[1];
        if (token) {
          sessions.delete(sha(token));
          await store.run("DELETE FROM sessions WHERE hash=?", sha(token));
        }
        res.setHeader(
          "Set-Cookie",
          "career_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p === "/api/state" && req.method === "GET") {
        const [
          config,
          jobs,
          apps,
          resumes,
          sourceRows,
          events,
          queue,
          pending,
        ] = await store.readMany([
          {
            sql: "SELECT key,value FROM config WHERE key IN ('profile','settings','answers','scanStarted','companyWatchlist','companySearchPreferences','lastDiscovery','nextDiscovery','workerHeartbeat')",
          },
          { sql: "SELECT * FROM jobs ORDER BY first_seen DESC" },
          { sql: "SELECT * FROM applications ORDER BY updated DESC" },
          {
            sql: "SELECT id,track,version,name,sha256,mime,created,is_default FROM resumes",
          },
          { sql: "SELECT * FROM sources" },
          { sql: "SELECT * FROM events ORDER BY id DESC LIMIT 60" },
          { sql: "SELECT * FROM queue ORDER BY created DESC LIMIT 30" },
          {
            sql: "SELECT COUNT(*) AS n FROM queue WHERE status IN ('queued','running')",
          },
        ]);
        const sources = sourceRows.map((s) =>
          canScanSource(s)
            ? s
            : {
                ...s,
                enabled: 0,
                health: "Manual",
                error: "YC authorization required for automated reads.",
              },
        );
        const c = Object.fromEntries(
          config.map((r) => [r.key, JSON.parse(r.value)]),
        );
        return json(res, 200, {
          version: "3.3.0",
          runtime: hosted ? "vercel" : "local",
          maxUploadBytes: hosted ? 3 * 1024 * 1024 : 8 * 1024 * 1024,
          profile: c.profile ?? null,
          settings: c.settings ?? null,
          answers: c.answers || {},
          answerFields,
          jobs: jobs.map((row) => {
            const job = jobRow(row);
            // A scan can finish after the user changes availability. The feed
            // should immediately reflect the profile returned in this response.
            const assessment = assess(job, c.profile || initialProfile);
            // A job you added yourself stays in view; the reason it falls
            // outside your filters is shown on it instead.
            return job.addedByYou
              ? {
                  ...job,
                  assessment,
                  unsuitable: null,
                  outsideFilters: assessment.unsuitable,
                }
              : { ...job, assessment, unsuitable: assessment.unsuitable };
          }),
          applications: apps.map(appRow),
          resumes,
          sources,
          companyWatchlist: watchlistFrom(sources, c.companyWatchlist || []),
          companySearchPreferences: c.companySearchPreferences ?? null,
          events,
          queue,
          pending: pending[0].n,
          scan: scanProgress(sources, c.scanStarted, pending[0].n),
          lastDiscovery: c.lastDiscovery ?? null,
          nextDiscovery: hosted ? nextCloudRun() : (c.nextDiscovery ?? null),
          workerHeartbeat: c.workerHeartbeat ?? null,
          authEnabled: !!password,
        });
      }
      if (p === "/api/jobs/from-link" && req.method === "POST") {
        const b = await body(req);
        try {
          return json(
            res,
            200,
            await importJobLink(store, b.url, { company: b.company }),
          );
        } catch (e) {
          if (e instanceof LinkError)
            return json(res, 422, { error: e.message });
          throw e;
        }
      }
      if (p === "/api/jobs" && req.method === "POST") {
        const b = await body(req);
        if (!b.title || !b.company || !b.originalUrl)
          throw new Error(
            "Company, title and original description URL are required",
          );
        if (b.applyUrl)
          new URL(b.applyUrl).protocol === "https:" ||
            (() => {
              throw new Error("Application link must use HTTPS");
            })();
        const id = await upsertJob(store, {
          ...b,
          source: "manual",
          sourceId: uuid(),
          active: "Unverified — manually added",
          activeEvidence:
            "User-supplied description; no employer check performed",
        });
        await store.event(
          null,
          "job",
          "Manual job saved and assessed; source availability remains unverified.",
        );
        return json(res, 200, {
          id,
        });
      }
      if (p.match(/^\/api\/jobs\/[^/]+$/) && req.method === "POST") {
        const id = p.split("/").pop(),
          b = await body(req);
        if (
          !["Saved", "Shortlisted", "Dismissed", "New"].includes(b.collection)
        )
          throw new Error("Unknown collection");
        // Update and log together in one round trip.
        const [updated] = await store.batch([
          {
            sql: "UPDATE jobs SET data=json_set(data,'$.collection',?) WHERE id=?",
            args: [b.collection, id],
          },
          {
            sql: "INSERT INTO events(app_id,kind,message,created) SELECT NULL,'job_collection',json_extract(data,'$.company') || ?,? FROM jobs WHERE id=?",
            args: [`: opportunity ${b.collection.toLowerCase()}.`, now(), id],
          },
        ]);
        if (!(updated.rowsAffected ?? updated.changes))
          throw new Error("Job not found");
        return json(res, 200, {
          ok: true,
        });
      }
      if (p.match(/^\/api\/jobs\/[^/]+\/confirm$/) && req.method === "POST") {
        // Record a submission. Always names the exact resume that was sent.
        const id = p.split("/")[3],
          b = await body(req);
        if (b.detected === true)
          return json(res, 200, await confirmDetected(store, id, b));
        if (
          hosted &&
          b.attachment &&
          Buffer.byteLength(b.attachment.base64 || "", "base64") >
            3 * 1024 * 1024
        )
          throw new Error("Hosted upload limit is 3 MB");
        const a = await prepare(store, id);
        return json(res, 200, await confirmManual(store, a.id, b));
      }
      if (p.match(/^\/api\/jobs\/[^/]+\/untrack$/) && req.method === "POST") {
        await untrack(store, p.split("/")[3]);
        return json(res, 200, { ok: true });
      }
      if (p.match(/^\/api\/jobs\/[^/]+\/opened$/) && req.method === "POST") {
        // Remember that the application page was opened, so the dashboard can
        // ask "did you submit?" if nothing confirms it.
        const id = p.split("/")[3],
          b = await body(req);
        await store.run(
          b.clear
            ? "UPDATE jobs SET data=json_remove(data,'$.applyOpened') WHERE id=?"
            : "UPDATE jobs SET data=json_set(data,'$.applyOpened',?) WHERE id=?",
          ...(b.clear ? [id] : [now(), id]),
        );
        return json(res, 200, { ok: true });
      }
      if (p.match(/^\/api\/autofill\/[^/]+$/) && req.method === "GET") {
        // Everything the browser extension needs to fill one application form.
        const id = p.split("/").pop(),
          [[jobRecord], [appRecord], config] = await store.readMany([
            { sql: "SELECT * FROM jobs WHERE id=?", args: [id] },
            { sql: "SELECT * FROM applications WHERE job_id=?", args: [id] },
            {
              sql: "SELECT key,value FROM config WHERE key IN ('profile','answers')",
            },
          ]);
        if (!jobRecord) return json(res, 404, { error: "Job not found" });
        const j = jobRow(jobRecord),
          c = Object.fromEntries(
            config.map((r) => [r.key, JSON.parse(r.value)]),
          ),
          r =
            (appRecord?.resume_id &&
              (await store.get(
                "SELECT * FROM resumes WHERE id=?",
                appRecord.resume_id,
              ))) ||
            (await store.get(
              "SELECT * FROM resumes WHERE track=? AND is_default=1",
              j.assessment.track,
            ));
        return json(res, 200, {
          schema: "career-os-autofill-v1",
          jobId: j.id,
          company: j.company,
          title: j.title,
          applyUrl: j.applyUrl || j.originalUrl,
          // Lets the filler pick internship or full-time answers (expected pay).
          employmentType: j.assessment?.employmentType || null,
          profile: {
            name: c.profile?.name || "",
            email: c.profile?.email || "",
            phone: c.profile?.phone || "",
            education: c.profile?.education || "",
            graduation: c.profile?.graduation || "",
          },
          answers: c.answers || {},
          resume: r
            ? {
                id: r.id,
                name: r.name,
                mime: r.mime,
                track: r.track,
                base64: (await store.storage.read(r.path)).toString("base64"),
              }
            : null,
        });
      }
      if (p === "/api/answers" && req.method === "POST") {
        const b = await body(req);
        await store.set("answers", cleanAnswers(b.answers));
        return json(res, 200, { ok: true });
      }
      if (p === "/api/prepare" && req.method === "POST") {
        if ((await store.config("settings")).mode === "track")
          throw new Error("Enable preparation mode in settings first");
        const b = await body(req);
        return json(res, 200, await prepare(store, b.jobId));
      }
      if (p === "/api/resumes" && req.method === "POST") {
        const b = await body(req);
        if (
          hosted &&
          Buffer.byteLength(b.base64 || "", "base64") > 3 * 1024 * 1024
        )
          throw new Error("Hosted upload limit is 3 MB");
        const track = b.track || trackFromName(b.name);
        return json(res, 200, {
          track,
          id: await addResume(store, {
            ...b,
            track,
            bytes: Buffer.from(b.base64 || "", "base64"),
          }),
        });
      }
      if (p.match(/^\/api\/resumes\/[^/]+$/) && req.method === "GET") {
        const r = await store.get(
          "SELECT * FROM resumes WHERE id=?",
          p.split("/").pop(),
        );
        if (!r)
          return json(res, 404, {
            error: "Resume not found",
          });
        res.setHeader("Content-Type", r.mime);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Disposition",
          `${url.searchParams.has("preview") ? "inline" : "attachment"}; filename="${r.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        );
        return res.end(await store.storage.read(r.path));
      }
      if (p.match(/^\/api\/evidence\/[^/]+$/) && req.method === "GET") {
        const r = await store.get(
          "SELECT * FROM files WHERE id=?",
          p.split("/").pop(),
        );
        if (!r)
          return json(res, 404, {
            error: "Evidence not found",
          });
        res.setHeader("Content-Type", r.mime);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="' +
            r.name.replace(/[^a-zA-Z0-9._-]/g, "_") +
            '"',
        );
        return res.end(await store.storage.read(r.path));
      }
      if (p.match(/^\/api\/applications\/[^/]+$/) && req.method === "POST") {
        const id = p.split("/").pop(),
          b = await body(req);
        if (!(await store.app(id)))
          return json(res, 404, {
            error: "Application not found",
          });
        let result;
        if (b.action === "resume")
          result = await overrideResume(store, id, b.resumeId);
        else if (b.action === "eligibility")
          result = await approveEligibility(store, id, b.notes);
        else if (b.action === "answers") {
          const a = await store.app(id);
          if (
            ["Applied", "Submitting", "Submission uncertain"].includes(a.status)
          )
            throw new Error("Prepared answers are locked");
          if (!Array.isArray(b.answers) || b.answers.length > 50)
            throw new Error("Invalid answers");
          result = await store.updateApp(id, {
            answers: b.answers.map((x) => ({
              question: String(x.question).slice(0, 2000),
              answer: String(x.answer).slice(0, 20000),
              verified: x.verified === true,
            })),
          });
          await store.event(id, "answers", "Prepared answers updated by user.");
        } else if (b.action === "confirm") {
          if (
            hosted &&
            b.attachment &&
            Buffer.byteLength(b.attachment.base64 || "", "base64") >
              3 * 1024 * 1024
          )
            throw new Error("Hosted upload limit is 3 MB");
          result = await confirmManual(store, id, b);
        } else if (b.action === "stage")
          result = await setStage(store, id, b.status);
        else if (b.action === "notes") {
          result = await store.updateApp(id, {
            notes: String(b.notes || ""),
            followUp: b.followUp || null,
          });
          await store.event(id, "note", "Notes or follow-up updated.");
        } else if (b.action === "checks")
          result = await store.updateApp(id, {
            checks: Array.isArray(b.checks) ? b.checks.slice(0, 20) : [],
          });
        else throw new Error("Unsupported action");
        return json(res, 200, result);
      }
      if (p.match(/^\/api\/packet\/[^/]+$/) && req.method === "GET") {
        const a = await store.app(p.split("/").pop());
        if (!a || !a.resumeId)
          throw new Error(
            "A prepared application with a selected resume is required",
          );
        const j = await store.job(a.jobId),
          r = await store.get("SELECT * FROM resumes WHERE id=?", a.resumeId);
        if (
          ["Applied", "Submitting", "Submission uncertain"].includes(a.status)
        )
          throw new Error(
            "This application cannot be prepared again until submission status is reconciled",
          );
        const data = {
          schema: "career-os-handoff-v1",
          applicationId: a.id,
          company: j.company,
          title: j.title,
          originalUrl: j.originalUrl,
          applyUrl: j.applyUrl,
          profile: a.profileSnapshot || (await store.config("profile")),
          answers: a.answers,
          resume: {
            ...a.resumeSnapshot,
            mime: r.mime,
            base64: (await store.storage.read(r.path)).toString("base64"),
          },
          exportedAt: now(),
        };
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="career-os-private-handoff.json"',
        );
        await store.event(
          a.id,
          "packet_export",
          "Private browser handoff packet exported; no employer fields have been filled yet.",
        );
        return json(res, 200, data);
      }
      if (p === "/api/profile" && req.method === "POST") {
        const b = await body(req),
          profile = {
            ...(await store.config("profile")),
          };
        for (const k of [
          "name",
          "email",
          "phone",
          "education",
          "graduation",
          "cpi",
          "fullTimeStart",
          "internshipAvailability",
          "location",
          "workAuthorization",
          "experience",
          "facts",
        ])
          if (typeof b[k] === "string") profile[k] = b[k].slice(0, 20000);
        await store.set("profile", profile);
        await rescoreJobs(store, profile);
        await store.event(
          null,
          "profile",
          "Verified profile updated; existing prepared answers remain historical snapshots.",
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p === "/api/settings" && req.method === "POST") {
        const b = await body(req);
        if (!["track", "prepare", "auto"].includes(b.mode))
          throw new Error("Invalid mode");
        if (b.mode === "auto" && b.enableAuto !== true)
          throw new Error("Automatic mode requires explicit enablement");
        await store.set("settings", {
          paused: !!b.paused,
          mode: b.mode,
          intervalHours: Math.max(
            1,
            Math.min(168, Number(b.intervalHours) || 12),
          ),
          dailyLimit: Math.max(1, Math.min(50, Number(b.dailyLimit) || 5)),
        });
        await store.event(
          null,
          "settings",
          "Automation settings updated. Live employer submissions remain unsupported.",
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p === "/api/sources" && req.method === "POST") {
        const b = await body(req);
        if (!kinds.includes(b.kind)) throw new Error("Unsupported source");
        sourceURL(b);
        if (!b.company) throw new Error("Company required");
        await store.run(
          "INSERT INTO sources(id,kind,company,board) VALUES (?,?,?,?)",
          uuid(),
          b.kind,
          String(b.company).slice(0, 150),
          b.board,
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p.match(/^\/api\/sources\/[^/]+$/) && req.method === "POST") {
        const b = await body(req);
        await store.run(
          "UPDATE sources SET enabled=? WHERE id=?",
          b.enabled ? 1 : 0,
          p.split("/").pop(),
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p === "/api/discover" && req.method === "POST") {
        // A scan already under way is continued, not restarted.
        const busy = (
          await store.get(
            "SELECT COUNT(*) AS n FROM queue WHERE status IN ('queued','running')",
          )
        ).n;
        if (!busy) await store.set("scanStarted", now());
        const id = hosted
          ? await onDiscoveryQueued()
          : await store.enqueue("discovery");
        return json(res, 202, { id });
      }
      if (p === "/api/export" && req.method === "GET") {
        const applications = await store.apps();
        const items = (await store.jobs()).map((j) => {
          const a = applications.find((a) => a.jobId === j.id);
          return {
            company: j.company,
            title: j.title,
            category: j.assessment.category,
            track: j.assessment.track,
            employment_type: j.assessment.employmentType,
            location: j.location,
            remote: j.assessment.remoteEligibility,
            score: j.assessment.score,
            decision: j.assessment.decision,
            original_url: j.originalUrl,
            application_url: j.applyUrl || "",
            status: a?.status || "New match",
            resume: a?.resumeSnapshot
              ? `${a.resumeSnapshot.track} v${a.resumeSnapshot.version}`
              : "Not selected",
            resume_sha256: a?.resumeSnapshot?.sha256 || "",
            last_activity: a?.updated || j.lastChecked,
            confirmation: a?.confirmation?.type || "",
            confirmation_evidence: a?.confirmation?.evidence || "",
            completed: a?.completed.join("; ") || "",
            remaining: a?.remaining.join("; ") || "",
          };
        });
        const keys = Object.keys(
          items[0] || {
            company: 0,
            title: 0,
            status: 0,
          },
        );
        const cell = (x) =>
          '"' +
          String(x ?? "")
            .replace(/^[=+@-]/, "'$&")
            .replaceAll('"', '""') +
          '"';
        res.writeHead(200, {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="career-os-export.csv"',
        });
        return res.end(
          [keys, ...items.map((i) => keys.map((k) => i[k]))]
            .map((row) => row.map(cell).join(","))
            .join("\r\n"),
        );
      }
      if (p.startsWith("/api/"))
        return json(res, 404, {
          error: "Endpoint not found",
        });
      if (p === "/career-os-extension.zip") {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="career-os-extension.zip"',
        );
        return res.end(extensionZip());
      }
      const names = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      if (!names[p])
        return json(res, 404, {
          error: "Not found",
        });
      res.setHeader(
        "Content-Type",
        p.endsWith(".css")
          ? "text/css"
          : p.endsWith(".js")
            ? "application/javascript"
            : "text/html",
      );
      res.setHeader("Cache-Control", "no-store");
      res.end(
        fs.readFileSync(new URL("../public/" + names[p], import.meta.url)),
      );
    } catch (e) {
      json(res, 400, {
        error: e.message,
      });
    }
  };
  return handler;
}
