// Career OS dashboard. Plain JavaScript, no framework and no build step.
let state,
  view = "jobs",
  activeJob = null,
  scanning = false;
const filters = {
  tab: "open",
  track: "All",
  type: "All",
  region: "All",
  sector: "All",
  search: "",
  sort: "best",
  company: "All",
};
const PRODUCT = "Product",
  FOUNDERS = "Founder’s Office";
const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)],
  e = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const icons = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  briefcase:
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  board:
    '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  building:
    '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
  settings:
    '<path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5L20 16M20 20v-4h-4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  external:
    '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
};
const icon = (k, size = 17, cls = "") =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k] || ""}</svg>`;

// ---------- small helpers ----------
const DAY = 86400000;
function ago(x) {
  if (!x) return "";
  const days = Math.floor((Date.now() - new Date(x).getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  if (days < 365) return Math.floor(days / 30) + " mo ago";
  return "over a year ago";
}
const when = (x) =>
  x
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(x))
    : "not yet";
const palette = [
  ["#e3f4ec", "#1f8a5b"],
  ["#e6edfb", "#2f5fd0"],
  ["#efe9fb", "#6b46c1"],
  ["#fbf0d9", "#a86400"],
  ["#fde8ef", "#c2255c"],
  ["#e2f3f7", "#0c7c93"],
  ["#fdece6", "#d9480f"],
];
function logo(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = palette[h % palette.length];
  return `<div class="logo" style="background:${bg};color:${fg}">${e(String(name).trim()[0]?.toUpperCase() || "?")}</div>`;
}
const jobFor = (id) => state.jobs.find((j) => j.id === id),
  appFor = (id) => state.applications.find((a) => a.jobId === id);
// Statuses after a submission has been recorded.
const submittedStatuses = [
  "Applied",
  "Assessment / Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
  "Closed",
];
const isApplied = (a) => !!a && submittedStatuses.includes(a.status);
// A packet that exists but is not submitted yet, or whose submission is unclear.
// Anything unrecognised lands here too, so no application can drop out of view.
const inProgress = (a) => !!a && !isApplied(a);
const statusClass = (s) =>
  s === "Submission uncertain" || s === "Rejected"
    ? "warn"
    : ["Applied", "Offer", "Ready for final step"].includes(s)
      ? "fintech"
      : s === "Assessment / Interview"
        ? "product"
        : ["Needs my input", "Preparing", "Submitting"].includes(s)
          ? "founders"
          : "";
const statusTag = (a) =>
  `<span class="tag ${statusClass(a.status)}">${e(a.status)}</span>`;
const nextStep = (a) =>
  (a.remaining || []).filter((_, i) => !(a.checks || []).includes(i))[0] ||
  (a.status === "Submission uncertain"
    ? "Check the employer’s email or your account, then record what you find."
    : "Open the application, submit it, then record the confirmation.");
const isSaved = (j) => ["Saved", "Shortlisted"].includes(j.collection);
const isNew = (j) => Date.now() - new Date(j.firstSeen).getTime() < 2 * DAY;
const jobType = (j) => j.assessment.employmentType || "Other";
const sectorOf = (j) => j.assessment.sector || "Other";
function regionOf(j) {
  return j.assessment.region || "Other";
}
const isRemote = (j) =>
  j.assessment.remote === true ||
  /remote/i.test(j.location || "") ||
  /India remote|Worldwide remote/.test(j.assessment.remoteEligibility || "");
const resumeFor = (t) =>
  state.resumes.find((r) => r.track === t && r.is_default);
const trackLabel = (t) =>
  t === PRODUCT ? "Product / APM" : "Founder’s Office";
function experience(j) {
  return j.assessment.experienceLabel || "Experience not stated";
}
function fit(score) {
  return score >= 80
    ? ["Great match", "var(--good)"]
    : score >= 65
      ? ["Good match", "var(--blue)"]
      : ["Possible", "var(--ink-3)"];
}
function toast(s) {
  const t = $("#toast");
  t.textContent = s;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 4200);
}
async function api(path, body) {
  const r = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const j = await r.json();
  if (!r.ok) {
    if (r.status === 401) login();
    throw Object.assign(new Error(j.error || "Request failed"), {
      diagnostics: j.diagnostics,
    });
  }
  return j;
}
async function refresh(draw = true) {
  try {
    state = await api("state");
    if (draw) render();
  } catch (err) {
    if (!state && err.message !== "Sign in required")
      $("#app").innerHTML = startupProblem(err);
  }
}
// The app could not start: say which setting or service is the problem.
function startupProblem(err) {
  const list = err.diagnostics || [];
  return `<main class="login"><div class="card login-card" style="width:min(560px,100%)"><div class="brand"><span class="brand-mark">c</span>Career OS</div><h1>The app could not start</h1><p class="muted">${e(err.message)}</p>${list.length ? `<ul class="checks" style="margin-top:18px">${list.map((d) => `<li class="${d.ok ? "ok" : "block"}"><b>${e(d.check)}</b>: ${e(d.detail)}</li>`).join("")}</ul><p class="muted small" style="margin-top:16px">Fix the items marked ✕ in your hosting settings, then redeploy. Secret values are never shown here.</p>` : ""}</div></main>`;
}
// Redraw the page, keeping an open job drawer (and its scroll position) in place.
function redraw() {
  const top = $(".drawer")?.scrollTop;
  render();
  if (!activeJob) return;
  if (!jobFor(activeJob)) return closeModal();
  openJob(activeJob);
  if (top && $(".drawer")) $(".drawer").scrollTop = top;
}
// Every change goes through here. With `local`, the screen updates at once and
// the request is sent in the background; if it fails, the server's version is
// restored. Without `local`, the screen updates when the server has answered.
// Requests are sent one at a time, in the order they were made.
let inflight = 0,
  chain = Promise.resolve();
function act(send, { local, done, after } = {}) {
  if (local) {
    local();
    redraw();
    if (done) toast(done);
  }
  inflight++;
  const run = chain.then(async () => {
    try {
      const result = await send();
      if (after) after(result);
      if (!local) {
        await refresh(false);
        redraw();
        if (done) toast(done);
      }
    } catch (err) {
      toast(err.message);
      await refresh(false);
      if (state) redraw();
    } finally {
      inflight--;
    }
  });
  chain = run;
  return run;
}
const stamp = () => new Date().toISOString();
// Actions the server must accept first (it enforces the workflow rules).
const appAction = (jobId, body, done) =>
  act(() => api("applications/" + appFor(jobId).id, body), { done });

// ---------- login ----------
function login() {
  $("#app").innerHTML =
    `<main class="login"><form class="card login-card" id="login-form"><div class="brand"><span class="brand-mark">c</span>Career OS</div><h1>Welcome back</h1><p class="muted">Sign in to see your matched roles.</p><div class="field" style="margin-top:22px"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required></div><p id="login-error" class="error" role="alert"></p><button class="btn primary block">Sign in</button></form></main>`;
  $("#login-form").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api("login", { password: $("#password").value });
      await refresh();
    } catch (err) {
      $("#login-error").textContent = err.message;
    }
  };
}

// ---------- shell ----------
const nav = [
  ["jobs", "briefcase", "Jobs"],
  ["applications", "board", "Applications"],
  ["resumes", "file", "Resumes"],
  ["companies", "building", "Companies"],
];
function render() {
  if (!state) return;
  const pages = {
    jobs: jobsPage,
    applications: applicationsPage,
    resumes: resumesPage,
    companies: companiesPage,
    settings: settingsPage,
  };
  const applied = attention().length;
  $("#app").innerHTML =
    `<header class="topbar"><div class="topbar-inner"><div class="brand"><span class="brand-mark">c</span>Career OS</div><nav class="nav" aria-label="Main">${nav
      .map(
        ([v, k, t]) =>
          `<button data-view="${v}" class="${view === v ? "active" : ""}">${icon(k)}<span>${t}</span>${v === "applications" && applied ? `<span class="count">${applied}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="topbar-actions"><button class="btn sm" data-action="discover" ${scanning ? "disabled" : ""}>${icon("refresh", 15, scanning ? "spin" : "")}<span class="hide-sm">${scanning ? (state.scan?.startedAt ? `Checking… ${state.scan.done + state.scan.failed}/${state.scan.total}` : "Checking job boards…") : "Refresh jobs"}</span></button><button class="icon-btn ${view === "settings" ? "on" : ""}" data-view="settings" aria-label="Settings">${icon("settings", 19)}</button></div></div></header><main class="page">${pages[view]()}</main>`;
}
function head(title, sub, actions = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="head-actions">${actions}</div></div>`;
}

// ---------- jobs ----------
function officeInternship(job) {
  return ["On-site", "Hybrid"].includes(job.assessment.internshipWorkplace);
}
function workplaceTag(job) {
  const label = job.assessment.internshipWorkplace;
  return label ? `<span class="tag">${e(label)}</span>` : "";
}
function comparePreferredJobs(a, b) {
  return (
    b.assessment.parts.location - a.assessment.parts.location ||
    b.assessment.score - a.assessment.score ||
    String(b.firstSeen).localeCompare(String(a.firstSeen))
  );
}
function visibleJobs() {
  const q = filters.search.trim().toLowerCase();
  return state.jobs
    .filter((j) => {
      const a = appFor(j.id);
      const gone = j.closed || j.unsuitable;
      if (filters.tab === "closed") {
        if (!gone) return false;
      } else if (filters.tab === "open") {
        if (j.collection === "Dismissed" || isApplied(a) || gone) return false;
      } else if (filters.tab === "saved") {
        if (!isSaved(j)) return false;
      } else if (filters.tab === "dismissed" && j.collection !== "Dismissed")
        return false;
      if (filters.track !== "All" && j.assessment.category !== filters.track)
        return false;
      if (filters.type !== "All" && jobType(j) !== filters.type) return false;
      if (filters.sector !== "All" && sectorOf(j) !== filters.sector)
        return false;
      if (filters.company !== "All" && j.company !== filters.company)
        return false;
      if (filters.region === "Remote" && !isRemote(j)) return false;
      if (filters.region === "All India" && !j.assessment.matchesIndia)
        return false;
      if (
        !["All", "All India", "Remote"].includes(filters.region) &&
        regionOf(j) !== filters.region
      )
        return false;
      return (
        !q ||
        [j.title, j.company, j.location].join(" ").toLowerCase().includes(q)
      );
    })
    .sort(
      (a, b) =>
        officeInternship(a) - officeInternship(b) ||
        (filters.sort === "newest"
          ? String(b.postedAt || b.firstSeen).localeCompare(
              String(a.postedAt || a.firstSeen),
            )
          : comparePreferredJobs(a, b)),
    );
}
function jobCard(j) {
  const m = j.assessment,
    [, ring] = fit(m.score),
    a = appFor(j.id),
    sector = sectorOf(j);
  return `<article class="card job" data-job="${j.id}" tabindex="0" role="button" aria-label="${e(j.title)} at ${e(j.company)}">${logo(j.company)}<div class="job-main"><div class="job-title"><span>${e(j.title)}</span>${isNew(j) ? '<span class="tag new">New</span>' : ""}</div><div class="job-meta">${e(j.company)} · ${e(j.location)}${j.postedAt ? " · posted " + ago(j.postedAt) : ""}</div><div class="tags"><span class="tag ${sector.toLowerCase()}">${sector}</span><span class="tag ${m.track === PRODUCT ? "product" : "founders"}">${e(m.category || j.unsuitable || m.reason)}</span><span class="tag">${e(jobType(j))}</span>${workplaceTag(j)}<span class="tag">${e(experience(j))}</span>${a ? statusTag(a) : ""}${j.closed ? '<span class="tag warn">No longer listed</span>' : j.unsuitable ? `<span class="tag warn">${e(m.historyOnly ? j.unsuitable : "No longer matches")}</span>` : ""}</div></div><div class="job-side"><div class="score" style="--p:${m.score};--ring:${ring}" title="Match score ${m.score} of 100"><span>${m.score}</span></div><button class="icon-btn ${isSaved(j) ? "on" : ""}" data-save="${j.id}" aria-label="${isSaved(j) ? "Remove from saved" : "Save for later"}" title="${isSaved(j) ? "Saved" : "Save for later"}">${icon("bookmark", 18)}</button>${j.collection === "Dismissed" ? `<button class="icon-btn" data-restore="${j.id}" aria-label="Restore" title="Restore">${icon("undo", 18)}</button>` : `<button class="icon-btn hide-sm" data-dismiss="${j.id}" aria-label="Not interested" title="Not interested">${icon("x", 18)}</button>`}</div></article>`;
}
function setupBanner() {
  const missing = [PRODUCT, FOUNDERS].filter((t) => !resumeFor(t));
  if (missing.length)
    return `<div class="setup"><div><h3>Add your ${missing.length === 2 ? "two resumes" : trackLabel(missing[0]) + " resume"}</h3><p>Each job is paired with the right resume automatically, so it is one click away when you apply.</p></div><button class="btn primary" data-view="resumes">${icon("upload", 15)}Upload</button></div>`;
  if (!state.lastDiscovery)
    return `<div class="setup"><div><h3>Run your first scan</h3><p>Checks every company job board on your list and keeps only early-career Product, Strategy &amp; Operations and Founder’s Office roles in India, Dubai and Singapore.</p></div><button class="btn primary" data-action="discover">${icon("refresh", 15)}Scan now</button></div>`;
  return "";
}
function jobsPage() {
  const open = state.jobs.filter(
      (j) =>
        j.collection !== "Dismissed" &&
        !isApplied(appFor(j.id)) &&
        !j.closed &&
        !j.unsuitable,
    ),
    list = visibleJobs(),
    name = (state.profile.name || "").trim().split(/\s+/)[0],
    count = (fn) => open.filter(fn).length,
    regions = [
      ["All", "Everywhere", open.length],
      ["All India", "All India", count((j) => j.assessment.matchesIndia)],
      ...[
        ...new Set(
          [...open]
            .sort(
              (a, b) =>
                b.assessment.parts.location - a.assessment.parts.location ||
                regionOf(a).localeCompare(regionOf(b)),
            )
            .map(regionOf),
        ),
      ]
        .filter((city) => city !== "Remote")
        .map((city) => [city, city, count((j) => regionOf(j) === city)]),
      ["Remote", "Remote", count(isRemote)],
    ],
    select = (key, options) =>
      `<select data-filter="${key}" aria-label="${key}">${options.map(([v, l]) => `<option value="${e(v)}" ${filters[key] === v ? "selected" : ""}>${e(l)}</option>`).join("")}</select>`;
  return (
    head(
      name ? `Hi ${e(name)}, here are your matches` : "Your matched jobs",
      `${open.length} open role${open.length === 1 ? "" : "s"} from ${state.sources.filter((s) => s.enabled).length} company job boards · last checked ${e(when(state.lastDiscovery))}`,
      `<button class="btn" data-action="add-job">${icon("plus", 15)}Add a job</button>`,
    ) +
    setupBanner() +
    scanBanner() +
    `<div class="stats">${[
      ["open", open.length, "Open matches"],
      ["new", open.filter(isNew).length, "New in last 2 days"],
      ["saved", state.jobs.filter(isSaved).length, "Saved"],
      ["applied", state.applications.filter(isApplied).length, "Applied"],
    ]
      .map(
        ([k, n, l]) =>
          `<button class="stat" data-stat="${k}"><b>${n}</b><span>${l}</span></button>`,
      )
      .join(
        "",
      )}</div><div class="toolbar"><div class="search">${icon("search", 16)}<input id="search" type="search" placeholder="Search role or company" value="${e(filters.search)}" aria-label="Search jobs"></div><div class="seg" role="tablist">${[
      ["open", "Open"],
      ["saved", "Saved"],
      ["dismissed", "Hidden"],
      ["closed", "History"],
    ]
      .map(
        ([v, l]) =>
          `<button data-tab="${v}" class="${filters.tab === v ? "active" : ""}">${l}</button>`,
      )
      .join("")}</div>${select("track", [
      ["All", "All categories"],
      ["Product management", "Product management"],
      ["Strategy & Operations", "Strategy & Operations"],
      [FOUNDERS, "Founder’s Office"],
    ])}${select("type", [
      ["All", "Job + internship"],
      ["Full-time", "Full-time"],
      ["Internship", "Internship"],
    ])}${select("sector", [
      ["All", "All sectors"],
      ["Fintech", "Fintech"],
      ["Consumer", "Consumer"],
      ["Other", "Other"],
    ])}${select("sort", [
      ["best", "Preferred cities"],
      ["newest", "Newest"],
    ])}</div><div class="chips">${regions.map(([v, l, n]) => `<button class="chip ${filters.region === v ? "active" : ""}" data-region="${e(v)}">${e(l)} <i>${n}</i></button>`).join("")}<button class="chip ${filters.type === "Internship" ? "active" : ""}" data-internships>Internships <i>${count((j) => jobType(j) === "Internship")}</i></button>${filters.company !== "All" ? `<button class="chip active" data-clear-company>${e(filters.company)} ✕</button>` : ""}</div><div id="job-list">${jobList(list)}</div>`
  );
}
function jobList(list) {
  if (!list.length)
    return `<div class="card empty"><h3>${state.jobs.length ? "Nothing matches these filters" : "No jobs yet"}</h3><p>${state.jobs.length ? "Try a different location or clear the search." : "Press Refresh jobs to scan every company job board on your list. It takes about a minute."}</p>${state.jobs.length ? '<button class="btn" data-action="reset-filters">Clear filters</button>' : `<button class="btn primary" data-action="discover">${icon("refresh", 15)}Refresh jobs</button>`}</div>`;
  return `<div class="jobs">${list.map(jobCard).join("")}</div><p class="list-foot">${list.length} role${list.length === 1 ? "" : "s"} · Match score weighs role, experience needed, sector and location. It is a guide, not a prediction.</p>`;
}

// ---------- applications ----------
function miniCard(j, a) {
  return `<div class="card mini" data-job="${j.id}" tabindex="0" role="button"><b>${e(j.title)}</b><small>${e(j.company)} · updated ${ago(a.updated)}</small><div class="tags">${statusTag(a)}${a.resumeSnapshot ? `<span class="tag">${e(a.resumeSnapshot.track)} v${a.resumeSnapshot.version}</span>` : '<span class="tag warn">No resume recorded</span>'}${a.followUp ? `<span class="tag founders">Follow up ${e(a.followUp)}</span>` : ""}</div></div>`;
}
function attentionCard(a) {
  const j = jobFor(a.jobId),
    r = a.resumeSnapshot,
    locked = ["Submitting", "Submission uncertain"].includes(a.status);
  return `<article class="card attention"><div class="spread"><div class="row" style="flex-wrap:nowrap;min-width:0">${logo(j.company)}<div style="min-width:0"><h3>${e(j.title)}</h3><div class="muted small">${e(j.company)} · ${e(j.location)}</div></div></div>${statusTag(a)}</div><p><b>What’s left:</b> ${e(nextStep(a))}</p>${a.pauseReason ? `<p class="muted small">${e(a.pauseReason)}</p>` : ""}<div class="spread"><span class="muted small">${r ? `${e(r.track)} resume · version ${r.version}` : "No resume selected"} · last activity ${ago(a.updated)}</span><div class="row"><button class="btn primary sm" data-job="${j.id}">Review &amp; finish</button>${locked ? "" : `<button class="btn sm" data-apply="${j.id}">${icon("external", 14)}Open application</button>`}${a.resumeId ? `<a class="btn sm" href="/api/resumes/${a.resumeId}">${icon("download", 14)}Resume</a>` : ""}</div></div></article>`;
}
let appTab = "todo";
// Jobs with nothing started yet.
const openJobs = () =>
  state.jobs.filter(
    (j) =>
      j.collection !== "Dismissed" &&
      !appFor(j.id) &&
      !j.closed &&
      !j.unsuitable,
  );
const attention = () =>
  state.applications.filter((a) => inProgress(a) && jobFor(a.jobId));
function extensionCard() {
  if (extVersion())
    return `<div class="callout row"><span class="dot live"></span><span><b>Autofill is connected.</b> Press Apply on a job: the form opens in a new tab, filled in, with your resume attached. Check it and press Submit there.</span></div>`;
  return `<div class="setup" style="align-items:flex-start"><div><h3>Turn on autofill (one-time, about 2 minutes)</h3><p>A small Chrome extension fills each application form for you: name, email, phone, resume and your saved answers. You check the form and press Submit. Until it is installed, Apply just opens the company page.</p><div class="steps" style="margin-top:14px"><div><b>Download and unzip</b>Save the file below and unzip it. You get a folder called career-os-extension.</div><div><b>Open Chrome’s extensions page</b>Type <b>chrome://extensions</b> in the address bar and switch on <b>Developer mode</b> (top right).</div><div><b>Load it</b>Click <b>Load unpacked</b> and choose the career-os-extension folder.</div><div><b>Refresh this page</b>This box turns green when the extension is connected.</div></div></div><a class="btn primary" href="/career-os-extension.zip" download>${icon("download", 15)}Download extension</a></div>`;
}
function applyRow(j) {
  const m = j.assessment,
    sector = sectorOf(j),
    asked = !!j.applyOpened;
  return `<article class="card job" data-job="${j.id}" tabindex="0" role="button" aria-label="${e(j.title)} at ${e(j.company)}">${logo(j.company)}<div class="job-main"><div class="job-title"><span>${e(j.title)}</span>${isSaved(j) ? '<span class="tag founders">Saved</span>' : ""}</div><div class="job-meta">${e(j.company)} · ${e(j.location)}</div><div class="tags"><span class="tag ${sector.toLowerCase()}">${sector}</span><span class="tag ${m.track === PRODUCT ? "product" : "founders"}">${trackLabel(m.track)} resume</span>${workplaceTag(j)}<span class="tag">${m.score}/100 match</span>${asked ? `<span class="tag warn">Opened ${ago(j.applyOpened)} · did you submit?</span>` : ""}</div></div><div class="job-side">${asked ? `<button class="btn sm" data-mark-applied="${j.id}">${icon("check", 14)}Yes, record it</button><button class="btn ghost sm" data-not-yet="${j.id}">Not yet</button>` : ""}<button class="btn accent sm" data-apply="${j.id}">${icon("external", 14)}${asked ? "Open again" : "Apply"}</button><button class="icon-btn hide-sm" data-dismiss="${j.id}" aria-label="Not interested" title="Not interested">${icon("x", 18)}</button></div></article>`;
}
function applicationsPage() {
  const apps = state.applications
      .map((a) => [jobFor(a.jobId), a])
      .filter(([j]) => j),
    todo = openJobs().sort(
      (a, b) =>
        officeInternship(a) - officeInternship(b) ||
        !!b.applyOpened - !!a.applyOpened ||
        isSaved(b) - isSaved(a) ||
        comparePreferredJobs(a, b),
    ),
    waiting = attention(),
    missing = ["name", "email", "phone"].filter((k) => !state.profile[k]),
    // Every application sits in exactly one column, with its exact status shown.
    cols = [
      [
        "In progress",
        apps.filter(([, a]) => inProgress(a)),
        "Prepared packets and unclear submissions.",
      ],
      [
        "Applied",
        apps.filter(([, a]) => a.status === "Applied"),
        "Recorded submissions land here.",
      ],
      [
        "Interviewing",
        apps.filter(([, a]) => a.status === "Assessment / Interview"),
        "Move a card here when you hear back.",
      ],
      [
        "Outcome",
        apps.filter(([, a]) =>
          ["Offer", "Rejected", "Withdrawn", "Closed"].includes(a.status),
        ),
        "Offers and closed applications.",
      ],
    ];
  return (
    head(
      "Applications",
      "Apply from To apply. Anything waiting on you is under Needs my attention. Every application and its exact status is under All applications.",
      `<a class="btn" href="/api/export">${icon("download", 15)}Export CSV</a>`,
    ) +
    `<div class="toolbar"><div class="seg" role="tablist">${[
      ["todo", `To apply <i>${todo.length}</i>`],
      ["attention", `Needs my attention <i>${waiting.length}</i>`],
      ["all", `All applications <i>${apps.length}</i>`],
    ]
      .map(
        ([v, l]) =>
          `<button data-app-tab="${v}" class="${appTab === v ? "active" : ""}">${l}</button>`,
      )
      .join("")}</div></div>` +
    (appTab === "todo"
      ? extensionCard() +
        (missing.length
          ? `<div class="callout spread" style="margin-top:12px"><span>Add your ${missing.join(", ")} so forms can be filled in.</span><button class="btn sm" data-view="settings">Open Settings</button></div>`
          : "") +
        `<div class="jobs" style="margin-top:16px">${todo.map(applyRow).join("") || `<div class="card empty"><h3>Nothing waiting</h3><p>New matches show up here after each scan.</p></div>`}</div>`
      : appTab === "attention"
        ? `<div class="jobs">${waiting.map(attentionCard).join("") || `<div class="card empty"><h3>You’re all caught up</h3><p>When an application needs a decision, a check or its final submission, its packet appears here with what is left to do.</p></div>`}</div>`
        : `<div class="board">${cols.map(([t, rows, hint]) => `<section class="col"><div class="col-head">${t}<span>${rows.length}</span></div>${rows.map(([j, a]) => miniCard(j, a)).join("") || `<div class="col-empty">${hint}</div>`}</section>`).join("")}</div>`)
  );
}

// ---------- autofill extension ----------
// The extension's bridge script marks the page and relays messages both ways.
const extVersion = () =>
  document.documentElement?.dataset?.careerOsExtension || null;
let extSeq = 0;
const extWaiting = new Map();
function ext(message) {
  return new Promise((resolve, reject) => {
    const id = ++extSeq;
    extWaiting.set(id, resolve);
    window.postMessage(
      { target: "career-os-extension", id, message },
      location.origin,
    );
    setTimeout(() => {
      if (extWaiting.delete(id))
        reject(
          new Error(
            "The autofill extension did not answer. Refresh this page.",
          ),
        );
    }, 8000);
  });
}
// Jobs the extension saw you submit. Recorded as "browser-detected", with the
// resume the extension attached. If it attached none, you confirm it yourself.
function collectResults(results = []) {
  if (!state || !results.length) return;
  for (const r of results) {
    const j = jobFor(r.jobId);
    if (!j || isApplied(appFor(j.id))) continue;
    if (r.resumeId)
      act(
        () =>
          api(`jobs/${j.id}/confirm`, {
            detected: true,
            resumeId: r.resumeId,
            url: r.url,
          }),
        {
          done: `Applied to ${j.company}. Recorded with the resume that was attached.`,
        },
      );
    else
      toast(
        `It looks like you applied to ${j.company}. Record it under Applications so the resume you sent is saved.`,
      );
  }
  ext({ type: "ack", jobIds: results.map((r) => r.jobId) }).catch(() => {});
}
const askResults = () =>
  extVersion() &&
  ext({ type: "results" })
    .then((r) => collectResults(r?.results))
    .catch(() => {});
window.addEventListener?.("message", (ev) => {
  const d = ev.data;
  if (ev.source !== window || d?.source !== "career-os-extension") return;
  if (d.id && extWaiting.has(d.id)) {
    extWaiting.get(d.id)(d.reply);
    extWaiting.delete(d.id);
  }
  if (d.type === "results") collectResults(d.results);
});
window.addEventListener?.("focus", askResults);
async function applyTo(id) {
  const j = jobFor(id),
    url = j.applyUrl || j.originalUrl,
    opened = () =>
      act(() => api(`jobs/${id}/opened`, {}), {
        local: () => (j.applyOpened = stamp()),
      });
  if (!extVersion()) {
    window.open(url, "_blank", "noopener");
    return opened();
  }
  toast("Opening the form and filling it in…");
  try {
    const reply = await ext({
      type: "apply",
      packet: await api("autofill/" + id),
    });
    if (reply?.error) throw new Error(reply.error);
    opened();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- resumes ----------
function resumeSlot(t) {
  const versions = state.resumes
      .filter((r) => r.track === t)
      .sort((a, b) => b.version - a.version),
    current = versions.find((r) => r.is_default) || versions[0],
    used = state.applications.filter(
      (a) => a.resumeSnapshot?.track === t,
    ).length,
    matches = state.jobs.filter(
      (j) => j.assessment.track === t && j.collection !== "Dismissed",
    ).length;
  return `<section class="card card-pad stack" data-drop="${e(t)}"><div class="spread"><div><h2>${trackLabel(t)} resume</h2><p class="muted small">${t === PRODUCT ? "Sent with APM, Product Analyst and Product intern roles." : "Sent with Founder’s Office, Strategy and BizOps roles."}</p></div><span class="tag ${t === PRODUCT ? "product" : "founders"}">${matches} job${matches === 1 ? "" : "s"}</span></div>${
    current
      ? `<div class="file"><div class="file-icon">${/\.docx$/i.test(current.name) ? "DOCX" : "PDF"}</div><div style="flex:1;min-width:0"><div class="file-name">${e(current.name)}</div><div class="muted small">Version ${current.version} · uploaded ${ago(current.created)}${used ? ` · used in ${used} application${used === 1 ? "" : "s"}` : ""}</div></div></div><div class="row"><a class="btn sm" href="/api/resumes/${current.id}?preview=1" target="_blank" rel="noopener">${icon("external", 14)}Preview</a><a class="btn sm" href="/api/resumes/${current.id}">${icon("download", 14)}Download</a><button class="btn sm" data-upload="${e(t)}">${icon("upload", 14)}Replace</button></div>${
          versions.length > 1
            ? `<details><summary>${versions.length - 1} older version${versions.length === 2 ? "" : "s"}</summary>${versions
                .filter((r) => r.id !== current.id)
                .map(
                  (r) =>
                    `<div class="history-row"><span>v${r.version} · ${e(r.name)}</span><a href="/api/resumes/${r.id}">Download</a></div>`,
                )
                .join("")}</details>`
            : ""
        }`
      : `<div class="drop" data-upload="${e(t)}" tabindex="0" role="button">${icon("upload", 22)}<b>Drop your ${trackLabel(t)} resume here</b>or click to choose a PDF or DOCX</div>`
  }</section>`;
}
function resumesPage() {
  return (
    head(
      "Resumes",
      "Keep one resume per track. Every matched job is paired with the right one.",
      `<button class="btn primary" data-upload="">${icon("upload", 15)}Upload resume</button>`,
    ) +
    `<div class="resume-grid">${resumeSlot(PRODUCT)}${resumeSlot(FOUNDERS)}</div><div class="callout" style="margin-top:16px"><b>Tip:</b> name your files clearly and they sort themselves. A file with <b>APM</b> or <b>Product</b> in its name goes to Product, one with <b>Founder</b> goes to Founder’s Office. Uploading again keeps the old version, so past applications still show what you sent.</div><input type="file" id="resume-input" accept=".pdf,.docx" hidden>`
  );
}
function guessTrack(name = "") {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " "),
    f =
      /founder|\bfo\b|chief of staff|\bcos\b|strategy|biz ?ops|business|generalist/.test(
        n,
      ),
    p = /\bapm\b|\bpm\b|product/.test(n);
  return f && !p ? FOUNDERS : p && !f ? PRODUCT : null;
}
async function filePayload(file) {
  if (file.size > (state?.maxUploadBytes || 8 * 1024 * 1024))
    throw new Error(
      `File is too large. The limit is ${state.runtime === "vercel" ? 3 : 8} MB.`,
    );
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mime: /\.docx$/i.test(file.name)
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : file.type || "application/pdf",
    base64,
  };
}
async function saveResume(file, track) {
  if (!file) return;
  if (!/\.(pdf|docx)$/i.test(file.name))
    return toast("Please choose a PDF or DOCX file.");
  track ||= guessTrack(file.name);
  if (!track) return uploadResume(file);
  toast(`Uploading ${file.name}…`);
  await act(
    async () => api("resumes", { track, ...(await filePayload(file)) }),
    { done: `Saved as your ${trackLabel(track)} resume.` },
  );
}
let pendingTrack = "";
function uploadResume(file) {
  if (!file) {
    // No file yet: open the picker. The track is guessed from the file name.
    const input = $("#resume-input");
    if (input) return input.click();
  }
  modal(
    "Which resume is this?",
    `<form id="resume-form" class="stack"><p class="muted">${file ? `I could not tell from the name “${e(file.name)}”.` : "Choose the track and the file."}</p><div class="field"><label for="resume-track">Use it for</label><select id="resume-track" style="width:100%"><option value="${PRODUCT}">Product / APM roles</option><option value="${FOUNDERS}">Founder’s Office roles</option></select></div>${file ? "" : '<div class="field"><label for="resume-file">PDF or DOCX</label><input id="resume-file" type="file" accept=".pdf,.docx" required style="height:auto;padding:8px"></div>'}<button class="btn primary block">Save resume</button></form>`,
  );
  $("#resume-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const chosen = file || $("#resume-file").files[0],
      track = $("#resume-track").value;
    closeModal();
    await saveResume(chosen, track);
  };
}

// ---------- companies ----------
function companyStatus(c) {
  if (c.sourceHealth === "Manual") return ["", "Manual check", c.sourceError];
  if (!c.sourceId) return ["manual", "Check manually", ""];
  if (!c.sourceEnabled) return ["", "Paused", ""];
  if (c.sourceHealth === "Error")
    return ["error", "Could not reach board", c.sourceError || ""];
  if (c.sourceHealth === "Healthy")
    return [
      "live",
      `Checked ${ago(c.sourceLastRun)}${c.sourceCount ? "" : " · no matching roles right now"}`,
      "",
    ];
  return ["", "Waiting for first scan", ""];
}
let companyFilter = "All";
// Sourced facts about a company. Anything without a source is shown as not verified.
function evidence(c) {
  const known = (s) => s && !/^(Unknown|Not )/.test(s),
    row = (label, text, url) =>
      `<div class="evidence-row"><span>${label}</span><span>${e(text)}${url ? ` <a href="${e(url)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : ""}</span></div>`;
  if (!c.fundingStage && !c.indiaSignal && !c.note) return "";
  return `<details class="evidence"><summary>Evidence</summary>${row("Funding", known(c.fundingStage) ? c.fundingStage : "Not verified", c.fundingEvidenceUrl)}${row("India", known(c.indiaSignal) ? c.indiaSignal : "Not verified", c.indiaEvidenceUrl)}${row("YC", c.ycBacked === true ? `Yes, ${c.ycBatch || "batch not recorded"}` : "Not verified", c.ycBacked === true ? c.ycEvidenceUrl : null)}${c.note ? row("Note", c.note) : ""}${c.checkedOn ? row("Checked", c.checkedOn) : ""}</details>`;
}
function companiesPage() {
  const watched = state.companyWatchlist || [],
    known = new Set(watched.map((c) => c.sourceId).filter(Boolean)),
    extra = state.sources
      .filter((s) => !known.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.company,
        industry: "Added by you",
        sourceId: s.id,
        sourceEnabled: !!s.enabled,
        sourceHealth: s.health,
        sourceCount: s.count,
        sourceError: s.error,
        sourceLastRun: s.last_run,
        connector: { kind: s.kind },
      })),
    all = [...watched, ...extra],
    sector = (c) =>
      /^fintech/i.test(c.industry)
        ? "Fintech"
        : /^consumer/i.test(c.industry)
          ? "Consumer"
          : "Other",
    matches = (company, category) =>
      state.jobs.filter(
        (j) =>
          j.company === company.name &&
          j.assessment.category === category &&
          j.collection !== "Dismissed" &&
          !j.closed &&
          !j.unsuitable,
      ).length,
    shown = all
      .filter((c) =>
        companyFilter === "All"
          ? true
          : companyFilter === "HasProduct"
            ? matches(c, "Product management") > 0
            : companyFilter === "HasStrategy"
              ? matches(c, "Strategy & Operations") > 0
              : companyFilter === "HasFounders"
                ? matches(c, FOUNDERS) > 0
                : companyFilter === "YC"
                  ? c.ycBacked === true
                  : companyFilter === "Manual"
                    ? !c.sourceId
                    : companyFilter === "Auto"
                      ? !!c.sourceId
                      : sector(c) === companyFilter,
      )
      .sort(
        (a, b) =>
          !!b.sourceId - !!a.sourceId ||
          (b.sourceCount || 0) - (a.sourceCount || 0) ||
          a.name.localeCompare(b.name),
      ),
    auto = all.filter((c) => c.sourceId).length,
    coverage = (category, label) => {
      const counts = all.map((c) => matches(c, category)).filter(Boolean);
      const n = counts.reduce((a, b) => a + b, 0);
      return `<div class="stat" style="cursor:default"><b>${counts.length}</b><span>${e(label)}: ${n} open role${n === 1 ? "" : "s"} at ${counts.length} compan${counts.length === 1 ? "y" : "ies"}</span></div>`;
    };
  return (
    head(
      "Companies",
      `${auto} companies are checked automatically. ${all.length - auto} more have no public job feed and need a manual look.`,
      `<button class="btn primary" data-action="add-source">${icon("plus", 15)}Add company</button>`,
    ) +
    `<div class="stats">${coverage("Product management", "Product / APM")}${coverage("Strategy & Operations", "Strategy & Operations")}${coverage(FOUNDERS, FOUNDERS)}</div>` +
    `<div class="chips">${[
      ["All", "All"],
      ["Fintech", "Fintech"],
      ["Consumer", "Consumer"],
      ["Auto", "Checked automatically"],
      ["Manual", "Check manually"],
      ["HasProduct", "Has Product roles"],
      ["HasStrategy", "Has Strategy & Operations roles"],
      ["HasFounders", "Has Founder’s Office roles"],
      ["YC", "YC-backed"],
    ]
      .map(
        ([v, l]) =>
          `<button class="chip ${companyFilter === v ? "active" : ""}" data-company-filter="${v}">${l}</button>`,
      )
      .join("")}</div><div class="company-grid">${shown
      .map((c) => {
        const [dot, label, err] = companyStatus(c);
        return `<div class="card company"><div class="company-top">${logo(c.name)}<div style="flex:1;min-width:0"><div class="company-name">${e(c.name)}</div><div class="muted small">${e(String(c.industry || "").replace(/^(Fintech|Consumer|Software|Job feed)\s*\/\s*/i, ""))}</div></div>${c.sourceId ? `<button class="switch ${c.sourceEnabled ? "on" : ""}" data-source="${e(c.sourceId)}" data-enabled="${c.sourceEnabled ? "0" : "1"}" role="switch" aria-checked="${!!c.sourceEnabled}" aria-label="Check ${e(c.name)} automatically"></button>` : ""}</div><span class="status" title="${e(err)}"><span class="dot ${dot}"></span>${e(label)}</span><div class="tags"><span class="tag ${matches(c, "Product management") ? "product" : ""}">Product ${matches(c, "Product management")}</span><span class="tag">Strategy &amp; Operations ${matches(c, "Strategy & Operations")}</span><span class="tag ${matches(c, FOUNDERS) ? "founders" : ""}">Founder’s Office ${matches(c, FOUNDERS)}</span>${c.ycBacked === true ? `<a class="tag fintech" href="${e(c.ycEvidenceUrl)}" target="_blank" rel="noopener noreferrer" title="Listed in the YC directory">YC ${e((c.ycBatch || "").replace(/^(Winter|Summer|Fall|Spring) 20/, (m) => m[0]))}</a>` : ""}</div>${evidence(c)}<div class="company-links">${c.sourceCount ? `<button class="link" data-company-jobs="${e(c.name)}">View ${c.sourceCount} job${c.sourceCount === 1 ? "" : "s"}</button>` : ""}${c.careersUrl ? `<a class="link" href="${e(c.careersUrl)}" target="_blank" rel="noopener noreferrer">Careers page ↗</a>` : ""}</div></div>`;
      })
      .join("")}</div>`
  );
}

