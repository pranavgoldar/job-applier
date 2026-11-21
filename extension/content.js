// Runs on application pages. Does nothing unless this tab was opened from the
// Career OS dashboard for a specific job (or you pressed "Fill this page").
(async () => {
  // Run once per page. A page with nothing to fill stays open to a later
  // "Fill this page" from the extension button.
  if (globalThis.__careerOsContent) return;
  globalThis.__careerOsContent = "starting";
  let hello;
  try {
    hello = await chrome.runtime.sendMessage({ type: "hello" });
  } catch {
    globalThis.__careerOsContent = false;
    return;
  }
  const packet = hello?.packet;
  if (!packet) {
    globalThis.__careerOsContent = false;
    return;
  }
  globalThis.__careerOsContent = true;
  const Fill = globalThis.CareerOsFill,
    send = (m) => chrome.runtime.sendMessage(m).catch(() => {});
  let reported = false;
  const checkSubmitted = () => {
    if (reported || !Fill.detectSubmitted(document)) return false;
    reported = true;
    send({ type: "submitted", url: location.origin + location.pathname });
    panel({ done: true });
    return true;
  };

  // A small panel in the corner of the page saying what was done and what is left.
  let host;
  function panel({ report, done, waiting }) {
    if (window !== window.top && !report && !done) return;
    host?.remove();
    host = document.createElement("div");
    host.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;all:initial;position:fixed;right:16px;bottom:16px";
    const root = host.attachShadow({ mode: "open" });
    const esc = (s) =>
      String(s).replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      );
    const needs = report?.needs || [];
    root.innerHTML = `<style>
      .box{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;width:320px;max-height:70vh;overflow:auto;background:#17181c;color:#f1f0ec;border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
      b{display:block;font-size:15px;margin-bottom:4px} p{margin:0 0 10px;color:#b9bac1}
      ul{margin:0 0 10px;padding:0;list-style:none} li{padding:6px 8px;border-radius:8px;background:#26272d;margin-bottom:5px;cursor:pointer;font-size:13px}
      li:hover{background:#34353d} .ok{color:#4cc38a} .tag{color:#ff7a52;font-weight:600}
      button{font:inherit;border:0;border-radius:8px;padding:6px 10px;background:#34353d;color:#f1f0ec;cursor:pointer}
      .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
    </style><div class="box">${
      done
        ? `<b class="ok">Application sent</b><p>Career OS is recording ${esc(packet.company)} as applied, with the resume attached here. You can close this tab.</p>`
        : waiting
          ? `<b>Career OS is ready</b><p>Waiting for the application form. If it doesn’t open by itself, press this page’s Apply button and it will be filled.</p>`
          : `<div class="row"><b>Career OS filled ${report.filled.length} field${report.filled.length === 1 ? "" : "s"}</b><button id="x">Hide</button></div>
             <p>${report.resume === "attached" ? "Resume attached. " : report.resume === "kept" ? "Resume already attached. " : ""}${needs.length ? `<span class="tag">${needs.length} left for you:</span>` : `<span class="ok">Nothing left to fill.</span>`}</p>
             <ul>${needs.map((n, i) => `<li data-i="${i}">${esc(n.question.slice(0, 110))}</li>`).join("")}</ul>
             <p>Check everything, then press the page’s Submit button yourself.</p>
             <button id="again">Fill again</button>`
    }</div>`;
    root.getElementById("x")?.addEventListener("click", () => host.remove());
    root.getElementById("again")?.addEventListener("click", run);
    root.querySelectorAll("li").forEach((li) =>
      li.addEventListener("click", () => {
        const el = needs[li.dataset.i]?.el;
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus?.();
      }),
    );
    document.documentElement.appendChild(host);
  }

  // A form worth filling: an upload field, or at least three text fields.
  const hasForm = () =>
    document.querySelector('input[type="file"]') ||
    document.querySelectorAll(
      "input:not([type=hidden]):not([type=search]):not([type=checkbox]):not([type=radio]), textarea",
    ).length >= 3;
  const fieldCount = () =>
    document.querySelectorAll("input:not([type=hidden]), textarea, select")
      .length;
  let lastFields = -1,
    running = false,
    pressedOpen = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      const report = await Fill.fill(packet, document);
      lastFields = fieldCount();
      send({
        type: "filled",
        filled: report.filled.length,
        needs: report.needs.map((n) => n.question),
        resume: report.resume,
      });
      panel({ report });
    } finally {
      running = false;
    }
  }
  if (packet.formSeen && checkSubmitted()) return;
  if (window === window.top) panel({ waiting: true });
  // Watch the page for as long as it is open:
  // - when a form appears, fill it (it may load late, or after you press Apply);
  // - when a multi-step form shows its next step, fill the new fields too
  //   (filling never overwrites what is already there);
  // - when the employer's confirmation appears, record it.
  async function check() {
    if (checkSubmitted()) return;
    if (hasForm()) {
      if (fieldCount() !== lastFields) await run();
      return;
    }
    // No form yet: press the site's own "Apply" button once, if it has one.
    if (!pressedOpen && window === window.top && Fill.openForm(document)) {
      pressedOpen = true;
      panel({ waiting: true });
    }
  }
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(check, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(check, 1200);
})();
