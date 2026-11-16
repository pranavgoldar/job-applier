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
const isApplied = (a) => a && (a.confirmation || !preStages.includes(a.status));
const preStages = ["Preparing", "Needs my input", "Ready for final step"];
const isSaved = (j) => ["Saved", "Shortlisted"].includes(j.collection);
const isNew = (j) => Date.now() - new Date(j.firstSeen).getTime() < 2 * DAY;
const jobType = (j) =>
  j.assessment.employmentType === "Internship" ? "Internship" : "Full-time";
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
  const y = j.assessment.requiredYears;
  if (jobType(j) === "Internship") return "Internship";
  if (y === null || y === undefined)
    return j.experienceLevel || "Experience not stated";
  return y <= 1 ? "0–1 yrs" : y + "+ yrs · stretch";
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
    throw new Error(j.error || "Request failed");
  }
  return j;
}
async function refresh(draw = true) {
  try {
    state = await api("state");
    if (draw) render();
  } catch (err) {
    if (!state && err.message !== "Sign in required")
      $("#app").innerHTML = `<div class="loading">${e(err.message)}</div>`;
  }
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
function putApp(app) {
  if (!app?.id) return;
  const i = state.applications.findIndex((a) => a.jobId === app.jobId);
  if (i < 0) state.applications.unshift(app);
  else state.applications[i] = app;
}
// Show a job as tracked straight away; the server's copy replaces this one.
function trackLocally(jobId, status) {
  const old = appFor(jobId);
  if (status === "Not applied") {
    state.applications = state.applications.filter((a) => a.jobId !== jobId);
    return;
  }
  if (old) {
    old.status = status;
    old.confirmation ||= { type: "user-confirmed", time: stamp() };
    old.updated = stamp();
    return;
  }
  const r = resumeFor(jobFor(jobId).assessment.track);
  state.applications.unshift({
    id: "pending-" + jobId,
    jobId,
    status,
    confirmation: { type: "user-confirmed", time: stamp() },
    notes: "",
    followUp: null,
    created: stamp(),
    updated: stamp(),
    resumeId: r?.id || null,
    resumeSnapshot: r
      ? { id: r.id, track: r.track, version: r.version, name: r.name }
      : null,
  });
}
const track = (jobId, status, done) =>
  act(() => api(`jobs/${jobId}/track`, { status }), {
    local: () => trackLocally(jobId, status),
    after: putApp,
    done,
  });

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
  const applied = state.applications.filter(isApplied).length;
  $("#app").innerHTML =
    `<header class="topbar"><div class="topbar-inner"><div class="brand"><span class="brand-mark">c</span>Career OS</div><nav class="nav" aria-label="Main">${nav
      .map(
        ([v, k, t]) =>
          `<button data-view="${v}" class="${view === v ? "active" : ""}">${icon(k)}<span>${t}</span>${v === "applications" && applied ? `<span class="count">${applied}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="topbar-actions"><button class="btn sm" data-action="discover" ${scanning ? "disabled" : ""}>${icon("refresh", 15, scanning ? "spin" : "")}<span class="hide-sm">${scanning ? "Checking job boards…" : "Refresh jobs"}</span></button><button class="icon-btn ${view === "settings" ? "on" : ""}" data-view="settings" aria-label="Settings">${icon("settings", 19)}</button></div></div></header><main class="page">${pages[view]()}</main>`;
}
function head(title, sub, actions = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="head-actions">${actions}</div></div>`;
}

// ---------- jobs ----------
function visibleJobs() {
  const q = filters.search.trim().toLowerCase();
  return state.jobs
    .filter((j) => {
      const a = appFor(j.id);
      if (filters.tab === "open") {
        if (j.collection === "Dismissed" || isApplied(a) || j.closed)
          return false;
      } else if (filters.tab === "saved") {
        if (!isSaved(j)) return false;
      } else if (filters.tab === "dismissed" && j.collection !== "Dismissed")
        return false;
      if (filters.track !== "All" && j.assessment.track !== filters.track)
        return false;
      if (filters.type !== "All" && jobType(j) !== filters.type) return false;
      if (filters.sector !== "All" && sectorOf(j) !== filters.sector)
        return false;
      if (filters.company !== "All" && j.company !== filters.company)
        return false;
      if (filters.region === "Remote" ? !isRemote(j) : false) return false;
      if (
        !["All", "Remote"].includes(filters.region) &&
        regionOf(j) !== filters.region
      )
        return false;
      return (
        !q ||
        [j.title, j.company, j.location].join(" ").toLowerCase().includes(q)
      );
    })
    .sort((a, b) =>
      filters.sort === "newest"
        ? String(b.postedAt || b.firstSeen).localeCompare(
            String(a.postedAt || a.firstSeen),
          )
        : b.assessment.score - a.assessment.score ||
          String(b.firstSeen).localeCompare(String(a.firstSeen)),
    );
}
function jobCard(j) {
  const m = j.assessment,
    [, ring] = fit(m.score),
    a = appFor(j.id),
    sector = sectorOf(j);
  return `<article class="card job" data-job="${j.id}" tabindex="0" role="button" aria-label="${e(j.title)} at ${e(j.company)}">${logo(j.company)}<div class="job-main"><div class="job-title"><span>${e(j.title)}</span>${isNew(j) ? '<span class="tag new">New</span>' : ""}</div><div class="job-meta">${e(j.company)} · ${e(j.location)}${j.postedAt ? " · posted " + ago(j.postedAt) : ""}</div><div class="tags">${sector !== "Other" ? `<span class="tag ${sector.toLowerCase()}">${sector}</span>` : ""}<span class="tag ${m.track === PRODUCT ? "product" : "founders"}">${trackLabel(m.track)}</span><span class="tag">${e(experience(j))}</span>${isApplied(a) ? `<span class="tag fintech">${e(stageLabel(a.status))}</span>` : ""}${j.closed ? '<span class="tag warn">No longer listed</span>' : ""}</div></div><div class="job-side"><div class="score" style="--p:${m.score};--ring:${ring}" title="Match score ${m.score} of 100"><span>${m.score}</span></div><button class="icon-btn ${isSaved(j) ? "on" : ""}" data-save="${j.id}" aria-label="${isSaved(j) ? "Remove from saved" : "Save for later"}" title="${isSaved(j) ? "Saved" : "Save for later"}">${icon("bookmark", 18)}</button>${j.collection === "Dismissed" ? `<button class="icon-btn" data-restore="${j.id}" aria-label="Restore" title="Restore">${icon("undo", 18)}</button>` : `<button class="icon-btn hide-sm" data-dismiss="${j.id}" aria-label="Not interested" title="Not interested">${icon("x", 18)}</button>`}</div></article>`;
}
function setupBanner() {
  const missing = [PRODUCT, FOUNDERS].filter((t) => !resumeFor(t));
  if (missing.length)
    return `<div class="setup"><div><h3>Add your ${missing.length === 2 ? "two resumes" : trackLabel(missing[0]) + " resume"}</h3><p>Each job is paired with the right resume automatically, so it is one click away when you apply.</p></div><button class="btn primary" data-view="resumes">${icon("upload", 15)}Upload</button></div>`;
  if (!state.lastDiscovery)
    return `<div class="setup"><div><h3>Run your first scan</h3><p>Checks every company job board on your list and keeps only early-career Product and Founder’s Office roles in India, Dubai and Singapore.</p></div><button class="btn primary" data-action="discover">${icon("refresh", 15)}Scan now</button></div>`;
  return "";
}
function jobsPage() {
  const open = state.jobs.filter(
      (j) =>
        j.collection !== "Dismissed" && !isApplied(appFor(j.id)) && !j.closed,
    ),
    list = visibleJobs(),
    name = (state.profile.name || "").trim().split(/\s+/)[0],
    count = (fn) => open.filter(fn).length,
    regions = [
      ["All", "Everywhere", open.length],
      ["Bangalore", "Bangalore", count((j) => regionOf(j) === "Bangalore")],
      ["Mumbai", "Mumbai", count((j) => regionOf(j) === "Mumbai")],
      ["India", "Rest of India", count((j) => regionOf(j) === "India")],
      ["Dubai / UAE", "Dubai", count((j) => regionOf(j) === "Dubai / UAE")],
      ["Singapore", "Singapore", count((j) => regionOf(j) === "Singapore")],
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
    ]
      .map(
        ([v, l]) =>
          `<button data-tab="${v}" class="${filters.tab === v ? "active" : ""}">${l}</button>`,
      )
      .join("")}</div>${select("track", [
      ["All", "Both resumes"],
      [PRODUCT, "Product / APM"],
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
      ["best", "Best match"],
      ["newest", "Newest"],
    ])}</div><div class="chips">${regions.map(([v, l, n]) => `<button class="chip ${filters.region === v ? "active" : ""}" data-region="${e(v)}">${l} <i>${n}</i></button>`).join("")}<button class="chip ${filters.type === "Internship" ? "active" : ""}" data-internships>Internships <i>${count((j) => jobType(j) === "Internship")}</i></button>${filters.company !== "All" ? `<button class="chip active" data-clear-company>${e(filters.company)} ✕</button>` : ""}</div><div id="job-list">${jobList(list)}</div>`
  );
}
function jobList(list) {
  if (!list.length)
    return `<div class="card empty"><h3>${state.jobs.length ? "Nothing matches these filters" : "No jobs yet"}</h3><p>${state.jobs.length ? "Try a different location or clear the search." : "Press Refresh jobs to scan every company job board on your list. It takes about a minute."}</p>${state.jobs.length ? '<button class="btn" data-action="reset-filters">Clear filters</button>' : `<button class="btn primary" data-action="discover">${icon("refresh", 15)}Refresh jobs</button>`}</div>`;
  return `<div class="jobs">${list.map(jobCard).join("")}</div><p class="list-foot">${list.length} role${list.length === 1 ? "" : "s"} · Match score weighs role, experience needed, sector and location. It is a guide, not a prediction.</p>`;
}

