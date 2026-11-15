import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";
test("browser handoff fills recognized fields only, preserves conflicting values and never submits", async () => {
  const popup = parseHTML(fs.readFileSync("extension/popup.html", "utf8"));
  const page = parseHTML(
    '<form><input name="first_name"><input name="last_name"><input name="email" value="existing@example.test"><input name="phone"><input name="custom_question"><input type="checkbox" name="legal"><button type="submit">Submit</button></form>',
  );
  let injected = 0,
    submit = 0;
  page.document.querySelector("form").onsubmit = () => {
    submit++;
  };
  const packet = {
    schema: "career-os-handoff-v1",
    company: "TEST FIXTURE",
    title: "TEST ROLE",
    applyUrl: "https://jobs.lever.co/test/role1/apply",
    profile: {
      name: "Test Candidate",
      email: "test@example.test",
      phone: "+910000000000",
    },
    resume: { track: "Product", version: 1 },
  };
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: packet.applyUrl }] },
    scripting: {
      executeScript: async ({ func, args }) => {
        injected++;
        const run = vm.createContext({
          document: page.document,
          HTMLInputElement: page.window.HTMLInputElement,
          Event: page.window.Event,
        });
        return [
          {
            result: await vm.runInContext(
              "(" + func.toString() + ")",
              run,
            )(...args),
          },
        ];
      },
    },
  };
  const context = vm.createContext({ document: popup.document, chrome, URL });
  vm.runInContext(fs.readFileSync("extension/popup.js", "utf8"), context);
  popup.document.getElementById("packet").files = [
    { text: async () => JSON.stringify(packet) },
  ];
  await popup.document.getElementById("packet").onchange();
  await popup.document.getElementById("fill").onclick();
  assert.equal(injected, 1);
  assert.equal(page.document.querySelector("[name=first_name]").value, "Test");
  assert.equal(
    page.document.querySelector("[name=last_name]").value,
    "Candidate",
  );
  assert.equal(
    page.document.querySelector("[name=email]").value,
    "existing@example.test",
  );
  assert.equal(page.document.querySelector("[name=custom_question]").value, "");
  assert.equal(submit, 0);
  assert(
    popup.document
      .getElementById("result")
      .textContent.includes("existing value preserved"),
  );
  assert(
    popup.document
      .getElementById("result")
      .textContent.includes("not attached"),
  );
  chrome.tabs.query = async () => [
    { id: 1, url: "https://jobs.lever.co/test/role12/apply" },
  ];
  await popup.document.getElementById("fill").onclick();
  assert.equal(injected, 1);
  assert(
    popup.document
      .getElementById("result")
      .textContent.includes("does not match"),
  );
  chrome.tabs.query = async () => [
    { id: 1, url: "https://example.test/role1" },
  ];
  await popup.document.getElementById("fill").onclick();
  assert.equal(injected, 1);
  assert(
    popup.document
      .getElementById("result")
      .textContent.includes("Unsupported employer host"),
  );
});
