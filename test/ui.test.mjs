import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { assess, initialProfile, statuses } from "../src/matching.mjs";
import { answerFields } from "../src/answers.mjs";

const stamp = "2026-11-14T10:00:00Z";
const job = (id, extra = {}) => {
  const j = {
    id,
    company: "TEST FIXTURE " + id,
    title: "Product Management Intern",
    location: "Remote India",
    employmentType: "Internship",
    description:
      "Product discovery, roadmap and user research for fintech. No experience required.",
    originalUrl: "https://example.test/job/" + id,
    applyUrl: "https://example.test/job/" + id + "/apply",
    firstSeen: stamp,
    lastChecked: stamp,
    source: "test-fixture",
    active: "TEST FIXTURE",
    activeEvidence: "test only",
    ...extra,
  };
  j.assessment = assess(j);
  return j;
};
const resume = {
  id: "resume1",
  track: "Product",
  version: 1,
  name: "TEST.pdf",
  sha256: "abc123",
  created: stamp,
  is_default: 1,
};
const application = (jobId, status, extra = {}) => ({
  id: "app-" + jobId,
  jobId,
  resumeId: "resume1",
  resumeSnapshot: resume,
  status,
  recommendedTrack: "Product",
  resumeReason: "Test responsibilities",
  completed: ["Resume selected"],
  remaining: ["Confirm hours", "Complete employer form"],
  pauseReason: "No fields have been filled in your browser.",
  answers: [
    { question: "Full name", answer: "Test Candidate", verified: true },
  ],
  checks: [],
  updated: stamp,
  notes: "",
  eligibilityReviewed: false,
  confirmation: null,
  ...extra,
});
const state = (extra = {}) => ({
  profile: initialProfile,
  settings: {
    mode: "prepare",
    paused: false,
    intervalHours: 12,
    dailyLimit: 5,
  },
  jobs: [job("job1")],
  applications: [],
  resumes: [resume],
  sources: [],
  companyWatchlist: [
    {
      id: "auto",
      name: "TEST AUTO",
      industry: "Fintech / payments",
      careersUrl: "https://example.test/auto",
      sourceId: "s1",
      sourceEnabled: true,
      sourceHealth: "Healthy",
      sourceCount: 2,
      tracks: ["Product", "Founder’s Office"],
    },
    {
      id: "manual",
      name: "TEST MANUAL",
      industry: "Fintech / remittances",
      careersUrl: "https://example.test/manual",
      tracks: ["Product", "Founder’s Office"],
    },
  ],
  events: [],
  queue: [],
  pending: 0,
  scan: {
    startedAt: null,
    total: 0,
    done: 0,
    failed: 0,
    waiting: 0,
    active: false,
    complete: false,
  },
  authEnabled: true,
  answers: {},
  answerFields,
  ...extra,
});
// Run the real dashboard script against a test document.
async function load(data, { fetchImpl } = {}) {
  const { window } = parseHTML(fs.readFileSync("public/index.html", "utf8"));
  window.HTMLElement.prototype.focus = function () {};
  window.scrollTo = () => {};
  const context = vm.createContext({
    window,
    document: window.document,
    navigator: { clipboard: { writeText: async () => {} } },
    Intl,
    URL,
    console,
    FormData,
    FileReader: class {},
    setInterval: () => 0,
    setTimeout: () => 0,
    Date,
    location: { reload() {}, origin: "https://example.test" },
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => data })),
  });
  await vm.runInContext(
    "(async()=>{" +
      fs.readFileSync("public/app.js", "utf8") +
      ";globalThis.ui={render,openJob,closeModal,addJob,uploadResume,addSource,guessTrack,confirmForm,scanSummary,scanBanner,setView:v=>{view=v;render()},setAppTab:t=>{view='applications';appTab=t;render()},setState:s=>{state=s;render()}}})()",
    context,
  );
  const doc = window.document;
  return {
    ui: context.ui,
    doc,
    $: (s) => doc.querySelector(s),
    text: () => doc.body.textContent,
    html: () => doc.querySelector("#app").innerHTML,
    modal: () => doc.querySelector("#modal-root"),
  };
}