// ---------- applications ----------
const stageLabel = (s) =>
  s === "Assessment / Interview"
    ? "Interviewing"
    : preStages.includes(s)
      ? "To apply"
      : s;
function miniCard(j, a) {
  return `<div class="card mini" data-job="${j.id}" tabindex="0" role="button"><b>${e(j.title)}</b><small>${e(j.company)} · ${e(a && isApplied(a) ? "updated " + ago(a.updated) : regionOf(j))}</small>${a && ["Rejected", "Withdrawn", "Closed"].includes(a.status) ? `<div class="tags"><span class="tag">${e(a.status)}</span></div>` : ""}${a?.followUp ? `<div class="tags"><span class="tag founders">Follow up ${e(a.followUp)}</span></div>` : ""}</div>`;
}
function applicationsPage() {
  const apps = state.applications
      .map((a) => [jobFor(a.jobId), a])
      .filter(([j]) => j),
    toApply = [
      ...state.jobs
        .filter((j) => isSaved(j) && !appFor(j.id))
        .map((j) => [j, null]),
      ...apps.filter(([, a]) => !isApplied(a)),
    ],
    cols = [
      ["To apply", toApply, "Save a job to queue it here."],
      [
        "Applied",
        apps.filter(([, a]) => isApplied(a) && a.status === "Applied"),
        "Mark a job as applied and it lands here.",
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
      "Everything you have saved or applied to, in one place.",
      `<a class="btn" href="/api/export">${icon("download", 15)}Export CSV</a>`,
    ) +
    `<div class="board">${cols.map(([t, rows, hint]) => `<section class="col"><div class="col-head">${t}<span>${rows.length}</span></div>${rows.map(([j, a]) => miniCard(j, a)).join("") || `<div class="col-empty">${hint}</div>`}</section>`).join("")}</div>`
  );
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
    shown = all
      .filter((c) =>
        companyFilter === "All"
          ? true
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
    auto = all.filter((c) => c.sourceId).length;
  return (
    head(
      "Companies",
      `${auto} companies are checked automatically. ${all.length - auto} more have no public job feed and need a manual look.`,
      `<button class="btn primary" data-action="add-source">${icon("plus", 15)}Add company</button>`,
    ) +
    `<div class="chips">${[
      ["All", "All"],
      ["Fintech", "Fintech"],
      ["Consumer", "Consumer"],
      ["Auto", "Checked automatically"],
      ["Manual", "Check manually"],
    ]
      .map(
        ([v, l]) =>
          `<button class="chip ${companyFilter === v ? "active" : ""}" data-company-filter="${v}">${l}</button>`,
      )
      .join("")}</div><div class="company-grid">${shown
      .map((c) => {
        const [dot, label, err] = companyStatus(c);
        return `<div class="card company"><div class="company-top">${logo(c.name)}<div style="flex:1;min-width:0"><div class="company-name">${e(c.name)}</div><div class="muted small">${e(String(c.industry || "").replace(/^(Fintech|Consumer|Software|Job feed)\s*\/\s*/i, ""))}</div></div>${c.sourceId ? `<button class="switch ${c.sourceEnabled ? "on" : ""}" data-source="${e(c.sourceId)}" data-enabled="${c.sourceEnabled ? "0" : "1"}" role="switch" aria-checked="${!!c.sourceEnabled}" aria-label="Check ${e(c.name)} automatically"></button>` : ""}</div><span class="status" title="${e(err)}"><span class="dot ${dot}"></span>${e(label)}</span><div class="company-links">${c.sourceCount ? `<button class="link" data-company-jobs="${e(c.name)}">View ${c.sourceCount} job${c.sourceCount === 1 ? "" : "s"}</button>` : ""}${c.careersUrl ? `<a class="link" href="${e(c.careersUrl)}" target="_blank" rel="noopener noreferrer">Careers page ↗</a>` : ""}</div></div>`;
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
    `<div class="settings-grid"><div class="stack"><form id="profile-form" class="card card-pad stack"><div class="spread"><h2>Your details</h2><button class="btn primary sm">Save</button></div><div class="form-grid">${field("name", "Full name", p.name)}${field("email", "Email", p.email, "email")}${field("phone", "Phone", p.phone)}${field("location", "Based in", p.location)}${field("education", "College and degree", p.education, "text", true)}${field("graduation", "Graduating (YYYY-MM)", p.graduation)}${field("fullTimeStart", "Can join full-time from", p.fullTimeStart, "date")}${field("experience", "Experience summary", p.experience, "textarea", true)}</div></form><section class="card card-pad"><h2 style="margin-bottom:10px">Recent activity</h2>${
      state.events
        .filter((ev) => !["preparing", "handoff", "settings"].includes(ev.kind))
        .slice(0, 12)
        .map(
          (ev) =>
            `<div class="log-row"><span>${e(ev.message)}</span><time>${e(when(ev.created))}</time></div>`,
        )
        .join("") || '<p class="muted small">Nothing yet.</p>'
    }</section></div><div class="stack"><section class="card card-pad stack"><h2>Daily scan</h2><div class="spread"><div><b>${s.paused ? "Paused" : "On"}</b><div class="muted small">${s.paused ? "Jobs only update when you press Refresh." : state.runtime === "vercel" ? "Runs every morning around 8:30 to 9:30 IST." : `Runs every ${s.intervalHours} hours while the server is on.`}</div></div><button class="switch ${s.paused ? "" : "on"}" data-action="toggle-pause" role="switch" aria-checked="${!s.paused}" aria-label="Daily scan"></button></div><div class="callout">Last scan ${e(when(state.lastDiscovery))}${s.paused ? "" : ` · next ${e(when(state.nextDiscovery))}`}</div></section><section class="card card-pad stack"><h2>How it works</h2><div class="steps"><div><b>Reads company job boards directly</b>Each company on your list publishes its openings through a public feed. The scan reads those feeds. No AI and no paid API.</div><div><b>Keeps only roles for you</b>Product and Founder’s Office titles plus business-side internships, in India, Dubai or Singapore or remote, that ask for two years of experience or less.</div><div><b>Scores and pairs a resume</b>Each role is scored on fit, sector and city, then paired with your Product or Founder’s Office resume.</div><div><b>You apply, it tracks</b>Open the company page, apply, then mark it applied. Closed roles are cleared on the next scan.</div></div></section><section class="card card-pad stack"><h2>Account</h2><div class="row"><a class="btn sm" href="/api/export">${icon("download", 14)}Export CSV</a>${state.authEnabled ? '<button class="btn sm" data-action="logout">Sign out</button>' : ""}</div><p class="muted small">Career OS ${e(state.version || "")}</p></section></div></div>`
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
    resume = a?.resumeSnapshot || resumeFor(m.track),
    applyUrl = j.applyUrl || j.originalUrl,
    description = j.description || "",
    checks = [
      ...m.blocked.map((t) => ["block", t]),
      ...m.review
        .filter((t) => !/Overlapping responsibilities/.test(t))
        .map((t) => ["", t]),
    ];
  sheet(
    "drawer",
    j.title,
    `<header class="sheet-head"><div class="spread" style="margin-bottom:12px"><span class="tag" style="color:${fitColor}">${fitLabel} · ${m.score}/100</span><button class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div><div class="hero">${logo(j.company)}<div><h2>${e(j.title)}</h2><div class="muted" style="margin-top:3px">${e(j.company)} · ${e(j.location)}</div></div></div><div class="tags" style="margin-top:12px">${sector !== "Other" ? `<span class="tag ${sector.toLowerCase()}">${sector}</span>` : ""}<span class="tag">${jobType(j)}</span><span class="tag">${e(experience(j))}</span>${isRemote(j) ? '<span class="tag">Remote</span>' : ""}${j.postedAt ? `<span class="tag">Posted ${ago(j.postedAt)}</span>` : ""}${j.closed ? '<span class="tag warn">No longer listed</span>' : ""}</div><div class="row" style="margin-top:16px"><a class="btn accent" style="flex:1" href="${e(applyUrl)}" target="_blank" rel="noopener noreferrer">${icon("external", 15)}Apply on company site</a>${applied ? "" : `<button class="btn" data-mark-applied="${id}">${icon("check", 15)}I applied</button>`}<button class="icon-btn ${isSaved(j) ? "on" : ""}" data-save="${id}" aria-label="${isSaved(j) ? "Remove from saved" : "Save for later"}">${icon("bookmark", 18)}</button></div></header><div class="sheet-body">${
      applied
        ? `<section><h3>Your application</h3><div class="stack"><div class="field"><label for="app-stage">Status</label><select id="app-stage" style="width:100%">${[
            ["Applied", "Applied"],
            ["Assessment / Interview", "Interviewing"],
            ["Offer", "Offer"],
            ["Rejected", "Rejected"],
            ["Withdrawn", "Withdrawn"],
            ["Not applied", "Remove from tracker"],
          ]
            .map(
              ([v, l]) =>
                `<option value="${v}" ${a.status === v ? "selected" : ""}>${l}</option>`,
            )
            .join(
              "",
            )}</select></div><div class="field"><label for="app-notes">Notes</label><textarea id="app-notes" placeholder="Referral, recruiter name, what you were asked…">${e(a.notes)}</textarea></div><div class="row"><div class="field" style="flex:1"><label for="follow-up">Follow up on</label><input type="date" id="follow-up" value="${e(a.followUp || "")}"></div><button class="btn" id="save-notes" style="align-self:flex-end">Save</button></div></div></section>`
        : ""
    }<section><h3>Resume to send</h3>${
      resume
        ? `<div class="file"><div class="file-icon">${/\.docx$/i.test(resume.name) ? "DOCX" : "PDF"}</div><div style="flex:1;min-width:0"><div class="file-name">${e(resume.name)}</div><div class="muted small">${trackLabel(resume.track)} · version ${resume.version}</div></div><a class="btn sm" href="/api/resumes/${resume.id}">${icon("download", 14)}Download</a></div>`
        : `<div class="callout spread"><span>No ${trackLabel(m.track)} resume uploaded yet.</span><button class="btn sm" data-view="resumes">Upload</button></div>`
    }<p class="muted small" style="margin-top:8px">${m.track === PRODUCT ? "This reads as a product role." : "This reads as a strategy and operations role."}${m.ambiguous ? " It has a bit of both, so either resume could work." : ""}</p></section><section><h3>Why it matched</h3><div class="bars">${Object.entries(
      m.parts,
    )
      .filter(([k]) => partNames[k])
      .map(
        ([k, v]) =>
          `<div class="bar"><span>${partNames[k][0]}</span><i><b style="width:${Math.round((v / partNames[k][1]) * 100)}%"></b></i><span>${v}/${partNames[k][1]}</span></div>`,
      )
      .join(
        "",
      )}</div></section>${checks.length ? `<section><h3>Check before you apply</h3><ul class="checks">${checks.map(([c, t]) => `<li class="${c}">${e(t)}</li>`).join("")}</ul></section>` : ""}<section><h3>About the role</h3>${j.descriptionPartial || !description ? `<div class="callout">This job board only shares a summary. Open the company page for the full description.</div>` : `<p class="desc" id="desc">${e(description.slice(0, 900))}${description.length > 900 ? "…" : ""}</p>${description.length > 900 ? '<button class="btn ghost sm" id="more-desc" style="margin-top:6px">Show full description</button>' : ""}`}<div class="row" style="margin-top:14px"><a class="btn sm" href="${e(j.originalUrl)}" target="_blank" rel="noopener noreferrer">${icon("external", 14)}Open job page</a>${j.collection === "Dismissed" ? `<button class="btn sm" data-restore="${id}">${icon("undo", 14)}Restore</button>` : applied ? "" : `<button class="btn ghost sm" data-dismiss="${id}">${icon("x", 14)}Not interested</button>`}</div></section></div>`,
  );
  if ($("#more-desc"))
    $("#more-desc").onclick = () => {
      $("#desc").textContent = description;
      $("#more-desc").remove();
    };
  if ($("#app-stage"))
    $("#app-stage").onchange = (ev) => track(id, ev.target.value);
  if ($("#save-notes"))
    $("#save-notes").onclick = () => {
      const notes = $("#app-notes").value,
        followUp = $("#follow-up").value;
      act(
        // Looked up when sent, so a just-created application has its real id.
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
async function discover() {
  if (scanning) return;
  scanning = true;
  render();
  try {
    await api("discover", {});
    const before = state.jobs.length,
      started = Date.now();
    // Poll until the queue drains (or four minutes pass).
    while (Date.now() - started < 240000) {
      await new Promise((r) => setTimeout(r, 2500));
      state = await api("state");
      if (!state.pending) break;
    }
    const diff = state.jobs.length - before;
    toast(
      diff > 0
        ? `Scan complete. ${diff} new role${diff === 1 ? "" : "s"}.`
        : "Scan complete. No new roles since last time.",
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
  if ((n = t("[data-mark-applied]")))
    return track(n.dataset.markApplied, "Applied", "Marked as applied");
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
    if (k === "applied") view = "applications";
    else {
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
