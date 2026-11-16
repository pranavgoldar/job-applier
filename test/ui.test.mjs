import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { assess, initialProfile } from "../src/matching.mjs";
test("every dashboard view renders, the job drawer links the right resume, and resumes sort by file name", async () => {
  const j = {
    id: "job1",
    company: "TEST FIXTURE COMPANY",
    title: "Product Management Intern",
    location: "Remote India",
    employmentType: "Internship",
    description:
      "Product discovery, roadmap and user research for fintech. No experience required.",
    originalUrl: "https://example.test/job/1",
    applyUrl: "https://example.test/job/1/apply",
    firstSeen: "2026-11-14T10:00:00Z",
    lastChecked: "2026-11-14T10:00:00Z",
    source: "test-fixture",
    active: "TEST FIXTURE",
    activeEvidence: "test only",
  };
  j.assessment = assess(j);
  const resume = {
    id: "resume1",
    track: "Product",
    version: 1,
    name: "TEST.pdf",
    sha256: "abc123",
    created: j.firstSeen,
    is_default: 1,
  };
  const a = {
    id: "app1",
    jobId: j.id,
    resumeId: "resume1",
    resumeSnapshot: resume,
    status: "Needs my input",
    recommendedTrack: "Product",
    resumeReason: "Test responsibilities",
    completed: ["Resume selected"],
    remaining: ["Confirm hours", "Complete employer form"],
    pauseReason: "No fields have been filled in your browser.",
    answers: [{ question: "Name", answer: "Test Candidate", verified: true }],
    checks: [],
    updated: j.firstSeen,
    notes: "",
    eligibilityReviewed: false,
    confirmation: null,
  };
  const data = {
    profile: initialProfile,
    settings: {
      mode: "prepare",
      paused: false,
      intervalHours: 12,
      dailyLimit: 5,
    },
    jobs: [j],
    applications: [a],
    resumes: [resume],
    sources: [],
    companyWatchlist: [
      {
        id: "auto",
        name: "TEST AUTO",
        group: "Your target",
        industry: "Fintech",
        careersUrl: "https://example.test/auto",
        coverage: "Scheduled ATS collection",
        sourceHealth: "Never run",
        fundingStage: "Unknown",
        indiaSignal: "Unknown",
      },
      {
        id: "manual",
        name: "TEST MANUAL",
        group: "Similar firm",
        industry: "Fintech",
        careersUrl: "https://example.test/manual",
        coverage: "Manual review — collector not connected",
        fundingStage: "Unknown",
        indiaSignal: "Unknown",
      },
    ],
    events: [],
    queue: [],
    authEnabled: true,
  };
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
    location: { reload() {} },
    fetch: async () => ({ ok: true, json: async () => data }),
  });
  await vm.runInContext(
    "(async()=>{" +
      fs.readFileSync("public/app.js", "utf8") +
      ";globalThis.ui={render,openJob,closeModal,addJob,uploadResume,addSource,guessTrack,setView:v=>{view=v;render()}}})()",
    context,
  );
  const text = () => window.document.body.textContent;
  for (const view of [
    "jobs",
    "applications",
    "resumes",
    "companies",
    "settings",
  ]) {
    context.ui.setView(view);
    assert(window.document.querySelector("h1"), view + " heading missing");
    assert(
      !window.document.querySelector("#app").innerHTML.includes("undefined"),
      view + " contains undefined data",
    );
  }
  context.ui.setView("jobs");
  assert(text().includes("Product Management Intern"));
  assert(window.document.querySelector('[data-job="job1"]'));
  context.ui.setView("companies");
  assert(text().includes("TEST AUTO"));
  assert(text().includes("TEST MANUAL"));
  assert(text().includes("Check manually"));
  context.ui.setView("resumes");
  assert(text().includes("TEST.pdf"));
  assert(text().includes("Drop your Founder’s Office resume here"));
  context.ui.setView("settings");
  assert(text().includes("No AI and no paid API"));
  context.ui.openJob("job1");
  assert(window.document.querySelector('[role="dialog"]'));
  assert(window.document.querySelector('a[href="/api/resumes/resume1"]'));
  assert(
    window.document.querySelector('a[href="https://example.test/job/1/apply"]'),
  );
  assert(window.document.querySelector("[data-mark-applied]"));
  assert(
    !window.document
      .querySelector("#modal-root")
      .innerHTML.includes("undefined"),
  );
  context.ui.closeModal();
  assert(!window.document.querySelector('[role="dialog"]'));
  for (const fn of ["addJob", "addSource", "uploadResume"]) {
    context.ui[fn]();
    assert(window.document.querySelector("form"), fn);
    context.ui.closeModal();
  }
  assert.equal(
    context.ui.guessTrack("Pranav Goldar APM resume.pdf"),
    "Product",
  );
  assert.equal(
    context.ui.guessTrack("Pranav Goldar founder office resume.pdf"),
    "Founder’s Office",
  );
  assert.equal(context.ui.guessTrack("resume-final.pdf"), null);
});
