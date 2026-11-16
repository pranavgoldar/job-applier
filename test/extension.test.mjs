import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { answerFields } from "../src/answers.mjs";
import { extensionZip } from "../src/zip.mjs";

// Load the real filler into a page built from markup shaped like live forms.
function page(html) {
  const { window } = parseHTML(
    `<!doctype html><html><body>${html}</body></html>`,
  );
  class File {
    constructor(parts, name, options) {
      Object.assign(this, { parts, name, type: options?.type });
    }
  }
  class DataTransfer {
    constructor() {
      const list = [];
      this.items = { add: (f) => list.push(f) };
      this.files = list;
    }
  }
  // linkedom has no mouse events; a plain event carries what the filler needs.
  class MouseEvent extends window.Event {}
  Object.assign(window, { File, DataTransfer, MouseEvent });
  const context = vm.createContext({
    document: window.document,
    setTimeout,
    atob,
    Uint8Array,
    console,
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync("extension/fill.js", "utf8"), context);
  return { window, document: window.document, Fill: context.CareerOsFill };
}
const data = {
  profile: {
    name: "Test Candidate",
    email: "test@example.com",
    phone: "+91 98765 43210",
    education: "Example Institute",
    graduation: "2027-05",
  },
  answers: {
    linkedin: "https://www.linkedin.com/in/test",
    city: "Bengaluru",
    currentCompany: "Example Labs",
    noticePeriod: "Immediate",
    currentCtc: "Student",
    expectedCtc: "As per company standards",
    relocate: "Yes",
    relativeAtCompany: "No",
  },
  resume: {
    name: "Test APM resume.pdf",
    mime: "application/pdf",
    base64: Buffer.from("%PDF-1.7 test").toString("base64"),
  },
};
// Mirrors a Lever application page (jobs.lever.co/…/apply).
const lever = `<form id="application-form">
  <ul>
    <li class="application-question resume"><label><div class="application-label">Resume/CV ✱</div><input id="resume-upload-input" name="resume" type="file"></label></li>
    <li class="application-question"><label><div class="application-label">Full name<span class="required">✱</span></div><div class="application-field"><input type="text" name="name" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Email<span class="required">✱</span></div><div class="application-field"><input type="email" name="email" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Phone ✱</div><div class="application-field"><input type="text" name="phone" required></div></label></li>
    <li class="application-question"><label><div class="application-label">Current location ✱</div><div class="application-field"><input id="location-input" type="text" name="location" required><div class="dropdown-no-results">No location found.</div></div></label></li>
    <li class="application-question"><label><div class="application-label">Current company ✱</div><div class="application-field"><input type="text" name="org" required value="Kept Value Ltd"></div></label></li>
    <li class="application-question"><label><div class="application-label">LinkedIn URL</div><div class="application-field"><input type="text" name="urls[LinkedIn]"></div></label></li>
  </ul>
  <ul>
    <li class="application-question custom-question"><div class="application-label"><div class="text">Ready to relocate to Bangalore in the next 2-3 months?<span class="required">✱</span></div></div><div class="application-field"><ul>
      <li><label><input type="radio" name="cards[a][field0]" value="Yes" required><span class="application-answer-alternative">Yes</span></label></li>
      <li><label><input type="radio" name="cards[a][field0]" value="No" required><span class="application-answer-alternative">No</span></label></li>
      <li><label><input type="radio" name="cards[a][field0]" value="I already reside in Bangalore" required><span class="application-answer-alternative">I already reside in Bangalore</span></label></li>
    </ul></div></li>
    <li class="application-question custom-question"><div class="application-label"><div class="text">Please indicate your experience in number of years<span class="required">✱</span></div></div><div class="application-field"><ul>
      <li><label><input type="radio" name="cards[a][field1]" value="3" required><span class="application-answer-alternative">3</span></label></li>
      <li><label><input type="radio" name="cards[a][field1]" value="4" required><span class="application-answer-alternative">4</span></label></li>
    </ul></div></li>
    <li class="application-question custom-question"><div><div class="application-label full-width textarea"><div class="text">What excites you about us?<span class="required">✱</span></div></div><div class="application-field full-width required-field"><textarea name="cards[a][field2]" required></textarea></div></div></li>
    <li class="application-question custom-question"><div><div class="application-label full-width textarea"><div class="text">What is your current notice period?<span class="required">✱</span></div></div><div class="application-field required-field"><textarea name="cards[a][field3]" required></textarea></div></div></li>
    <li class="application-question custom-question"><div><div class="application-label"><div class="text">What is your expected fixed CTC?<span class="required">✱</span></div></div><div class="application-field required-field"><textarea name="cards[a][field4]" required></textarea></div></div></li>
  </ul>
  <label><input type="checkbox" name="consent[marketing]"> I agree to receive updates</label>
  <button id="btn-submit" type="button">Submit application</button>
</form>`;
test("the filler completes a Lever-style form from saved details and leaves judgement questions to the person", async () => {
  const { document, Fill } = page(lever);
  let submits = 0;
  document
    .getElementById("btn-submit")
    .addEventListener("click", () => submits++);
  document.querySelector("form").addEventListener("submit", () => submits++);
  // Record which choices get clicked (linkedom does not track "checked").
  const clicked = [];
  for (const radio of document.querySelectorAll("input[type=radio]"))
    radio.addEventListener("click", () =>
      clicked.push(radio.name + "=" + radio.value),
    );
  const report = await Fill.fill(data, document);
  const value = (name) => document.querySelector(`[name="${name}"]`).value;
  assert.equal(value("name"), "Test Candidate");
  assert.equal(value("email"), "test@example.com");
  assert.equal(value("phone"), "+91 98765 43210");
  assert.equal(value("location"), "Bengaluru");
  assert.equal(value("urls[LinkedIn]"), "https://www.linkedin.com/in/test");
  assert.equal(value("cards[a][field3]"), "Immediate");
  assert.equal(value("cards[a][field4]"), "As per company standards");
  // A value already on the form is never overwritten.
  assert.equal(value("org"), "Kept Value Ltd");
  // The saved yes/no answer picks the matching radio option only.
  assert.deepEqual(clicked, ["cards[a][field0]=Yes"]);
  // No saved answer fits these, so they are handed to the person.
  assert.equal(value("cards[a][field2]"), "");
  const needs = report.needs.map((n) => n.question);
  assert(
    needs.some((q) => /experience in number of years/.test(q)),
    needs.join("|"),
  );
  assert(needs.some((q) => /What excites you/.test(q)));
  assert.equal(needs.length, 2, needs.join(" | "));
  // Labels are read cleanly, without helper text from the same row.
  assert(report.filled.some((f) => f.question === "Current location"));
  // Resume attached; consent boxes and the submit button are never touched.
  assert.equal(report.resume, "attached");
  assert.equal(
    document.getElementById("resume-upload-input").files[0].name,
    "Test APM resume.pdf",
  );
  assert(!document.querySelector('[name="consent[marketing]"]').checked);
  assert.equal(submits, 0);
});
test("the filler reads Greenhouse-style labels and reports a missing resume", async () => {
  const { document, Fill } = page(`<form>
    <div class="field-wrapper"><label id="first_name-label" for="first_name">First Name<span>*</span></label><input id="first_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label><input id="last_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="question_1">LinkedIn Profile<span>*</span></label><input id="question_1" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="question_2">Please mention your official notice period ?<span>*</span></label><input id="question_2" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label id="question_3-label" for="question_3">Do you have a relative/ family member working currently in the company?<span>*</span></label><div class="select-shell"><div><div class="select__control"><input id="question_3" class="select__input" type="text" role="combobox" aria-labelledby="question_3-label" aria-required="true"></div></div></div></div>
    <div class="field-wrapper"><label for="question_4">Gender<span>*</span></label><input id="question_4" type="text" aria-required="true"></div>
    <button type="submit">Submit application</button></form>`);
  const report = await Fill.fill({ ...data, resume: null }, document);
  assert.equal(document.getElementById("first_name").value, "Test");
  assert.equal(document.getElementById("last_name").value, "Candidate");
  assert.equal(
    document.getElementById("question_1").value,
    "https://www.linkedin.com/in/test",
  );
  assert.equal(document.getElementById("question_2").value, "Immediate");
  // Nothing personal is guessed.
  assert.equal(document.getElementById("question_4").value, "");
  const needs = report.needs.map((n) => n.question);
  assert(needs[0].startsWith("Resume:"));
  assert(needs.includes("Gender"));
  // The dropdown here has no list to pick from, so it is reported, not faked.
  assert(needs.some((q) => /relative/.test(q)));
});
test("a confirmation page is recognised and a form page is not", () => {
  const thanks = page(
    `<h1>Thank you for applying.</h1><p>Your application has been received.</p>`,
  );
  assert.equal(thanks.Fill.detectSubmitted(thanks.document), true);
  const form = page(lever + "<p>Thank you for your interest in us.</p>");
  assert.equal(form.Fill.detectSubmitted(form.document), false);
  const job = page(
    `<h1>Product Analyst</h1><p>We review every application.</p>`,
  );
  assert.equal(job.Fill.detectSubmitted(job.document), false);
});
test("every saved answer has a matching form rule, and the extension package is complete", () => {
  const { Fill } = page("");
  const keys = new Set(Fill.RULES.map((r) => r.key));
  for (const f of answerFields) assert(keys.has(f.id), "no rule for " + f.id);
  for (const r of Fill.RULES.filter((r) => r.yesno))
    assert.equal(
      answerFields.find((f) => f.id === r.key)?.type,
      "yesno",
      r.key,
    );
  const manifest = JSON.parse(
    fs.readFileSync("extension/manifest.json", "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  for (const script of manifest.content_scripts.flatMap((c) => c.js))
    assert(fs.existsSync("extension/" + script), script);
  assert(fs.existsSync("extension/" + manifest.background.service_worker));
  // The filler has no way to press submit.
  for (const f of ["fill.js", "content.js"])
    assert(
      !/\.submit\(\)|requestSubmit/.test(
        fs.readFileSync("extension/" + f, "utf8"),
      ),
      f,
    );
  const zip = extensionZip();
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert(zip.includes(Buffer.from("career-os-extension/manifest.json")));
  assert(zip.includes(Buffer.from("career-os-extension/fill.js")));
});
