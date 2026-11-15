let packet;
const el = (id) => document.getElementById(id);
el("packet").onchange = async () => {
  try {
    packet = JSON.parse(await el("packet").files[0].text());
    if (
      packet.schema !== "career-os-handoff-v1" ||
      !packet.resume ||
      !packet.profile
    )
      throw new Error("Invalid Career OS packet");
    el("selection").textContent =
      `${packet.company} · ${packet.title}\nResume: ${packet.resume.track} v${packet.resume.version}`;
    el("fill").disabled = false;
  } catch (e) {
    el("selection").textContent = e.message;
    el("fill").disabled = true;
  }
};
el("fill").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const u = new URL(tab.url);
    if (
      ![
        "jobs.lever.co",
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "jobs.ashbyhq.com",
      ].includes(u.hostname)
    )
      throw new Error(
        "Unsupported employer host. Fill the form manually using your packet.",
      );
    const expected = new URL(packet.applyUrl || packet.originalUrl);
    if (
      u.hostname !== expected.hostname ||
      ![
        expected.pathname.replace(/\/$/, ""),
        expected.pathname.replace(/\/$/, "") + "/apply",
      ].includes(u.pathname.replace(/\/$/, ""))
    )
      throw new Error(
        "This tab does not match the packet’s employer application URL. Open its exact application first.",
      );
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [packet],
      func: async (data) => {
        const completed = [],
          remaining = [];
        const profile = data.profile,
          parts = profile.name.trim().split(/\s+/),
          first = parts[0],
          last = parts.slice(1).join(" ");
        const map = [
          ["First name", first, ["first_name", "firstName", "first-name"]],
          ["Last name", last, ["last_name", "lastName", "last-name"]],
          [
            "Full name",
            profile.name,
            ["name", "full_name", "fullName", "name-input"],
          ],
          ["Email", profile.email, ["email", "email_address", "email-input"]],
          ["Phone", profile.phone, ["phone", "phone_number", "phone-input"]],
        ];
        for (const [label, value, names] of map) {
          let input;
          for (const key of names) {
            input = document.querySelector(
              `input[name="${key}"],input[id="${key}"]`,
            );
            if (input) break;
          }
          if (!input || !value) {
            remaining.push(
              label + ": not filled (field not found or value missing)",
            );
            continue;
          }
          if (input.disabled || input.readOnly) {
            remaining.push(label + ": field unavailable");
            continue;
          }
          if (input.value && input.value !== value) {
            remaining.push(
              label + ": existing value preserved; review conflict",
            );
            continue;
          }
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set;
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          completed.push(label + ": filled");
        }
        const input = document.querySelector(
          'input[type="file"][name*="resume" i],input[type="file"][id*="resume" i]',
        );
        if (input && !input.disabled) {
          const bytes = Uint8Array.from(atob(data.resume.base64), (c) =>
            c.charCodeAt(0),
          );
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          )
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (hash !== data.resume.sha256)
            throw new Error("Resume checksum mismatch");
          const dt = new DataTransfer();
          dt.items.add(
            new File([bytes], data.resume.name, { type: data.resume.mime }),
          );
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          completed.push(
            "Resume file assigned to file input; verify the employer upload completed",
          );
        } else remaining.push("Resume not attached: upload it manually");
        remaining.push(
          "Review ALL fields and attachment, answer custom questions and declarations, complete verification, and click final submit yourself.",
        );
        return { completed, remaining };
      },
    });
    const r = results[0].result;
    el("result").textContent =
      "COMPLETED IN THIS TAB\n" +
      r.completed.join("\n") +
      "\n\nREMAINING\n" +
      r.remaining.join("\n");
  } catch (e) {
    el("result").textContent = "Paused: " + e.message;
  }
};