test("every dashboard view renders without missing data, and resumes sort by file name", async () => {
  const { ui, $, text, html, modal } = await load(state());
  for (const view of [
    "jobs",
    "applications",
    "resumes",
    "companies",
    "settings",
  ]) {
    ui.setView(view);
    assert($("h1"), view + " heading missing");
    assert(!html().includes("undefined"), view + " contains undefined data");
  }
  ui.setAppTab("todo");
  assert(text().includes("Turn on autofill"));
  assert($('a[href="/career-os-extension.zip"]'));
  assert($('[data-apply="job1"]'));
  ui.setView("settings");
  assert($("#answers-form"));
  assert(text().includes("No AI and no paid API"));
  ui.setView("companies");
  assert(text().includes("TEST AUTO"));
  assert(text().includes("Check manually"));
  // Each track's coverage is shown on its own, overall and per company.
  assert(text().includes("Product / APM: 0 open roles at 0 companies"));
  assert(text().includes("Founder’s Office: 0 open roles at 0 companies"));
  assert($('[data-company-filter="HasProduct"]'));
  assert($('[data-company-filter="HasFounders"]'));
  assert(text().includes("Product 0"));
  assert(text().includes("Founder’s Office 0"));
  ui.setView("resumes");
  assert(text().includes("TEST.pdf"));
  assert(text().includes("Drop your Founder’s Office resume here"));
  ui.openJob("job1");
  assert($('[role="dialog"]'));
  assert($('a[href="/api/resumes/resume1"]'));
  assert($('[data-prepare="job1"]'));
  assert(!modal().innerHTML.includes("undefined"));
  ui.closeModal();
  ui.setView("settings");
  for (const fn of ["addJob", "addSource", "uploadResume"]) {
    ui[fn]();
    assert($("form"), fn);
    ui.closeModal();
  }
  assert.equal(ui.guessTrack("Pranav Goldar APM resume.pdf"), "Product");
  assert.equal(
    ui.guessTrack("Pranav Goldar founder office resume.pdf"),
    "Founder’s Office",
  );
  assert.equal(ui.guessTrack("resume-final.pdf"), null);
});

test("Needs my attention lists waiting packets, and the job panel exposes the whole preparation workflow", async () => {
  const { ui, $, text, modal } = await load(
    state({ applications: [application("job1", "Needs my input")] }),
  );
  ui.setAppTab("attention");
  assert(text().includes("Needs my attention"));
  assert(text().includes("Needs my input"), "exact status shown");
  assert(text().includes("Confirm hours"), "next remaining action shown");
  assert(text().includes("No fields have been filled"), "pause reason shown");
  // The main navigation counts what is waiting.
  assert.equal($('.nav [data-view="applications"] .count').textContent, "1");
  ui.openJob("job1");
  const panel = modal();
  assert(panel.textContent.includes("Why this is waiting"));
  assert(
    panel.querySelector('[data-copy="Test Candidate"]'),
    "copy button for a prepared answer",
  );
  assert.equal(
    panel.querySelectorAll("[data-check]").length,
    2,
    "remaining-action checklist",
  );
  assert(panel.querySelector("#resume-override"), "resume override");
  assert(panel.querySelector("#save-resume"));
  assert(panel.querySelector("#eligibility-notes"));
  assert(panel.querySelector("#approve-eligibility"));
  assert(panel.querySelector("#edit-answers"));
  assert(panel.querySelector("[data-mark-applied]"), "record submission");
  assert(panel.querySelector('a[href="/api/resumes/resume1"]'));
  assert(!panel.innerHTML.includes("undefined"));
});

test("every application status is visible with its exact wording; nothing drops off the board", async () => {
  const jobs = statuses.map((_, i) => job("j" + i)),
    applications = statuses.map((status, i) =>
      application("j" + i, status, {
        confirmation: [
          "Applied",
          "Assessment / Interview",
          "Offer",
          "Rejected",
        ].includes(status)
          ? {
              type: "user-confirmed",
              evidence: "TEST ONLY evidence",
              time: stamp,
              submittedAt: "2026-11-14",
              fileId: "file1",
            }
          : null,
      }),
    );
  const { ui, doc, text, modal } = await load(state({ jobs, applications }));
  ui.setAppTab("all");
  assert.equal(doc.querySelectorAll(".board .mini").length, statuses.length);
  for (const status of statuses.filter((s) => s !== "New match"))
    assert(
      [...doc.querySelectorAll(".board .mini .tag")].some(
        (t) => t.textContent === status,
      ),
      status + " missing from the board",
    );
  // An uncertain submission also waits in the attention queue and warns against retrying.
  ui.setAppTab("attention");
  assert(text().includes("Submission uncertain"));
  const uncertain = "j" + statuses.indexOf("Submission uncertain");
  ui.openJob(uncertain);
  assert(modal().textContent.includes("Do not send it again"));
  assert(
    !modal().querySelector(`[data-apply="${uncertain}"]`),
    "no apply button while uncertain",
  );
  assert(
    !modal().querySelector("#remove-packet"),
    "uncertain packets cannot be removed",
  );
  // A recorded submission shows its kind, date, resume version and attachment.
  ui.openJob("j" + statuses.indexOf("Applied"));
  const record = modal().textContent;
  assert(record.includes("user-confirmed"));
  assert(record.includes("Submitted 2026-11-14"));
  assert(record.includes("Product resume v1"));
  assert(modal().querySelector('a[href="/api/evidence/file1"]'));
});