// ---------- settings ----------
function field(name, label, value, type = "text", full = false) {
  return `<div class="field ${full ? "full" : ""}"><label for="${name}">${label}</label>${type === "textarea" ? `<textarea id="${name}" name="${name}">${e(value)}</textarea>` : `<input id="${name}" name="${name}" type="${type}" value="${e(value)}">`}</div>`;
}
function settingsPage() {
  const p = state.profile,
    s = state.settings;
  return (
    head("Settings", "Your details, the daily scan and how it all works.") +
    `<div class="settings-grid"><div class="stack"><form id="profile-form" class="card card-pad stack"><div class="spread"><h2>Your details</h2><button class="btn primary sm">Save</button></div><div class="form-grid">${field("name", "Full name", p.name)}${field("email", "Email", p.email, "email")}${field("phone", "Phone", p.phone)}${field("location", "Based in", p.location)}${field("education", "College and degree", p.education, "text", true)}${field("graduation", "Graduating (YYYY-MM)", p.graduation)}${field("fullTimeStart", "Can join full-time from", p.fullTimeStart, "date")}${field("experience", "Experience summary", p.experience, "textarea", true)}</div></form><form id="answers-form" class="card card-pad stack"><div class="spread"><div><h2>Application answers</h2><p class="muted small">Forms keep asking these. Save them once and autofill uses them. Leave anything blank to answer it yourself each time.</p></div><button class="btn primary sm">Save</button></div><div class="form-grid">${(state.answerFields || []).map((f) => (f.type === "yesno" ? `<div class="field"><label for="ans-${f.id}">${e(f.label)}</label><select id="ans-${f.id}" name="${f.id}" style="width:100%">${["", "Yes", "No"].map((v) => `<option value="${v}" ${(state.answers?.[f.id] || "") === v ? "selected" : ""}>${v || "Ask me each time"}</option>`).join("")}</select></div>` : `<div class="field"><label for="ans-${f.id}">${e(f.label)}</label><input id="ans-${f.id}" name="${f.id}" type="text" placeholder="${e(f.hint || "")}" value="${e(state.answers?.[f.id] || "")}"></div>`)).join("")}</div></form><section class="card card-pad"><h2 style="margin-bottom:10px">Recent activity</h2>${
      state.events
        .filter((ev) => !["preparing", "handoff", "settings"].includes(ev.kind))
        .slice(0, 12)
        .map(
          (ev) =>
            `<div class="log-row"><span>${e(ev.message)}</span><time>${e(when(ev.created))}</time></div>`,
        )
        .join("") || '<p class="muted small">Nothing yet.</p>'
    }</section></div><div class="stack"><section class="card card-pad stack"><h2>Daily scan</h2><div class="spread"><div><b>${s.paused ? "Paused" : "On"}</b><div class="muted small">${s.paused ? "Jobs only update when you press Refresh." : state.runtime === "vercel" ? "Runs every morning around 8:30 to 9:30 IST." : `Runs every ${s.intervalHours} hours while the server is on.`}</div></div><button class="switch ${s.paused ? "" : "on"}" data-action="toggle-pause" role="switch" aria-checked="${!s.paused}" aria-label="Daily scan"></button></div><div class="callout">Last scan ${e(when(state.lastDiscovery))}${s.paused ? "" : ` · next ${e(when(state.nextDiscovery))}`}</div></section><section class="card card-pad stack"><h2>Autofill</h2>${extensionCard()}</section><section class="card card-pad stack"><h2>How it works</h2><div class="steps"><div><b>Reads company job boards directly</b>Each company on your list publishes its openings through a public feed. The scan reads those feeds. No AI and no paid API.</div><div><b>Keeps only roles for you</b>Product and Founder’s Office titles plus business-side internships, in India, Dubai or Singapore or remote, that ask for two years of experience or less.</div><div><b>Scores and pairs a resume</b>Each role is scored on fit, sector and city, then paired with your Product or Founder’s Office resume.</div><div><b>Autofill, you press Submit</b>With the Chrome extension, Apply opens the form already filled in with your resume attached. Job sites require a person to press Submit, so that part is yours. The job then moves to Applied by itself.</div></div></section><section class="card card-pad stack"><h2>Account</h2><div class="row"><a class="btn sm" href="/api/export">${icon("download", 14)}Export CSV</a>${state.authEnabled ? '<button class="btn sm" data-action="logout">Sign out</button>' : ""}</div><p class="muted small">Career OS ${e(state.version || "")}</p></section></div></div>`
  );
}

