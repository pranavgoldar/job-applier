import path from "node:path";
import { uuid, now, sha } from "./ids.mjs";
import { initialProfile, statuses, assess } from "./matching.mjs";
import { appRow } from "./sql-model.mjs";
// "Pranav Goldar APM resume.pdf" -> Product, "... founder office resume.pdf" -> Founder’s Office.
export function trackFromName(name = "") {
  const n = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const founders =
      /founder|\bfo\b|chief of staff|\bcos\b|strategy|biz ?ops|business|generalist/.test(
        n,
      ),
    product = /\bapm\b|\bpm\b|product/.test(n);
  if (founders && !product) return "Founder’s Office";
  if (product && !founders) return "Product";
  return null;
}
export async function addResume(store, { track, name, bytes, mime }) {
  track ||= trackFromName(name);
  if (!track)
    throw new Error(
      "Could not tell which resume this is from the file name. Choose Product or Founder’s Office.",
    );
  if (!["Product", "Founder’s Office"].includes(track))
    throw new Error("Unknown resume track");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new Error("Resume must be at most 8 MB");
  if (!(
    (mime === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-") ||
    (mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      bytes.subarray(0, 2).toString() === "PK")
  ))
    throw new Error("Use a valid PDF or DOCX file");
  const id = uuid(),
    key = "resumes/" + id;
  await store.storage.write(key, bytes, mime);
  try {
    // One atomic batch: retire the old default, add the next version, log it.
    await store.batch([
      { sql: "UPDATE resumes SET is_default=0 WHERE track=?", args: [track] },
      {
        sql: "INSERT INTO resumes SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,1 FROM resumes WHERE track=?",
        args: [
          id,
          track,
          path.basename(name),
          sha(bytes),
          key,
          mime,
          now(),
          track,
        ],
      },
      {
        sql: "INSERT INTO events(app_id,kind,message,created) SELECT NULL,'resume',? || version || ?,? FROM resumes WHERE id=?",
        args: [
          `${track} resume v`,
          " added. Earlier application versions preserved.",
          now(),
          id,
        ],
      },
    ]);
  } catch (e) {
    await store.storage.remove(key);
    throw e;
  }
  return id;
}
export async function prepare(store, jobId) {
  const [old, j, profile] = await Promise.all([
    store.get("SELECT * FROM applications WHERE job_id=?", jobId),
    store.job(jobId),
    store.config("profile", initialProfile),
  ]);
  if (old) return appRow(old);
  if (!j) throw new Error("Job not found");
  const a = assess(j, profile);
  if (!profile.name || !profile.email || !profile.education)
    a.review.push(
      "Complete your verified name, email and education before using this packet.",
    );
  const resume = await store.get(
    "SELECT * FROM resumes WHERE track=? AND is_default=1",
    a.track,
  );
  const id = uuid();
  const data = {
    profileSnapshot: profile,
    eligibilityReviewed: false,
    recommendedTrack: a.track,
    resumeReason: a.reason,
    approvedResume: !a.ambiguous,
    resumeSnapshot: resume
      ? {
          id: resume.id,
          track: resume.track,
          version: resume.version,
          sha256: resume.sha256,
          name: resume.name,
        }
      : null,
    completed: [
      "Responsibilities assessed using deterministic rules",
      resume
        ? `${resume.track} resume v${resume.version} selected`
        : "Resume recommendation prepared",
    ],
    remaining: [
      ...a.blocked.map((x) => "Resolve eligibility conflict: " + x),
      ...a.review.map((x) => "Confirm: " + x),
      ...(j.requiredActions || []),
      "Review job eligibility and selected resume",
      "Open the employer application",
      "Sign in or complete verification if requested",
      "Copy factual answers and attach the selected resume",
      "Answer employer-specific questions and review declarations",
      "Click the employer’s final submit button",
      "Save confirmation and mark submitted here",
    ],
    pauseReason: !resume
      ? "No resume file is available for this track."
      : a.blocked.length
        ? "Eligibility conflict: " + a.blocked.join(" ")
        : a.ambiguous
          ? "Responsibilities overlap; approve or override the recommended resume."
          : a.review.length
            ? "Missing factual eligibility decisions: " +
              a.review.join(" ") +
              " No employer fields have been filled."
            : "Employer form is not supported by an automated preparation adapter. No fields have been filled in your browser.",
    draftPortable: false,
    answers: [
      {
        question: "Full name",
        answer: profile.name,
        verified: !!profile.name,
      },
      {
        question: "Email",
        answer: profile.email,
        verified: !!profile.email,
      },
      {
        question: "Education and graduation",
        answer:
          profile.education +
          "; expected graduation " +
          profile.graduation +
          ".",
        verified: true,
      },
      {
        question: "Availability",
        answer:
          profile.internshipAvailability +
          " Full-time from " +
          profile.fullTimeStart +
          ".",
        verified: true,
      },
      {
        question: "Relevant experience — review for this role",
        answer:
          profile.facts ||
          "Add your verified experience in Profile before drafting an answer.",
        verified: false,
      },
    ],
    checks: [],
    notes: "",
    followUp: null,
    confirmation: null,
    submissionAttempts: 0,
    formFilled: false,
  };
  const status =
    !resume || a.ambiguous || a.blocked.length || a.review.length
      ? "Needs my input"
      : "Ready for final step";
  const created = await store.get(
    "INSERT INTO applications VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO NOTHING RETURNING *",
    id,
    jobId,
    resume?.id || null,
    status,
    JSON.stringify(data),
    now(),
    now(),
  );
  // Someone else created it between the check and the insert: return theirs.
  if (!created)
    return appRow(
      await store.get("SELECT * FROM applications WHERE job_id=?", jobId),
    );
  const event =
    "INSERT INTO events(app_id,kind,message,created) VALUES (?,?,?,?)";
  await store.batch([
    {
      sql: event,
      args: [
        id,
        "preparing",
        "Preparation started; no employer site was modified.",
        now(),
      ],
    },
    { sql: event, args: [id, "handoff", data.pauseReason, now()] },
  ]);
  return appRow(created);
}
export async function overrideResume(store, id, resumeId) {
  const a = await store.app(id);
  if (!a) throw new Error("Application not found");
  if (
    [
      "Applied",
      "Submitting",
      "Submission uncertain",
      "Assessment / Interview",
      "Rejected",
      "Offer",
      "Withdrawn",
      "Closed",
    ].includes(a.status)
  )
    throw new Error("Resume version is locked after submission starts");
  const r = await store.get("SELECT * FROM resumes WHERE id=?", resumeId);
  if (!r) throw new Error("Resume not found");
  await store.event(
    id,
    "resume",
    `Resume explicitly selected: ${r.track} v${r.version}.`,
  );
  return await store.updateApp(id, {
    resumeId,
    approvedResume: true,
    resumeSnapshot: {
      id: r.id,
      track: r.track,
      version: r.version,
      sha256: r.sha256,
      name: r.name,
    },
    status:
      a.eligibilityReviewed &&
      !assess(
        await store.job(a.jobId),
        await store.config("profile", initialProfile),
      ).blocked.length
        ? "Ready for final step"
        : "Needs my input",
    pauseReason:
      "Review eligibility and the handoff packet, then complete the employer form. No fields have been filled in your browser.",
  });
}
export async function approveEligibility(store, id, notes) {
  const a = await store.app(id);
  if (!a) throw new Error("Application not found");
  if (["Applied", "Submitting", "Submission uncertain"].includes(a.status))
    throw new Error("Application is locked");
  const m = assess(
    await store.job(a.jobId),
    await store.config("profile", initialProfile),
  );
  if (m.blocked.length)
    throw new Error("Resolve hard eligibility conflicts before marking ready");
  if (!a.resumeId || !a.approvedResume)
    throw new Error("Approve the selected resume first");
  if (typeof notes !== "string" || notes.trim().length < 8)
    throw new Error("Record how you resolved the open eligibility questions");
  await store.event(
    id,
    "eligibility",
    "User recorded eligibility review; source wording remains available in the job.",
  );
  return await store.updateApp(id, {
    eligibilityReviewed: true,
    eligibilityNotes: notes.trim(),
    status: "Ready for final step",
  });
}
async function resumeSnapshot(store, resumeId) {
  const r =
    resumeId && (await store.get("SELECT * FROM resumes WHERE id=?", resumeId));
  if (!r) throw new Error("Choose the exact resume version you sent");
  return {
    id: r.id,
    track: r.track,
    version: r.version,
    sha256: r.sha256,
    name: r.name,
  };
}
function submissionDate(value) {
  const day = String(value || new Date().toISOString()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))
    throw new Error("Enter the date you submitted, as YYYY-MM-DD");
  // One day of slack covers time zones ahead of the server.
  if (Date.parse(day) > Date.now() + 86400000)
    throw new Error("The submission date cannot be in the future");
  return day;
}
// The person reports a submission: which exact resume went, when, and what
// confirms it. This is also how an uncertain submission is reconciled.
export async function confirmManual(
  store,
  id,
  { evidence, attachment, resumeId, submittedAt } = {},
) {
  const a = await store.app(id);
  if (!a) throw new Error("Application not found");
  if (
    ["Applied", "Assessment / Interview", "Offer", "Rejected"].includes(
      a.status,
    )
  )
    throw new Error("A submission is already recorded");
  const snapshot = await resumeSnapshot(store, resumeId || a.resumeId);
  const day = submissionDate(submittedAt);
  if (typeof evidence !== "string" || evidence.trim().length < 8)
    throw new Error(
      "Provide confirmation text, email details or a reference (at least 8 characters)",
    );
  let fileId = null;
  if (attachment) {
    const bytes = Buffer.from(attachment.base64 || "", "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024)
      throw new Error("Evidence file must be at most 8 MB");
    if (
      !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(
        attachment.mime,
      )
    )
      throw new Error("Evidence must be PDF, PNG, JPEG or text");
    fileId = uuid();
    await store.storage.write("evidence/" + fileId, bytes, attachment.mime);
    await store.run(
      "INSERT INTO files VALUES (?,?,?,?,?,?)",
      fileId,
      id,
      path.basename(attachment.name),
      "evidence/" + fileId,
      attachment.mime,
      sha(bytes),
    );
  }
  await store.event(
    id,
    "user_confirmation",
    a.status === "Submission uncertain"
      ? "Uncertain submission reconciled with the user’s evidence; employer confirmation was not independently verified."
      : "User reported successful submission; employer confirmation was not independently verified.",
  );
  return await store.updateApp(id, {
    status: "Applied",
    resumeId: snapshot.id,
    resumeSnapshot: snapshot,
    approvedResume: true,
    confirmation: {
      type: "user-confirmed",
      evidence: evidence.trim(),
      fileId,
      submittedAt: day,
      time: now(),
    },
    remaining: [],
    checks: [],
  });
}
// The browser extension saw the employer's confirmation page after the person
// pressed Submit. Recorded as its own kind of evidence: stronger than a bare
// claim, weaker than a receipt the system itself obtained.
export async function confirmDetected(store, jobId, { resumeId, url } = {}) {
  const a = await prepare(store, jobId);
  if (a.confirmation) return a;
  if (a.status === "Submission uncertain")
    throw new Error(
      "This submission is marked uncertain. Reconcile it with your own confirmation first.",
    );
  const snapshot = await resumeSnapshot(store, resumeId);
  let host = "the employer’s site";
  try {
    host = new URL(url).hostname;
  } catch {}
  await store.event(
    a.id,
    "browser_confirmation",
    `Confirmation page seen in the user’s browser on ${host}; resume ${snapshot.track} v${snapshot.version} was attached by the extension.`,
  );
  return await store.updateApp(a.id, {
    status: "Applied",
    resumeId: snapshot.id,
    resumeSnapshot: snapshot,
    approvedResume: true,
    confirmation: {
      type: "browser-detected",
      evidence: `Employer confirmation page seen in your browser on ${host}.`,
      fileId: null,
      submittedAt: now().slice(0, 10),
      time: now(),
    },
    remaining: [],
    checks: [],
  });
}
export async function setStage(store, id, status) {
  if (!statuses.includes(status)) throw new Error("Unknown status");
  const a = await store.app(id);
  if (!a) throw new Error("Application not found");
  if (
    ["Applied", "Submitting", "Submission uncertain", "Preparing"].includes(
      status,
    )
  )
    throw new Error(
      "This status requires the corresponding workflow and evidence",
    );
  if (
    a.status === "Submission uncertain" &&
    !["Withdrawn", "Closed"].includes(status)
  )
    throw new Error(
      "Reconcile uncertain submission with credible evidence before proceeding",
    );
  if (
    status === "Ready for final step" &&
    (!a.eligibilityReviewed || !a.approvedResume || !a.resumeId)
  )
    throw new Error("Complete eligibility and resume review first");
  await store.event(id, "stage", `Stage changed to ${status}.`);
  return await store.updateApp(id, {
    status,
  });
}
// Remove a packet that was never submitted. Submitted applications are history:
// they are withdrawn or closed, never erased.
export async function untrack(store, jobId) {
  const a = await store.get("SELECT * FROM applications WHERE job_id=?", jobId);
  if (!a) return;
  const app = appRow(a);
  if (
    app.confirmation ||
    ["Submitting", "Submission uncertain"].includes(app.status)
  )
    throw new Error(
      "A submitted or uncertain application is kept as history. Mark it Withdrawn or Closed instead.",
    );
  await store.run("DELETE FROM files WHERE app_id=?", a.id);
  await store.run("DELETE FROM events WHERE app_id=?", a.id);
  await store.run("DELETE FROM applications WHERE id=?", a.id);
  await store.event(null, "stage", "Unsubmitted packet removed.");
}
// Deliberately restricted: the only submission adapter is an in-process test fixture.
// External employer sites always hand off. No outgoing application POST is implemented.
export async function submitFixture(store, id, adapter) {
  const a = await store.app(id),
    job = await store.job(a?.jobId);
  if (job?.source !== "test-fixture")
    throw new Error("Live submission is unsupported; use the manual handoff");
  if (a.status === "Submission uncertain")
    throw new Error("Reconcile before retrying");
  if (a.submissionAttempts || a.status === "Applied")
    throw new Error("Duplicate submission prevented");
  await store.updateApp(id, {
    status: "Submitting",
    submissionAttempts: 1,
  });
  try {
    const result = await adapter();
    if (!result?.receipt) throw new Error("No credible confirmation");
    return await store.updateApp(id, {
      status: "Applied",
      confirmation: {
        type: "system-confirmed",
        evidence: result.receipt,
        time: now(),
      },
    });
  } catch (e) {
    await store.event(
      id,
      "submission_uncertain",
      "Submission result unknown; retries are blocked until reconciled.",
    );
    return await store.updateApp(id, {
      status: "Submission uncertain",
      pauseReason:
        "Submission may have occurred. Check employer history or email before retrying.",
    });
  }
}
