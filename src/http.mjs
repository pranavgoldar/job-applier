import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sha, uuid, now } from "./ids.mjs";
import { watchlistState } from "./watchlist.mjs";
import {
  prepare,
  addResume,
  overrideResume,
  confirmManual,
  setStage,
  approveEligibility,
  quickTrack,
  untrack,
  trackFromName,
} from "./applications.mjs";
import { upsertJob, sourceURL, kinds } from "./connectors.mjs";
import { initialProfile, assess } from "./matching.mjs";
import { nextCloudRun } from "./cloud-worker.mjs";
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
  async function authenticated(req) {
    if (!password) return true;
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("career_session="))
      ?.split("=")[1];
    return (
      token &&
      (await store.get(
        "SELECT hash FROM sessions WHERE hash=? AND expires>?",
        sha(token),
        now(),
      ))
    );
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
        if (token)
          await store.run("DELETE FROM sessions WHERE hash=?", sha(token));
        res.setHeader(
          "Set-Cookie",
          "career_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p === "/api/state" && req.method === "GET")
        return json(res, 200, {
          version: "3.0.0",
          runtime: hosted ? "vercel" : "local",
          maxUploadBytes: hosted ? 3 * 1024 * 1024 : 8 * 1024 * 1024,
          profile: await store.config("profile"),
          settings: await store.config("settings"),
          jobs: await store.jobs(),
          applications: await store.apps(),
          resumes: await store.all(
            "SELECT id,track,version,name,sha256,mime,created,is_default FROM resumes",
          ),
          sources: await store.all("SELECT * FROM sources"),
          companyWatchlist: await watchlistState(store),
          companySearchPreferences: await store.config(
            "companySearchPreferences",
          ),
          events: await store.all(
            "SELECT * FROM events ORDER BY id DESC LIMIT 200",
          ),
          queue: await store.all(
            "SELECT * FROM queue ORDER BY created DESC LIMIT 30",
          ),
          pending: (
            await store.get(
              "SELECT COUNT(*) AS n FROM queue WHERE status IN ('queued','running')",
            )
          ).n,
          lastDiscovery: await store.config("lastDiscovery"),
          nextDiscovery: hosted
            ? nextCloudRun()
            : await store.config("nextDiscovery"),
          workerHeartbeat: await store.config("workerHeartbeat"),
          authEnabled: !!password,
        });
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
          j = await store.job(id),
          b = await body(req);
        if (!j) throw new Error("Job not found");
        if (
          !["Saved", "Shortlisted", "Dismissed", "New"].includes(b.collection)
        )
          throw new Error("Unknown collection");
        await store.run(
          "UPDATE jobs SET data=? WHERE id=?",
          JSON.stringify({
            ...j,
            collection: b.collection,
          }),
          id,
        );
        await store.event(
          null,
          "job_collection",
          `${j.company}: opportunity ${b.collection.toLowerCase()}.`,
        );
        return json(res, 200, {
          ok: true,
        });
      }
      if (p.match(/^\/api\/jobs\/[^/]+\/track$/) && req.method === "POST") {
        const id = p.split("/")[3],
          b = await body(req);
        if (!(await store.job(id))) throw new Error("Job not found");
        if (b.status === "Not applied") {
          await untrack(store, id);
          return json(res, 200, { ok: true });
        }
        return json(res, 200, await quickTrack(store, id, b.status));
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
        for (const j of await store.jobs())
          await store.run(
            "UPDATE jobs SET data=? WHERE id=?",
            JSON.stringify({
              ...j,
              assessment: assess(j, profile),
            }),
            j.id,
          );
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