test("recording an application asks for the exact resume, the date and the confirmation", async () => {
  const { ui, modal } = await load(state());
  ui.confirmForm("job1");
  const form = modal().querySelector("#confirm-form");
  assert(form);
  assert(form.querySelector('#confirm-resume option[value="resume1"]'));
  assert(form.querySelector("#confirm-date[required]"));
  assert(form.querySelector("#confirm-text[required]"));
  assert(form.querySelector("#confirm-file"));
  assert(form.textContent.includes("user-confirmed"));
  // With no resume uploaded there is nothing to record against.
  const empty = await load(state({ resumes: [] }));
  empty.ui.confirmForm("job1");
  assert(!empty.modal().querySelector("#confirm-form"));
  assert(empty.modal().textContent.includes("Upload a resume first"));
});

test("a scan that has not finished is never reported as complete", async () => {
  const { ui, text } = await load(
    state({
      scan: {
        startedAt: stamp,
        total: 62,
        done: 40,
        failed: 1,
        waiting: 21,
        active: false,
        complete: false,
      },
      pending: 0,
    }),
  );
  ui.setView("jobs");
  assert.equal(
    ui.scanSummary(),
    "40 of 62 sources checked · 1 failed · 21 still waiting",
  );
  assert(text().includes("Last scan did not finish"));
  assert(text().includes("Continue scan"));
  assert(!/scan (complete|finished)/i.test(text()));
  ui.setState(
    state({
      scan: {
        startedAt: stamp,
        total: 62,
        done: 60,
        failed: 2,
        waiting: 0,
        active: false,
        complete: true,
      },
    }),
  );
  ui.setView("jobs");
  assert(text().includes("60 of 62 sources checked · 2 failed"));
  assert(!text().includes("did not finish"));
});

test("a startup failure names the setting or service at fault", async () => {
  const { text } = await load(null, {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: "Some settings are missing or not valid: TURSO_AUTH_TOKEN.",
        diagnostics: [
          { check: "APP_PASSWORD", ok: true, detail: "Set" },
          {
            check: "TURSO_AUTH_TOKEN",
            ok: false,
            detail: "Missing. Set the database token from Turso.",
          },
        ],
      }),
    }),
  });
  assert(text().includes("The app could not start"));
  assert(text().includes("TURSO_AUTH_TOKEN"));
  assert(text().includes("Missing. Set the database token from Turso."));
});

test("closed and no-longer-matching jobs leave the open lists but stay in history", async () => {
  const jobs = [
    job("open1"),
    job("gone1", { closed: true, closedAt: stamp }),
    job("changed1", {
      unsuitable: "The role no longer matches your target roles.",
    }),
  ];
  const { ui, doc, text } = await load(state({ jobs }));
  ui.setView("jobs");
  assert.equal(doc.querySelectorAll(".jobs .job").length, 1);
  ui.setAppTab("todo");
  assert.equal(doc.querySelectorAll(".jobs .job").length, 1);
  ui.setView("jobs");
  doc
    .querySelector('[data-tab="closed"]')
    .dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
  assert(text().includes("No longer listed"));
  assert(text().includes("No longer matches"));
});

test("strategy has its own category, uses the founder resume and labels unstated start dates", async () => {
  const j = job("strategy", {
    title: "Strategy Analyst",
    location: "Noida",
    employmentType: "Full-time",
    description: "Own strategic initiatives and business planning.",
  });
  const { ui, $, modal } = await load(
    state({ jobs: [j], resumes: [{ ...resume, track: "Founder’s Office" }] }),
  );
  ui.setView("jobs");
  assert($('[data-filter="track"] option[value="Strategy & Operations"]'));
  assert.match($('[data-job="strategy"]').textContent, /Strategy & Operations/);
  assert($('[data-region="Noida"]'));
  ui.openJob("strategy");
  assert.match(modal().textContent, /Start date not stated/);
  assert.match(modal().textContent, /Experience not stated/);
  assert.match(modal().textContent, /Founder’s Office/);
});

test("All India includes remote India and displays priority cities in order", async () => {
  const jobs = [
    "Singapore",
    "Pan India",
    "New Delhi",
    "Hyderabad",
    "Mumbai",
    "Bengaluru",
    "Remote – India",
  ].map((location, i) =>
    job("city" + i, {
      title: "Product Analyst",
      employmentType: "Full-time",
      location,
    }),
  );
  const { ui, $, doc } = await load(state({ jobs }));
  ui.setView("jobs");
  const regions = [...doc.querySelectorAll("[data-region]")].map(
    (b) => b.dataset.region,
  );
  assert.deepEqual(regions.slice(1, 6), [
    "All India",
    "Bangalore",
    "Mumbai",
    "Hyderabad",
    "Delhi",
  ]);
  $('[data-region="All India"]').click();
  assert.equal(doc.querySelectorAll(".jobs .job").length, 6);
  assert(!$('[data-job="city0"]'));
});
