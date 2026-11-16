import path from "node:path";
import { uuid, now, sha } from "./ids.mjs";
import { initialProfile, statuses, assess } from "./matching.mjs";
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
    await store.transaction(async (tx) => {
      const version =
        ((
          await tx.get(
            "SELECT MAX(version) AS n FROM resumes WHERE track=?",
            track,
          )
        )?.n || 0) + 1;
      await tx.run("UPDATE resumes SET is_default=0 WHERE track=?", track);
      await tx.run(
        "INSERT INTO resumes VALUES (?,?,?,?,?,?,?,?,1)",
        id,
        track,
        version,
        path.basename(name),
        sha(bytes),
        key,
        mime,
        now(),
      );
    });
  } catch (e) {
    await store.storage.remove(key);
    throw e;
  }
  const version = (
    await store.get("SELECT version FROM resumes WHERE id=?", id)
  ).version;
  await store.event(
    null,
    "resume",
    `${track} resume v${version} added. Earlier application versions preserved.`,
  );
  return id;
}
export async function prepare(store, jobId) {
  const old = await store.get(
    "SELECT id FROM applications WHERE job_id=?",
    jobId,
  );
  if (old) return await store.app(old.id);
  const j = await store.job(jobId);
  if (!j) throw new Error("Job not found");
  const profile = await store.config("profile", initialProfile);
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
  await store.run(
    "INSERT INTO applications VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO NOTHING",
    id,
    jobId,
    resume?.id || null,
    "Preparing",
    JSON.stringify(data),
    now(),
    now(),
  );
  const created = await store.get(
    "SELECT id FROM applications WHERE job_id=?",
    jobId,
  );
  if (created.id !== id) return await store.app(created.id);
  await store.event(
    id,
    "preparing",
    "Preparation started; no employer site was modified.",
  );
  const status =
    !resume || a.ambiguous || a.blocked.length || a.review.length
      ? "Needs my input"
      : "Ready for final step";
  await store.updateApp(id, {
    status,
  });
  await store.event(id, "handoff", data.pauseReason);
  return await store.app(id);
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
export async function confirmManual(store, id, { evidence, attachment }) {
  const a = await store.app(id);
  if (!a) throw new Error("Application not found");
  if (
    ["Applied", "Assessment / Interview", "Offer", "Rejected"].includes(
      a.status,
    )
  )
    throw new Error("A submission is already recorded");
  if (!a.resumeId)
    throw new Error("Select the exact resume version used first");
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
    "User reported successful submission; employer confirmation was not independently verified.",
  );
  return await store.updateApp(id, {
    status: "Applied",
    confirmation: {
      type: "user-confirmed",
      evidence: evidence.trim(),
      fileId,
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
// One-click tracking from the dashboard: the user says where an application stands.
export const quickStages = [
  "Applied",
  "Assessment / Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];
export async function quickTrack(store, jobId, status) {
  if (!quickStages.includes(status)) throw new Error("Unknown status");
  const a = await prepare(store, jobId);
  const patch = { status };
  if (!a.confirmation)
    patch.confirmation = {
      type: "user-confirmed",
      evidence: "Marked as applied from the dashboard.",
      fileId: null,
      time: now(),
    };
  await store.event(a.id, "stage", `Marked as ${status}.`);
  return await store.updateApp(a.id, patch);
}
export async function untrack(store, jobId) {
  const a = await store.get(
    "SELECT id FROM applications WHERE job_id=?",
    jobId,
  );
  if (!a) return;
  await store.run("DELETE FROM files WHERE app_id=?", a.id);
  await store.run("DELETE FROM applications WHERE id=?", a.id);
  await store.event(null, "stage", "Application removed from the tracker.");
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