// ---------- drawer and dialogs ----------
let previousFocus;
function sheet(kind, label, html) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="overlay ${kind === "dialog" ? "center" : ""}"><section class="${kind}" role="dialog" aria-modal="true" aria-label="${e(label)}" tabindex="-1">${html}</section></div>`;
  document.body.style.overflow = "hidden";
  $(".overlay", root).onclick = (ev) => {
    if (ev.target.classList.contains("overlay")) closeModal();
  };
  $('[role="dialog"]', root).focus();
}
function modal(title, content) {
  if (!$('[role="dialog"]')) previousFocus = document.activeElement;
  activeJob = null;
  sheet(
    "dialog",
    title,
    `<header class="sheet-head spread"><h2>${e(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon("x")}</button></header><div class="sheet-body">${content}</div>`,
  );
}
function closeModal() {
  const old = previousFocus;
  $("#modal-root").innerHTML = "";
  document.body.style.overflow = "";
  activeJob = null;
  old?.focus?.();
}
const partNames = {
  role: ["Role fit", 30],
  seniority: ["Experience", 20],
  industry: ["Sector", 20],
  location: ["Location", 20],
  evidence: ["Job details", 10],
  skills: ["Skills", 15],
};
// The full application packet: what stands between this job and a recorded submission.
function packetSections(j, a) {
  const m = j.assessment,
    locked =
      isApplied(a) || ["Submitting", "Submission uncertain"].includes(a.status),
    c = a.confirmation,
    remaining = a.remaining || [],
    timeline = state.events.filter((ev) => ev.app_id === a.id);
  return `${a.status === "Submission uncertain" ? '<div class="banner">This submission may or may not have gone through. Do not send it again. Check the employer’s email or your account, then record what you find below.</div>' : ""}<section><div class="spread"><h3>Application status</h3>${statusTag(a)}</div>${a.pauseReason && !isApplied(a) ? `<div class="callout"><b>Why this is waiting:</b> ${e(a.pauseReason)}</div>` : ""}</section><section><h3>${locked ? "Resume sent" : "Resume to send"}</h3>${
    a.resumeSnapshot
      ? `<div class="file"><div class="file-icon">${/\.docx$/i.test(a.resumeSnapshot.name) ? "DOCX" : "PDF"}</div><div style="flex:1;min-width:0"><div class="file-name">${e(a.resumeSnapshot.name)}</div><div class="muted small">${trackLabel(a.resumeSnapshot.track)} · version ${a.resumeSnapshot.version}</div></div><a class="btn sm" href="/api/resumes/${a.resumeSnapshot.id}">${icon("download", 14)}Download</a></div>`
      : `<div class="callout spread"><span>No resume is selected for this application.</span><button class="btn sm" data-view="resumes">Upload</button></div>`
  }<p class="muted small" style="margin-top:8px">${e(a.resumeReason || m.reason || "")}</p>${
    !locked && state.resumes.length
      ? `<div class="row" style="margin-top:8px"><select id="resume-override" aria-label="Choose resume version" style="flex:1">${state.resumes
          .slice()
          .sort(
            (x, y) => x.track.localeCompare(y.track) || y.version - x.version,
          )
          .map(
            (r) =>
              `<option value="${r.id}" ${a.resumeId === r.id ? "selected" : ""}>${e(trackLabel(r.track))} · v${r.version} · ${e(r.name)}</option>`,
          )
          .join(
            "",
          )}</select><button class="btn sm" id="save-resume">Use this resume</button></div>`
      : ""
  }</section>${
    isApplied(a)
      ? ""
      : `<section><h3>What’s left</h3>${remaining.length ? remaining.map((t, i) => `<label class="check"><input type="checkbox" data-check="${i}" ${(a.checks || []).includes(i) ? "checked" : ""}><span>${e(t)}</span></label>`).join("") : '<p class="muted small">No remaining steps recorded.</p>'}${(a.completed || []).length ? `<details style="margin-top:10px"><summary>Already done (${a.completed.length})</summary><ul class="checks">${a.completed.map((t) => `<li class="ok">${e(t)}</li>`).join("")}</ul></details>` : ""}${
          !a.eligibilityReviewed && !locked
            ? `<div class="field" style="margin-top:14px"><label for="eligibility-notes">Eligibility review</label><textarea id="eligibility-notes" placeholder="Note what you confirmed: work authorisation, joining date or hours, anything the posting left unclear."></textarea><button class="btn sm" id="approve-eligibility" style="margin-top:8px">Record review and mark ready</button></div>`
            : a.eligibilityNotes
              ? `<div class="callout" style="margin-top:12px"><b>Your eligibility review:</b> ${e(a.eligibilityNotes)}</div>`
              : ""
        }</section>`
  }<section><div class="spread"><h3>Prepared answers</h3>${locked ? "" : '<button class="btn ghost sm" id="edit-answers">Edit or add</button>'}</div>${(a.answers || []).map((x) => `<div class="answer"><div class="spread"><b>${e(x.question)}</b><button class="btn sm" data-copy="${e(x.answer)}">Copy</button></div><span class="tag ${x.verified ? "fintech" : "founders"}">${x.verified ? "From your profile" : "Draft: check before use"}</span><p>${e(x.answer)}</p></div>`).join("") || '<p class="muted small">No answers prepared.</p>'}</section><section><h3>Submission record</h3>${
    c
      ? `<div class="callout"><div class="row"><span class="tag ${c.type === "user-confirmed" ? "product" : "fintech"}">${e(c.type)}</span>${c.submittedAt ? `<span class="muted small">Submitted ${e(c.submittedAt)}</span>` : ""}</div><p style="margin-top:8px">${e(c.evidence)}</p><p class="muted small">Recorded ${e(when(c.time))}${a.resumeSnapshot ? ` · ${e(a.resumeSnapshot.track)} resume v${a.resumeSnapshot.version}` : ""}</p>${c.fileId ? `<a class="btn sm" style="margin-top:8px" href="/api/evidence/${c.fileId}">${icon("download", 14)}Confirmation file</a>` : ""}</div>`
      : `<p class="muted small">Nothing is recorded as sent yet. After you submit on the employer’s site, record it here with the resume you used.</p><button class="btn primary" data-mark-applied="${j.id}" style="margin-top:8px">${icon("check", 15)}${a.status === "Submission uncertain" ? "Record what you found" : "Record submission"}</button>`
  }</section><section><h3>Stage, notes and follow-up</h3><div class="stack"><div class="row"><select id="app-stage" aria-label="Stage" style="flex:1">${[
    ...new Set([
      a.status,
      ...(isApplied(a)
        ? ["Assessment / Interview", "Offer", "Rejected", "Withdrawn", "Closed"]
        : a.status === "Submission uncertain"
          ? ["Withdrawn", "Closed"]
          : ["Needs my input", "Ready for final step", "Withdrawn", "Closed"]),
    ]),
  ]
    .map((v) => `<option ${a.status === v ? "selected" : ""}>${e(v)}</option>`)
    .join(
      "",
    )}</select><button class="btn sm" id="save-stage">Update stage</button></div><div class="field"><label for="app-notes">Notes</label><textarea id="app-notes" placeholder="Referral, recruiter name, what you were asked…">${e(a.notes)}</textarea></div><div class="row"><div class="field" style="flex:1"><label for="follow-up">Follow up on</label><input type="date" id="follow-up" value="${e(a.followUp || "")}"></div><button class="btn" id="save-notes" style="align-self:flex-end">Save</button></div>${!c && !["Submitting", "Submission uncertain"].includes(a.status) ? `<button class="btn ghost sm" id="remove-packet">Remove this packet</button>` : ""}</div></section>${timeline.length ? `<section><h3>History</h3>${timeline.map((ev) => `<div class="log-row"><span>${e(ev.message)}</span><time>${e(when(ev.created))}</time></div>`).join("")}</section>` : ""}`;
}
function openJob(id) {
  const j = jobFor(id);
  if (!j) return;
  if (!$('[role="dialog"]')) previousFocus = document.activeElement;
  activeJob = id;
  const m = j.assessment,
    a = appFor(id),
    applied = isApplied(a),
    [fitLabel, fitColor] = fit(m.score),
    sector = sectorOf(j),
    resume = resumeFor(m.track),
    description = j.description || "",
    checks = [
      ...m.blocked.map((t) => ["block", t]),
      ...m.review
        .filter((t) => !/Overlapping responsibilities/.test(t))
        .map((t) => ["", t]),
    ],
    canApply =
      !applied && !["Submitting", "Submission uncertain"].includes(a?.status);
  sheet(
    "drawer",
    j.title,
    `<header class="sheet-head"><div class="spread" style="margin-bottom:12px"><span class="tag" style="color:${fitColor}">${fitLabel} · ${m.score}/100</span><button class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div><div class="hero">${logo(j.company)}<div><h2>${e(j.title)}</h2><div class="muted" style="margin-top:3px">${e(j.company)} · ${e(j.location)}</div></div></div><div class="tags" style="margin-top:12px">${a ? statusTag(a) : ""}<span class="tag ${sector.toLowerCase()}">${sector}</span><span class="tag">${e(m.category || j.unsuitable || m.reason)}</span><span class="tag">${e(jobType(j))}</span>${workplaceTag(j)}<span class="tag">${e(experience(j))}</span>${m.employmentType === "Full-time" ? '<span class="tag">' + (m.startDate ? "Start date " + e(m.startDate) : "Start date not stated") + "</span>" : ""}${isRemote(j) ? '<span class="tag">Remote</span>' : ""}${j.postedAt ? `<span class="tag">Posted ${ago(j.postedAt)}</span>` : ""}${j.closed ? '<span class="tag warn">No longer listed</span>' : j.unsuitable ? `<span class="tag warn">${e(m.historyOnly ? j.unsuitable : "No longer matches")}</span>` : ""}</div><div class="row" style="margin-top:16px">${canApply ? `<button class="btn accent" style="flex:1" data-apply="${id}">${icon("external", 15)}${extVersion() ? "Apply with autofill" : "Apply on company site"}</button>` : `<a class="btn" style="flex:1" href="${e(j.applyUrl || j.originalUrl)}" target="_blank" rel="noopener noreferrer">${icon("external", 15)}Open job page</a>`}${a ? "" : `<button class="btn" data-prepare="${id}">Prepare packet</button><button class="btn" data-mark-applied="${id}">${icon("check", 15)}I applied</button>`}<button class="icon-btn ${isSaved(j) ? "on" : ""}" data-save="${id}" aria-label="${isSaved(j) ? "Remove from saved" : "Save for later"}">${icon("bookmark", 18)}</button></div></header><div class="sheet-body">${j.unsuitable ? `<div class="callout" style="margin-bottom:18px">Reason hidden: ${e(j.unsuitable)}</div>` : ""}${
      a
        ? packetSections(j, a)
        : `<section><h3>Resume to send</h3>${
            resume
              ? `<div class="file"><div class="file-icon">${/\.docx$/i.test(resume.name) ? "DOCX" : "PDF"}</div><div style="flex:1;min-width:0"><div class="file-name">${e(resume.name)}</div><div class="muted small">${trackLabel(resume.track)} · version ${resume.version}</div></div><a class="btn sm" href="/api/resumes/${resume.id}">${icon("download", 14)}Download</a></div>`
              : `<div class="callout spread"><span>No ${trackLabel(m.track)} resume uploaded yet.</span><button class="btn sm" data-view="resumes">Upload</button></div>`
          }<p class="muted small" style="margin-top:8px">${e(m.reason || "")}</p><p class="muted small">Prepare packet gathers your answers, the exact resume version and a checklist for this job.</p></section>`
    }<section><h3>Why it matched</h3>${m.matchedBy === "responsibilities" ? '<p class="muted small" style="margin-bottom:8px">Matched on the work described, not the job title.</p>' : ""}<div class="bars">${Object.entries(
      m.parts,
    )
      .filter(([k]) => partNames[k])
      .map(
        ([k, v]) =>
          `<div class="bar"><span>${partNames[k][0]}</span><i><b style="width:${Math.round((v / partNames[k][1]) * 100)}%"></b></i><span>${v}/${partNames[k][1]}</span></div>`,
      )
      .join(
        "",
      )}</div></section>${checks.length ? `<section><h3>Check before you apply</h3><ul class="checks">${checks.map(([c, t]) => `<li class="${c}">${e(t)}</li>`).join("")}</ul></section>` : ""}<section><h3>About the role</h3>${j.descriptionPartial || !description ? `<div class="callout">Only a summary is available for this job. The resume suggestion is based on the title. Open the company page for the full description.</div>` : `<p class="desc" id="desc">${e(description.slice(0, 900))}${description.length > 900 ? "…" : ""}</p>${description.length > 900 ? '<button class="btn ghost sm" id="more-desc" style="margin-top:6px">Show full description</button>' : ""}`}<div class="row" style="margin-top:14px"><a class="btn sm" href="${e(j.originalUrl)}" target="_blank" rel="noopener noreferrer">${icon("external", 14)}Open job page</a>${j.collection === "Dismissed" ? `<button class="btn sm" data-restore="${id}">${icon("undo", 14)}Restore</button>` : a ? "" : `<button class="btn ghost sm" data-dismiss="${id}">${icon("x", 14)}Not interested</button>`}</div></section></div>`,
  );
  const on = (sel, fn) => $(sel) && ($(sel).onclick = fn);
  on("#more-desc", () => {
    $("#desc").textContent = description;
    $("#more-desc").remove();
  });
  if (!a) return;
  on("#save-resume", () =>
    appAction(
      id,
      { action: "resume", resumeId: $("#resume-override").value },
      "Resume selected for this application",
    ),
  );
  on("#approve-eligibility", () =>
    appAction(
      id,
      { action: "eligibility", notes: $("#eligibility-notes").value },
      "Review recorded",
    ),
  );
  on("#edit-answers", () => editAnswers(a, id));
  on("#save-stage", () =>
    appAction(
      id,
      { action: "stage", status: $("#app-stage").value },
      "Stage updated",
    ),
  );
  on("#remove-packet", () =>
    act(() => api(`jobs/${id}/untrack`, {}), { done: "Packet removed" }),
  );
  on("#save-notes", () => {
    const notes = $("#app-notes").value,
      followUp = $("#follow-up").value;
    act(
      () =>
        api("applications/" + appFor(id).id, {
          action: "notes",
          notes,
          followUp,
        }),
      {
        local: () => Object.assign(appFor(id), { notes, followUp }),
        done: "Notes saved",
      },
    );
  });
  for (const box of $$("[data-check]", $("#modal-root")))
    box.onchange = () => {
      const checks = $$("[data-check]", $("#modal-root"))
        .filter((n) => n.checked)
        .map((n) => Number(n.dataset.check));
      act(
        () =>
          api("applications/" + appFor(id).id, { action: "checks", checks }),
        { local: () => (appFor(id).checks = checks) },
      );
    };
}
// Record a submission: the exact resume, the date and what confirms it.
function confirmForm(jobId) {
  const j = jobFor(jobId),
    a = appFor(jobId),
    chosen = a?.resumeId || resumeFor(j.assessment.track)?.id,
    resumes = state.resumes
      .slice()
      .sort((x, y) => x.track.localeCompare(y.track) || y.version - x.version);
  if (!resumes.length)
    return modal(
      "Upload a resume first",
      `<div class="stack"><p class="muted">An application is recorded together with the exact resume you sent. Upload your resume, then come back and record this one.</p><button class="btn primary block" data-view="resumes">Go to Resumes</button></div>`,
    );
  modal(
    a?.status === "Submission uncertain"
      ? "Record what you found"
      : "Record your application",
    `<form id="confirm-form" class="stack"><p class="muted small">${e(j.title)} · ${e(j.company)}</p><div class="field"><label for="confirm-resume">Resume you sent</label><select id="confirm-resume" style="width:100%" required>${resumes.map((r) => `<option value="${r.id}" ${chosen === r.id ? "selected" : ""}>${e(trackLabel(r.track))} · version ${r.version} · ${e(r.name)}</option>`).join("")}</select></div><div class="field"><label for="confirm-date">Date submitted</label><input id="confirm-date" type="date" required value="${stamp().slice(0, 10)}" max="${stamp().slice(0, 10)}"></div><div class="field"><label for="confirm-text">What confirms it</label><textarea id="confirm-text" required minlength="8" placeholder="For example: confirmation email received from the employer, or the reference number shown after submitting."></textarea></div><div class="field"><label for="confirm-file">Attach the confirmation (optional, up to ${state.runtime === "vercel" ? 3 : 8} MB)</label><input id="confirm-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" style="height:auto;padding:8px"></div><p class="muted small">Saved as “user-confirmed”: your own record, not checked with the employer.</p><button class="btn primary block">Save record</button></form>`,
  );
  $("#confirm-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const file = $("#confirm-file").files[0],
      body = {
        resumeId: $("#confirm-resume").value,
        submittedAt: $("#confirm-date").value,
        evidence: $("#confirm-text").value,
      };
    try {
      if (file) body.attachment = await filePayload(file);
      await api(`jobs/${jobId}/confirm`, body);
      closeModal();
      appTab = "all";
      await refresh();
      toast("Application recorded");
    } catch (err) {
      toast(err.message);
    }
  };
}
function editAnswers(a, jobId) {
  modal(
    "Edit prepared answers",
    `<form id="answers-edit" class="stack">${(a.answers || []).map((x, i) => `<div class="field"><label for="answer-${i}">${e(x.question)}</label><textarea id="answer-${i}" name="answer-${i}">${e(x.answer)}</textarea></div>`).join("")}${field("custom-question", "Another question the employer asks", "")}${field("custom-answer", "Your answer", "", "textarea")}<button class="btn primary block">Save answers</button></form>`,
  );
  $("#answers-edit").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(ev.target),
      answers = (a.answers || []).map((x, i) => {
        const answer = data.get("answer-" + i);
        // An answer you rewrote is your own text, no longer a profile fact.
        return { ...x, answer, verified: x.verified && answer === x.answer };
      });
    if (data.get("custom-question"))
      answers.push({
        question: data.get("custom-question"),
        answer: data.get("custom-answer"),
        verified: false,
      });
    try {
      await api("applications/" + a.id, { action: "answers", answers });
      await refresh();
      openJob(jobId);
      toast("Answers saved");
    } catch (err) {
      toast(err.message);
    }
  };
}
function addJob() {
  modal(
    "Add a job you found",
    `<form id="job-form" class="stack">${field("company", "Company", "")}${field("title", "Job title", "")}${field("originalUrl", "Link to the job", "", "url")}${field("location", "Location", "")}<div class="field"><label for="employmentType">Type</label><select id="employmentType" name="employmentType" style="width:100%"><option>Full-time</option><option>Internship</option></select></div>${field("description", "Job description (paste it for a better score)", "", "textarea")}<button class="btn primary block">Add job</button></form>`,
  );
  $("#job-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    try {
      const r = await api("jobs", data);
      await refresh();
      openJob(r.id);
    } catch (err) {
      toast(err.message);
    }
  };
}
function addSource() {
  modal(
    "Add a company",
    `<form id="source-form" class="stack"><p class="muted small">Works for companies whose careers page runs on one of these job boards. Open their careers page, click any job and look at the address bar.</p>${field("company", "Company name", "")}<div class="field"><label for="kind">Job board</label><select id="kind" name="kind" style="width:100%"><option value="greenhouse">Greenhouse (boards.greenhouse.io/NAME)</option><option value="lever">Lever (jobs.lever.co/NAME)</option><option value="ashby">Ashby (jobs.ashbyhq.com/NAME)</option><option value="smartrecruiters">SmartRecruiters (jobs.smartrecruiters.com/NAME)</option><option value="workable">Workable (apply.workable.com/NAME)</option></select></div>${field("board", "NAME from that address", "")}<button class="btn primary block">Add company</button></form>`,
  );
  $("#source-form").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api("sources", Object.fromEntries(new FormData(ev.target)));
      closeModal();
      await refresh();
      toast("Added. It is included from the next scan.");
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- scanning ----------
// Plain words for how far the scan has got. Never says "complete" while sources wait.
function scanSummary(scan = state.scan) {
  if (!scan?.startedAt) return "";
  const parts = [`${scan.done} of ${scan.total} sources checked`];
  if (scan.failed) parts.push(`${scan.failed} failed`);
  if (scan.waiting) parts.push(`${scan.waiting} still waiting`);
  return parts.join(" · ");
}
function scanBanner() {
  const scan = state.scan;
  if (!scan?.startedAt || scanning) return "";
  if (scan.waiting)
    return `<div class="setup"><div><h3>${scan.active ? "Scan in progress" : "Last scan did not finish"}</h3><p>${e(scanSummary())}. ${scan.active ? "It is still running in the background." : "The remaining sources were not checked, so some roles may be missing."}</p></div><button class="btn primary" data-action="discover">${icon("refresh", 15)}${scan.active ? "Check progress" : "Continue scan"}</button></div>`;
  if (scan.failed)
    return `<div class="callout spread" style="margin-bottom:20px"><span>Last scan: ${e(scanSummary())}. Failed sources keep their earlier roles.</span><button class="btn sm" data-view="companies">See which</button></div>`;
  return "";
}
async function discover() {
  if (scanning) return;
  scanning = true;
  render();
  try {
    await api("discover", {});
    const before = state.jobs.length,
      started = Date.now();
    // Follow the scan for up to four minutes, showing real counts as it goes.
    while (Date.now() - started < 240000) {
      await new Promise((r) => setTimeout(r, 2500));
      state = await api("state");
      if (!$('[role="dialog"]')) render();
      if (state.scan.complete || !state.scan.active) break;
    }
    const diff = state.jobs.length - before,
      scan = state.scan;
    toast(
      scan.complete
        ? `Scan finished: ${scanSummary()}. ${diff > 0 ? `${diff} new role${diff === 1 ? "" : "s"}.` : "No new roles."}`
        : `Scan not finished: ${scanSummary()}. ${scan.active ? "It continues in the background." : "Press Continue scan to check the rest."}`,
    );
  } catch (err) {
    toast(err.message);
  }
  scanning = false;
  if (!$('[role="dialog"]')) render();
}

// ---------- events ----------
const setCollection = (id, collection, done) =>
  act(() => api("jobs/" + id, { collection }), {
    local: () => (jobFor(id).collection = collection),
    done,
  });
document.addEventListener("click", async (ev) => {
  const t = (sel) => ev.target.closest?.(sel);
  let n;
  if (t("[data-close]")) return closeModal();
  if ((n = t("[data-save]"))) {
    const j = jobFor(n.dataset.save);
    return setCollection(
      j.id,
      isSaved(j) ? "New" : "Saved",
      isSaved(j) ? "Removed from saved" : "Saved",
    );
  }
  if ((n = t("[data-dismiss]")))
    return setCollection(
      n.dataset.dismiss,
      "Dismissed",
      "Hidden. Find it under Hidden.",
    );
  if ((n = t("[data-restore]")))
    return setCollection(n.dataset.restore, "New", "Restored");
  if ((n = t("[data-apply]"))) return applyTo(n.dataset.apply);
  if ((n = t("[data-prepare]")))
    return act(() => api("prepare", { jobId: n.dataset.prepare }), {
      done: "Packet prepared. See what is left below.",
    });
  if ((n = t("[data-copy]"))) {
    try {
      await navigator.clipboard.writeText(n.dataset.copy);
      toast("Copied");
    } catch {
      toast("Could not copy. Select the text and copy it yourself.");
    }
    return;
  }
  if ((n = t("[data-not-yet]"))) {
    const id = n.dataset.notYet;
    return act(() => api(`jobs/${id}/opened`, { clear: true }), {
      local: () => delete jobFor(id).applyOpened,
    });
  }
  if ((n = t("[data-app-tab]"))) {
    appTab = n.dataset.appTab;
    return render();
  }
  if ((n = t("[data-mark-applied]"))) return confirmForm(n.dataset.markApplied);
  if ((n = t("[data-view]"))) {
    if ($('[role="dialog"]')) closeModal();
    view = n.dataset.view;
    render();
    return window.scrollTo(0, 0);
  }
  if ((n = t("[data-upload]"))) {
    pendingTrack = n.dataset.upload;
    return $("#resume-input")?.click();
  }
  if ((n = t("[data-action]"))) {
    const a = n.dataset.action;
    if (a === "discover") return discover();
    if (a === "add-job") return addJob();
    if (a === "add-source") return addSource();
    if (a === "reset-filters") {
      Object.assign(filters, {
        tab: "open",
        track: "All",
        type: "All",
        region: "All",
        sector: "All",
        search: "",
        company: "All",
      });
      return render();
    }
    if (a === "toggle-pause") {
      const paused = !state.settings.paused;
      return act(
        () =>
          api("settings", {
            ...state.settings,
            paused,
            enableAuto: state.settings.mode === "auto",
          }),
        {
          local: () => (state.settings.paused = paused),
          done: paused ? "Daily scan paused" : "Daily scan turned on",
        },
      );
    }
    if (a === "logout") {
      await api("logout", {});
      return location.reload();
    }
  }
  if ((n = t("[data-source]"))) {
    const id = n.dataset.source,
      enabled = n.dataset.enabled === "1";
    return act(() => api("sources/" + id, { enabled }), {
      local: () => {
        for (const x of state.sources)
          if (x.id === id) x.enabled = enabled ? 1 : 0;
        for (const c of state.companyWatchlist || [])
          if (c.sourceId === id) c.sourceEnabled = enabled;
      },
    });
  }
  if ((n = t("[data-tab]"))) {
    filters.tab = n.dataset.tab;
    return render();
  }
  if ((n = t("[data-region]"))) {
    filters.region = n.dataset.region;
    return render();
  }
  if (t("[data-internships]")) {
    filters.type = filters.type === "Internship" ? "All" : "Internship";
    return render();
  }
  if (t("[data-clear-company]")) {
    filters.company = "All";
    return render();
  }
  if ((n = t("[data-company-filter]"))) {
    companyFilter = n.dataset.companyFilter;
    return render();
  }
  if ((n = t("[data-company-jobs]"))) {
    Object.assign(filters, { company: n.dataset.companyJobs, tab: "open" });
    view = "jobs";
    return render();
  }
  if ((n = t("[data-stat]"))) {
    const k = n.dataset.stat;
    if (k === "applied") {
      view = "applications";
      appTab = "all";
    } else {
      filters.tab = k === "saved" ? "saved" : "open";
      filters.sort = k === "new" ? "newest" : "best";
    }
    return render();
  }
  if ((n = t("[data-job]"))) return openJob(n.dataset.job);
});
document.addEventListener("keydown", (ev) => {
  const dialog = $('[role="dialog"]');
  if (!dialog) {
    if (
      (ev.key === "Enter" || ev.key === " ") &&
      ev.target.matches?.("[data-job],.drop")
    ) {
      ev.preventDefault();
      ev.target.click();
    }
    return;
  }
  if (ev.key === "Escape") closeModal();
  if (ev.key === "Tab") {
    const all = $$("button,a[href],input,select,textarea", dialog).filter(
      (n) => !n.disabled,
    );
    if (!all.length) return;
    const first = all[0],
      last = all[all.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "search") return;
  filters.search = ev.target.value;
  $("#job-list").innerHTML = jobList(visibleJobs());
});
document.addEventListener("change", (ev) => {
  const n = ev.target;
  if (n.dataset?.filter) {
    filters[n.dataset.filter] = n.value;
    return render();
  }
  if (n.id === "resume-input") {
    const file = n.files[0],
      track = pendingTrack;
    pendingTrack = "";
    n.value = "";
    return saveResume(file, track);
  }
});
document.addEventListener("submit", (ev) => {
  if (ev.target.id === "answers-form") {
    ev.preventDefault();
    const answers = Object.fromEntries(new FormData(ev.target));
    return act(() => api("answers", { answers }), {
      local: () => (state.answers = answers),
      done: "Answers saved",
    });
  }
  if (ev.target.id !== "profile-form") return;
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(ev.target));
  act(() => api("profile", data), {
    local: () => Object.assign(state.profile, data),
    // Scores can shift with the profile; pick them up quietly.
    after: () => refresh(false),
    done: "Details saved",
  });
});
// Drag a resume straight onto a slot.
for (const type of ["dragover", "dragleave", "drop"])
  document.addEventListener(type, (ev) => {
    const slot = ev.target.closest?.("[data-drop]");
    if (!slot) return;
    ev.preventDefault();
    $(".drop", slot)?.classList.toggle("over", type === "dragover");
    if (type === "drop")
      saveResume(ev.dataTransfer?.files?.[0], slot.dataset.drop);
  });

await refresh();
askResults();
setInterval(async () => {
  if (!state || scanning || inflight || $('[role="dialog"]')) return;
  if (["settings", "resumes"].includes(view)) return;
  if (document.activeElement?.id === "search") return;
  try {
    const fresh = await api("state");
    const changed =
      fresh.events[0]?.id !== state.events[0]?.id ||
      fresh.jobs.length !== state.jobs.length;
    state = fresh;
    if (changed) render();
  } catch {}
}, 30000);
