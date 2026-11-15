let state,
  view = "overview",
  track = "All",
  search = "",
  employment = "All",
  decision = "All",
  geography = "All",
  minScore = 0,
  sort = "score",
  activeJob = null,
  collection = "All active";
const $ = (s) => document.querySelector(s),
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
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  queue:
    '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="m3 13 5 0 2 3h4l2-3h5"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  settings:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
const icon = (k, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k] || icons.grid}</svg>`;
const date = (x) =>
  x
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(x)) + " IST"
    : "Not yet";
const link = (url, label, cls = "") =>
  url && /^https?:\/\//.test(url)
    ? `<a class="${cls}" href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>`
    : `<span class="muted">${e(label)} unavailable</span>`;
const badge = (text, color = "gray") =>
  `<span class="badge ${color}">${e(text)}</span>`;
const appFor = (id) => state.applications.find((a) => a.jobId === id),
  jobFor = (id) => state.jobs.find((j) => j.id === id);
const attention = () =>
  state.applications.filter((a) =>
    ["Needs my input", "Ready for final step", "Submission uncertain"].includes(
      a.status,
    ),
  );
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 5000);
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
async function refresh(renderPage = true) {
  try {
    state = await api("state");
    if (renderPage) render();
  } catch (err) {
    if (!state && err.message !== "Sign in required")
      $("#app").innerHTML = `<div class="loading">${e(err.message)}</div>`;
  }
}
function login() {
  $("#app").innerHTML =
    `<main class="login"><form class="login-card" id="login-form"><div class="brand"><span class="brand-mark">c</span> career<span style="font-weight:400">os</span></div><h1>Your next chapter.</h1><p class="subtle">Sign in to your private search workspace.</p><div class="field"><label for="password">Workspace password</label><input id="password" type="password" autocomplete="current-password" required></div><button class="primary" style="width:100%">Sign in ${icon("arrow", 14)}</button><p id="login-error" class="subtle danger" role="alert"></p></form></main>`;
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
const navItems = [
  ["overview", "grid", "Overview"],
  ["jobs", "search", "Job feed"],
  ["attention", "queue", "Needs my attention"],
  ["tracker", "file", "Applications"],
  ["resumes", "file", "Resume library"],
  ["profile", "user", "Profile & answers"],
  ["activity", "activity", "Activity"],
  ["settings", "settings", "Settings"],
];
function render() {
  if (!state) return;
  const current = navItems.find((n) => n[0] === view);
  $("#app").innerHTML =
    `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">c</span> career<span style="font-weight:400">os</span></div><div class="workspace-label">YOUR WORKSPACE</div><nav>${navItems.map(([v, k, t]) => `<button data-view="${v}" class="${view === v ? "active" : ""}">${icon(k)}<span>${t}</span>${v === "attention" && attention().length ? `<span class="nav-count">${attention().length}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="mode-card"><span class="dot"></span> <strong>${state.settings.paused ? "Discovery paused" : "Two active search tracks"}</strong><div class="muted">Product + Founder’s Office<br>Prepare & review by default</div><button class="text-link" data-view="settings" style="margin-top:8px">Manage automation →</button></div><div class="user"><div class="avatar">${e(
      (state.profile.name || "Career OS")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => n[0])
        .join(""),
    )}</div><div><strong style="font-size:12px">${e(state.profile.name || "Your workspace")}</strong><div class="muted tiny" style="margin-top:4px">${e(state.profile.education || "Complete your profile")}</div></div></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <span style="color:var(--ink)">${current[2]}</span></div><div class="topbar-right"><span class="private">${icon("lock", 13)} Private workspace</span><div class="avatar">${e(
      (state.profile.name || "Career OS")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => n[0])
        .join(""),
    )}</div></div></header><div class="content">${{ overview, attention: attentionPage, jobs: jobsPage, tracker: trackerPage, resumes: resumesPage, profile: profilePage, activity: activityPage, settings: settingsPage }[view]()}<footer class="page-footer"><span>Career OS ${e(state.version || "1.0.0")} · Made for your next chapter.</span><span>${e("Full-time from " + (state.profile.fullTimeStart || "date to confirm"))}</span></footer></div></main></div>`;
  bind();
}
function heading(eyebrow, title, sub, actions = "") {
  return `<div class="intro"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`;
}
function attentionCard(a) {
  const j = jobFor(a.jobId);
  return `<div class="attention-item"><div class="item-title"><div><h3>${e(j.title)}</h3><span class="muted tiny">${e(j.company)} · ${e(j.location)}</span></div>${badge(a.status, a.status === "Submission uncertain" ? "red" : "orange")}</div><p><strong style="color:var(--ink)">What’s left:</strong> ${e(a.remaining.filter((_, i) => !a.checks.includes(i))[0] || "Review and record employer confirmation.")}</p><p>${e(a.pauseReason)}</p><div class="item-meta"><span>${e(a.resumeSnapshot ? `${a.resumeSnapshot.track} · v${a.resumeSnapshot.version}` : "Resume missing")}</span><span>Last activity ${date(a.updated)}</span></div><div class="actions"><button class="primary small" data-job="${j.id}">Review & finish →</button>${link(j.applyUrl || j.originalUrl, "Open application", "button-link small")}${a.resumeId ? `<a class="button-link small" href="/api/resumes/${a.resumeId}">Download resume ↓</a>` : ""}</div></div>`;
}
function overview() {
  const apps = state.applications,
    needs = attention(),
    full = state.jobs.filter(
      (j) => j.assessment.employmentType === "Internship",
    ).length;
  return (
    heading(
      "A LITTLE PROGRESS, EVERY DAY",
      "Your next chapter starts here.",
      "Two search tracks. The right resume. A clear next step.",
      `<button data-action="add-job">+ Add a job</button><button class="primary" data-action="discover">${icon("search", 14)} Run discovery</button>`,
    ) +
    `<div class="stat-grid">${[
      [
        "New matches",
        state.jobs.filter((j) => !appFor(j.id)).length,
        "Across both search tracks",
        "search",
      ],
      [
        "Needs your attention",
        needs.length,
        "Your next steps, in one place",
        "queue",
      ],
      [
        "Applications submitted",
        apps.filter((a) => a.confirmation).length,
        "Only confirmed submissions",
        "file",
      ],
      [
        "Assessment / Interview",
        apps.filter((a) => a.status === "Assessment / Interview").length,
        "Conversations moving forward",
        "activity",
      ],
    ]
      .map(
        ([t, n, f, k]) =>
          `<div class="stat"><div class="stat-label">${t}${icon(k, 15)}</div><div class="stat-value">${n}<span style="font-size:11px;color:#a4afa2;margin-left:7px;font-weight:400">${n === 0 ? "—" : ""}</span></div><div class="stat-foot">${f}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="layout"><div><section class="panel"><div class="panel-header"><h2>Needs my attention <span class="count-bubble">${needs.length}</span></h2><button class="text-link" data-view="attention">View queue →</button></div>${needs.length ? needs.slice(0, 3).map(attentionCard).join("") : `<div class="empty"><div class="empty-icon">${icon("check", 23)}</div><h3>You’re all caught up.</h3><p>When an application needs a decision, verification or final submission, you’ll find its complete handoff packet here.</p><button class="small" data-view="jobs">Explore your job feed →</button></div>`}</section><div class="section-heading"><h2>Two tracks. Equal momentum.</h2>${badge("50 / 50 search coverage", "green")}</div><div class="track-grid">${[
      "Product",
      "Founder’s Office",
    ]
      .map((t, i) => {
        const n = state.jobs.filter((j) => j.assessment.track === t).length,
          r = state.resumes.find((r) => r.track === t && r.is_default);
        return `<div class="track-card ${i ? "fo" : ""}"><div class="track-symbol">${icon(i ? "activity" : "grid", 20)}</div><span class="track-number">${n}</span><h3>${t}</h3><p>${i ? "Founder’s Associate, Business Operations and Strategy & Operations." : "APM, graduate Product roles, Product Analyst, internships and Product Strategy."}</p><div class="track-footer"><span>${r ? `Resume v${r.version} ready` : "Upload your resume"}</span><button class="text-link" data-track="${t}">View track →</button></div></div>`;
      })
      .join(
        "",
      )}</div><div class="equal-strip"><span>✦ &nbsp; Fintech first. Opportunity beyond it.</span><span>Both full-time & remote internships</span></div><section class="panel"><div class="panel-header"><h2>Recent activity</h2><button class="text-link" data-view="activity">See all →</button></div>${
      state.events.length
        ? state.events
            .slice(0, 4)
            .map(
              (ev) =>
                `<div class="event-row"><span>${e(ev.message)}</span><time>${date(ev.created)}</time></div>`,
            )
            .join("")
        : '<div class="panel-body muted">Your search history will appear here.</div>'
    }</section></div><aside class="right-rail"><section class="panel"><div class="panel-header"><h2>Discovery pulse</h2>${badge(state.sources.some((s) => s.health === "Error") ? "Needs review" : "Independent worker", state.sources.some((s) => s.health === "Error") ? "orange" : "green")}</div><div class="search-health"><div class="health-line"><span class="muted">Last discovery</span><span>${date(state.lastDiscovery)}</span></div><div class="health-line"><span class="muted">Next scheduled</span><span>${state.settings.paused ? "Paused" : date(state.nextDiscovery)}</span></div>${state.sources
      .slice(0, 5)
      .map(
        (s) =>
          `<div class="source-row"><span>${e(s.company)}<span class="permission">${e(s.kind)} connector</span></span>${badge(s.health === "Error" ? "Connection error" : s.health, s.health === "Healthy" ? "green" : s.health === "Error" ? "orange" : "gray")}</div>`,
      )
      .join(
        "",
      )}<div class="note">Source identifiers must match the employer’s public ATS board. Failed checks preserve existing jobs and never imply a vacancy is closed.</div><button class="text-link" data-view="settings" style="margin-top:17px">Manage sources →</button></div></section><section class="panel"><div class="panel-header"><h2>From match to application</h2></div><div class="panel-body">${[
      [
        "Find your fit",
        "Independent discovery assesses eligibility across both tracks.",
      ],
      [
        "Prepare your packet",
        "Select a versioned resume and collect factual answers.",
      ],
      [
        "Finish with confidence",
        "Complete the remaining steps and save your confirmation.",
      ],
    ]
      .map(
        ([t, d], i) =>
          `<div class="step"><div class="step-num">0${i + 1}</div><div><strong>${t}</strong><p>${d}</p></div></div>`,
      )
      .join(
        "",
      )}<div class="note">Employer forms currently use manual handoff. No live application is submitted automatically.</div></div></section></aside></div>`
  );
}
function attentionPage() {
  const needs = attention();
  return (
    heading(
      "KEEP THINGS MOVING",
      "Needs my attention",
      "Everything you need to finish an application, without retracing your steps.",
    ) +
    `<section class="panel"><div class="panel-header"><h2>Your next steps</h2>${badge(needs.length + " waiting", "orange")}</div>${needs.length ? needs.map(attentionCard).join("") : '<div class="empty"><div class="empty-icon">' + icon("check") + '</div><h3>No applications waiting on you.</h3><p>Prepare a suitable opportunity from the job feed to create an answer packet, resume download and remaining-action checklist.</p><button data-view="jobs" class="primary">Go to job feed →</button></div>'}</section>`
  );
}
function filteredJobs() {
  return state.jobs
    .filter(
      (j) =>
        (collection === "All active"
          ? j.collection !== "Dismissed"
          : collection === "All" || j.collection === collection) &&
        (track === "All" || j.assessment.track === track) &&
        JSON.stringify([j.title, j.company, j.location, j.description])
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (employment === "All" ||
          (employment === "Internship"
            ? j.assessment.employmentType === "Internship"
            : /full.?time/i.test(j.assessment.employmentType))) &&
        (decision === "All" || j.assessment.decision === decision) &&
        (geography === "All" ||
          (geography === "Remote internships"
            ? j.assessment.employmentType === "Internship" &&
              /India remote|Worldwide remote/.test(
                j.assessment.remoteEligibility,
              )
            : new RegExp(geography, "i").test(j.location))) &&
        j.assessment.score >= minScore,
    )
    .sort((a, b) =>
      sort === "recent"
        ? b.firstSeen.localeCompare(a.firstSeen)
        : b.assessment.score - a.assessment.score,
    );
}
function jobTable(jobs) {
  return `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Track / fit</th><th>Stage / resume</th><th>Next action</th></tr></thead><tbody>${jobs
    .map((j) => {
      const a = appFor(j.id),
        r = a?.resumeSnapshot;
      return `<tr><td><button class="text-link" data-job="${j.id}" style="text-align:left;font-weight:650">${e(j.title)}</button><strong>${e(j.company)}</strong><span class="sub">${e(j.location)} · ${e(j.assessment.employmentType)}</span><div class="tiny">${link(j.originalUrl, "Job description")} &nbsp; ${j.applyUrl ? link(j.applyUrl, "Apply") : badge("Direct link unavailable")}</div></td><td>${badge(j.assessment.track, j.assessment.track === "Product" ? "green" : "blue")}<div style="margin-top:7px"><span class="score">${j.assessment.score}</span><span class="sub"> / 100 · ${j.assessment.decision}</span></div><span class="sub">Relevance estimate</span></td><td>${badge(a?.status || "New match", a?.confirmation ? "green" : "gray")}<div class="sub">${e(r ? `${r.track} v${r.version}` : "Resume not selected")}</div><div class="sub">${date(a?.updated || j.lastChecked)}</div></td><td><button class="small" data-job="${j.id}">${a ? "Review packet" : "Review match"} →</button><div class="sub" style="margin-top:7px">${a?.confirmation ? e(a.confirmation.type) : a ? "Finish employer form" : "Assess & prepare"}</div></td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div>${!jobs.length ? '<div class="empty"><div class="empty-icon">' + icon("search") + '</div><h3>No matches in this view yet.</h3><p>Run discovery, adjust your filters or add a job URL and its description. All matches are assessed against your verified profile.</p><button data-action="add-job">+ Add a job</button></div>' : ""}<div class="feed-foot">${jobs.length} opportunities · Scores estimate relevance, not hiring probability. Unknown eligibility always requires review.</div></section>`;
}
function jobsPage() {
  return (
    heading(
      "MAKE ROOM FOR THE RIGHT ROLE",
      "Your opportunity feed",
      "Equal coverage for Product and Founder’s Office. Fintech comes first.",
      `<a class="button-link" href="/api/export">Export CSV ↓</a><button data-action="add-job">+ Add a job</button><button class="primary" data-action="discover">Run discovery</button>`,
    ) +
    `<div class="tabs">${["All", "Product", "Founder’s Office"].map((t) => `<button data-feed-track="${t}" class="${track === t ? "active" : ""}">${t === "All" ? "All opportunities" : t} <span class="muted">${state.jobs.filter((j) => t === "All" || j.assessment.track === t).length}</span></button>`).join("")}</div><div class="filters"><input id="search" aria-label="Search opportunities" placeholder="Search roles, companies or keywords" value="${e(search)}"><select id="collection" aria-label="Saved, shortlisted or dismissed">${["All active", "All", "Saved", "Shortlisted", "Dismissed"].map((t) => `<option ${collection === t ? "selected" : ""}>${t}</option>`).join("")}</select><select id="employment" aria-label="Employment type">${["All", "Internship", "Full-time"].map((t) => `<option ${employment === t ? "selected" : ""}>${t}</option>`).join("")}</select><select id="geography" aria-label="Geography">${["All", "India", "Singapore", "Dubai|UAE|United Arab Emirates", "Remote internships"].map((t) => `<option value="${t}" ${geography === t ? "selected" : ""}>${t === "All" ? "All geographies" : t.startsWith("Dubai") ? "Dubai / UAE" : t}</option>`).join("")}</select><select id="decision" aria-label="Eligibility recommendation">${["All", "Review", "Apply", "Skip"].map((t) => `<option ${decision === t ? "selected" : ""}>${t}</option>`).join("")}</select><select id="min-score" aria-label="Minimum relevance score">${[0, 50, 70, 85].map((n) => `<option value="${n}" ${minScore === n ? "selected" : ""}>${n ? "Score " + n + "+" : "All scores"}</option>`).join("")}</select><select id="sort" aria-label="Sort"><option value="score" ${sort === "score" ? "selected" : ""}>Highest relevance</option><option value="recent" ${sort === "recent" ? "selected" : ""}>Recently found</option></select></div><div id="job-results">${jobTable(filteredJobs())}</div>`
  );
}
function trackerPage() {
  return (
    heading(
      "EVERY APPLICATION, ACCOUNTED FOR",
      "Your application journey",
      "Resume versions, answers, evidence and next steps stay together.",
      `<a class="button-link" href="/api/export">Export CSV ↓</a>`,
    ) +
    `<div class="stat-grid">${[
      [
        "Preparing",
        state.applications.filter((a) => a.status === "Preparing").length,
      ],
      [
        "Ready for final step",
        state.applications.filter((a) => a.status === "Ready for final step")
          .length,
      ],
      [
        "Applied",
        state.applications.filter((a) => a.status === "Applied").length,
      ],
      [
        "Submission uncertain",
        state.applications.filter((a) => a.status === "Submission uncertain")
          .length,
      ],
    ]
      .map(
        ([t, n]) =>
          `<div class="stat"><div class="stat-label">${t}</div><div class="stat-value">${n}</div></div>`,
      )
      .join(
        "",
      )}</div>${jobTable(state.applications.map((a) => jobFor(a.jobId)))}`
  );
}
function paper() {
  return `<div class="resume-preview"><div class="paper"><div class="name">${e(state.profile.name || "YOUR RESUME")}</div><div class="rule"></div>${Array.from({ length: 5 }, () => '<div class="line" style="width:60%;background:#c7d3c0"></div><div class="line"></div><div class="line"></div><div class="line" style="width:85%"></div>').join("")}</div></div>`;
}
function resumesPage() {
  return (
    heading(
      "THE RIGHT STORY FOR EACH ROLE",
      "Your resume library",
      "Original files, immutable versions and a complete application history.",
      `<button class="primary" data-action="upload-resume">+ Upload a version</button>`,
    ) +
    `<div class="resume-grid">${["Product", "Founder’s Office"]
      .map((t) => {
        const versions = state.resumes
          .filter((r) => r.track === t)
          .sort((a, b) => b.version - a.version);
        return `<section class="resume-card"><div class="item-title"><h2>${t}</h2>${badge(versions.length + " version" + (versions.length === 1 ? "" : "s"), "green")}</div>${paper()}<p class="subtle">${t === "Product" ? "APM, Product Analyst, graduate Product and Product Strategy opportunities." : "Founder’s Office, Business Operations and business strategy opportunities."}</p>${
          versions
            .map(
              (r) =>
                `<div class="resume-version"><div class="item-title"><strong>Version ${r.version} ${r.is_default ? badge("Default", "green") : ""}</strong><span class="tiny muted">${date(r.created)}</span></div><p class="tiny muted">${e(r.name)}</p><div class="actions"><a class="button-link small" href="/api/resumes/${r.id}?preview=1" target="_blank" rel="noopener">Preview ↗</a><a class="button-link small" href="/api/resumes/${r.id}">Download ↓</a></div><div class="hash">SHA-256 ${r.sha256}</div><div class="tiny muted" style="margin-top:12px">Used for ${state.applications.filter((a) => a.resumeId === r.id).length} application(s)</div>${state.applications
                  .filter((a) => a.resumeId === r.id)
                  .map(
                    (a) =>
                      `<button class="text-link" style="display:block;margin-top:8px" data-job="${a.jobId}">${e(jobFor(a.jobId).company)} · ${e(jobFor(a.jobId).title)} →</button>`,
                  )
                  .join("")}</div>`,
            )
            .join("") ||
          '<div class="note">Upload your first PDF or DOCX version to prepare applications on this track.</div>'
        }</section>`;
      })
      .join(
        "",
      )}</div><div class="note" style="margin-top:22px">A new default never changes an existing application’s selected version. The file and checksum remain linked to that application.</div>`
  );
}
function field(name, label, value, type = "text", full = false) {
  return `<div class="field ${full ? "full" : ""}"><label for="${name}">${label}</label>${type === "textarea" ? `<textarea id="${name}" name="${name}">${e(value)}</textarea>` : `<input id="${name}" name="${name}" type="${type}" value="${e(value)}">`}</div>`;
}
function profilePage() {
  const p = state.profile;
  return (
    heading(
      "YOUR SOURCE OF TRUTH",
      "Profile & answer bank",
      "Use verified facts. Flag uncertainty. Keep your story accurate.",
    ) +
    `<form id="profile-form"><section class="panel"><div class="panel-header"><h2>Verified profile</h2><button class="primary small">Save profile</button></div><div class="panel-body form-grid">${[
      ["name", "Full name"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["education", "Education"],
      ["graduation", "Expected graduation"],
      ["cpi", "CPI"],
      ["fullTimeStart", "Full-time available from"],
      ["location", "Current country"],
    ]
      .map(([n, l]) =>
        field(n, l, p[n], n === "fullTimeStart" ? "date" : "text"),
      )
      .join(
        "",
      )}${field("internshipAvailability", "Remote internship availability", p.internshipAvailability, "textarea", true)}${field("workAuthorization", "Work authorization — do not infer sponsorship", p.workAuthorization, "textarea", true)}${field("experience", "Verified experience", p.experience, "textarea", true)}${field("facts", "Reusable factual evidence and limitations", p.facts, "textarea", true)}</div></section></form><section class="panel"><div class="panel-header"><h2>Reusable factual answers</h2>${badge("Verified profile only", "green")}</div><div class="panel-body">${[
      [
        "Availability",
        p.internshipAvailability + " Full-time from " + p.fullTimeStart + ".",
      ],
      [
        "Education",
        p.education + "; expected graduation " + p.graduation + ".",
      ],
      ["Experience evidence", p.facts],
    ]
      .map(
        ([q, a]) =>
          `<div class="answer"><div class="answer-top"><strong>${q}</strong><button class="small" data-copy="${e(a)}">Copy</button></div><p class="subtle">${e(a)}</p></div>`,
      )
      .join(
        "",
      )}</div></section><div class="note">Profile updates refresh job eligibility checks. Previously prepared answer packets remain historical snapshots; review them before submission. No AI-generated claims are added.</div>`
  );
}
function activityPage() {
  return (
    heading(
      "A SEARCH YOU CAN FOLLOW",
      "Activity & follow-ups",
      "Discovery health, application changes and evidence in one timeline.",
    ) +
    `<section class="panel"><div class="panel-header"><h2>Upcoming follow-ups</h2></div>${
      state.applications
        .filter((a) => a.followUp)
        .sort((a, b) => a.followUp.localeCompare(b.followUp))
        .map(
          (a) =>
            `<div class="event-row"><button class="text-link" data-job="${a.jobId}">${e(jobFor(a.jobId).company)} · ${e(jobFor(a.jobId).title)}</button><span>${e(a.followUp)}</span></div>`,
        )
        .join("") ||
      '<div class="panel-body muted">Set a follow-up date in any application packet.</div>'
    }</section><section class="panel"><div class="panel-header"><h2>Activity log</h2>${badge("No secret values logged")}</div>${state.events.map((ev) => `<div class="event-row"><div>${badge(ev.kind, ev.kind === "connector_error" ? "orange" : "gray")} <span>${e(ev.message)}</span></div><time>${date(ev.created)}</time></div>`).join("") || '<div class="empty muted">No activity yet.</div>'}</section><section class="panel"><div class="panel-header"><h2>Durable worker queue</h2></div><div class="panel-body">${state.queue.map((q) => `<div class="timeline">${e(q.kind)} · ${badge(q.status, q.status === "done" ? "green" : "gray")}<time>${date(q.finished || q.started || q.created)} ${e(q.error || "")}</time></div>`).join("") || '<span class="muted">No tasks queued.</span>'}</div></section>`
  );
}
function companyWatchlistPanel() {
  const companies = state.companyWatchlist || [];
  if (!companies.length) return "";
  const scheduled = companies.filter(
    (c) => c.coverage === "Scheduled ATS collection",
  ).length;
  return `<section class="panel"><div class="panel-header"><h2>Company watchlist</h2>${badge(companies.length + " targets", "green")}</div><div class="panel-body"><p class="subtle">All 22 requested firms and similar companies are saved for both Product and Founder’s Office. Prefer fintech, YC backing, early stage / Series A or B, and evidenced India hiring or expansion. These are preferences; named firms remain included. Company fit never overrides mandatory job eligibility.</p><div class="actions" style="margin-bottom:15px">${badge(scheduled + " scheduled sources", "green")}${badge(companies.length - scheduled + " manual / paused", "orange")}</div><div class="note">Scheduled means a collector is configured, not that a run succeeded or suitable vacancies exist. Check source health below. Funding labels describe reviewed evidence; the latest round and current expansion plans may remain unknown. Research checked 15 November 2026.</div></div><div class="table-wrap"><table><thead><tr><th>Company / source</th><th>Coverage for both tracks</th><th>Company evidence</th></tr></thead><tbody>${companies.map((c) => `<tr><td><strong>${e(c.name)}</strong><span class="sub">${e(c.group)} · ${e(c.industry)}</span><div>${link(c.careersUrl, "Careers / research")}</div>${c.aliases?.length ? `<span class="sub">Also saved as: ${e(c.aliases.join(", "))}</span>` : ""}</td><td>${badge(c.coverage, c.coverage === "Scheduled ATS collection" ? "green" : "orange")}<div class="sub">${c.sourceHealth ? e("Health: " + c.sourceHealth) : "Manual vacancy review required"}</div><div class="sub">Product + Founder’s Office</div></td><td><div>${c.ycBacked === true ? link(c.ycEvidenceUrl, "YC backing confirmed") : badge("YC backing unknown")}</div><div class="sub">${e(c.fundingStage)}</div>${c.fundingEvidenceUrl ? `<div class="tiny">${link(c.fundingEvidenceUrl, "Funding evidence")}</div>` : ""}<div class="sub">${e(c.indiaSignal)}</div>${c.indiaEvidenceUrl ? `<div class="tiny">${link(c.indiaEvidenceUrl, "India evidence")}</div>` : ""}<div class="sub">${e(c.note)}</div></td></tr>`).join("")}</tbody></table></div></section>`;
}
function settingsPage() {
  const s = state.settings;
  return (
    heading(
      "YOUR SEARCH, YOUR RULES",
      "Settings & sources",
      "Independent discovery. Explicit control over every application.",
    ) +
    `<div class="split"><section class="panel"><div class="panel-header"><h2>Automation</h2></div><form id="settings-form" class="panel-body"><div class="field"><label for="mode">Application mode</label><select id="mode"><option value="track" ${s.mode === "track" ? "selected" : ""}>1 · Discover and track only</option><option value="prepare" ${s.mode === "prepare" ? "selected" : ""}>2 · Prepare for my review (default)</option><option value="auto" ${s.mode === "auto" ? "selected" : ""}>3 · Automatically submit on supported sites</option></select></div><div class="note" style="margin-bottom:18px">Live submission adapters: none. All employer applications currently require manual completion. Enabling automatic mode does not create support for unsupported sites.</div><div class="field"><label for="intervalHours">${state.runtime === "vercel" ? "Local interval (hosted schedule is controlled by vercel.json)" : "Discovery interval (hours)"}</label><input type="number" id="intervalHours" ${state.runtime === "vercel" ? "disabled" : ""} min="1" max="168" value="${s.intervalHours}"></div><div class="field"><label for="dailyLimit">Submission daily limit (reserved for supported adapters)</label><input id="dailyLimit" type="number" min="1" max="50" value="${s.dailyLimit}"></div><label class="check"><input id="paused" type="checkbox" ${s.paused ? "checked" : ""}> Pause scheduled discovery</label><label class="check"><input id="enableAuto" type="checkbox" ${s.mode === "auto" ? "checked" : ""}> I explicitly enable automatic submission only when a supported adapter and verified eligibility are available.</label><button class="primary" style="margin-top:10px">Save settings</button></form></section><section class="panel"><div class="panel-header"><h2>Runtime & privacy</h2></div><div class="panel-body"><div class="kv"><span>Worker heartbeat</span><span>${date(state.workerHeartbeat)}</span></div><div class="kv"><span>Storage</span><span>${state.runtime === "vercel" ? "Turso database + private Vercel Blob" : "Server-side SQLite + private file volume"}</span></div><div class="kv"><span>AI dependency</span><span>None for discovery or matching</span></div><div class="kv"><span>Access</span><span>${state.authEnabled ? "Password protected" : "Local development access — set APP_PASSWORD before hosting"}</span></div><div class="note" style="margin-top:18px">${state.runtime === "vercel" ? "Hosted discovery uses Vercel Cron: daily at approximately 08:30–09:29 IST on Hobby. It runs while your laptop is off. Run discovery is also available manually." : "Discovery runs while your browser is closed when the server or standalone worker is running. Use hosted deployment for discovery while your laptop is off."}</div><a class="button-link" style="margin-top:18px" href="/api/export">Export jobs & applications ↓</a>${state.authEnabled ? '<button data-action="logout" style="margin:18px 0">Sign out</button>' : ""}</div></section></div>${companyWatchlistPanel()}<section class="panel"><div class="panel-header"><h2>Discovery sources</h2><button class="small" data-action="add-source">+ Add ATS board</button></div><div class="panel-body"><p class="subtle">Greenhouse, Lever and Ashby public job boards are supported. Board identifiers must be checked against the employer career page. Collection reads both tracks in every run and does not allocate a larger quota to Product.</p>${state.sources.map((s) => `<div class="source-row"><div><strong>${e(s.company)}</strong><span class="permission">${e(s.kind)} / ${e(s.board)} · ${s.count} potential matches · ${date(s.last_run)}</span>${s.error ? `<span class="permission danger">${e(s.error)}</span>` : ""}</div><div class="actions">${badge(s.health, s.health === "Error" ? "orange" : s.health === "Healthy" ? "green" : "gray")}<button class="small" data-source="${s.id}" data-enabled="${s.enabled ? "0" : "1"}">${s.enabled ? "Pause" : "Enable"}</button></div></div>`).join("")}<div class="note" style="margin-top:18px">Monee and employer career pages without a supported ATS can be tracked by adding job URLs manually. Email ingestion and generic career-page crawling are not connected.</div></div></section>`
  );
}
function modal(title, content, subtitle = "") {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${e(title)}" tabindex="-1"><header class="modal-top"><div><div class="eyebrow">YOUR APPLICATION WORKSPACE</div><h2>${e(title)}</h2><span class="subtle">${e(subtitle)}</span></div><button class="ghost" data-close aria-label="Close dialog">✕</button></header><div class="modal-content">${content}</div></section></div>`;
  document.body.style.overflow = "hidden";
  root.querySelector("[data-close]").onclick = closeModal;
  root.querySelector(".modal-overlay").onclick = (ev) => {
    if (ev.target.classList.contains("modal-overlay")) closeModal();
  };
  root.querySelector(".modal").focus();
  bindShared(root);
}
let previousFocus;
function closeModal() {
  const old = previousFocus;
  $("#modal-root").innerHTML = "";
  document.body.style.overflow = "";
  activeJob = null;
  old?.focus?.();
}
document.addEventListener("keydown", (ev) => {
  const dialog = $(".modal");
  if (!dialog) return;
  if (ev.key === "Escape") closeModal();
  if (ev.key === "Tab") {
    const all = [
      ...dialog.querySelectorAll("button,a[href],input,select,textarea"),
    ].filter((n) => !n.disabled);
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
function openJob(id) {
  previousFocus = document.activeElement;
  activeJob = id;
  const j = jobFor(id),
    a = appFor(id),
    m = j.assessment,
    r =
      a?.resumeSnapshot ||
      state.resumes.find((r) => r.track === m.track && r.is_default);
  modal(
    j.title,
    `${a?.status === "Submission uncertain" ? '<div class="banner">Do not retry this submission. Reconcile the employer account or confirmation email first.</div>' : ""}<div class="actions" style="margin-bottom:18px">${badge(a?.status || "New match", a?.confirmation ? "green" : "orange")}${badge(m.track, "green")}${badge(m.employmentType, "blue")}${j.source === "manual" ? badge("Unverified source") : ""}</div><div class="modal-section"><h3>Original opportunity</h3><div class="actions" style="margin-bottom:15px"><button class="small" data-collection="Saved">Save</button><button class="small" data-collection="Shortlisted">Shortlist</button><button class="small" data-collection="Dismissed">Dismiss</button>${j.collection ? badge(j.collection) : ""}</div><div class="actions">${link(j.originalUrl, "Original job description", "button-link")}${link(j.applyUrl, "Open application", "button-link primary")}</div>${!j.applyUrl ? `<p>No direct application link is available. Open the original job description to locate the employer form.</p>${link(j.originalUrl, "Open application from job description", "button-link")}` : ""}<div class="kv"><span>Location / remote</span><span>${e(j.location)} · ${e(m.remoteEligibility)}</span></div><div class="kv"><span>Vacancy status</span><span>${e(j.active)}</span></div><div class="kv"><span>Evidence</span><span>${e(j.activeEvidence)}</span></div><div class="kv"><span>Dates</span><span>Posted: ${j.postedAt ? date(j.postedAt) : "Unknown"}<br>First seen: ${date(j.firstSeen)}<br>Checked: ${date(j.lastChecked)}<br>Last activity: ${date(a?.updated || j.lastChecked)}</span></div><div class="kv"><span>Compensation</span><span>${j.compensation ? e(JSON.stringify(j.compensation)) : "Not disclosed / unknown"}</span></div><div class="kv"><span>Authorization</span><span>${m.workAuthorization.length ? e(m.workAuthorization.join(" ")) : "No explicit wording found; eligibility unknown"}</span></div></div><div class="modal-section"><div class="item-title"><h3>Fit & mandatory eligibility</h3><span class="score">${m.score} / 100 · ${m.decision}</span></div><p>${e(m.scoreLabel)}</p><p>${e(m.evidence.join(" "))}</p><div class="kv"><span>Score breakdown</span><span>${Object.entries(
      m.parts,
    )
      .map(([k, v]) => `${k}: ${v}`)
      .join(
        " · ",
      )}</span></div>${m.blocked.map((b) => `<p class="danger">✕ ${e(b)}</p>`).join("")}${m.review.map((b) => `<p>○ ${e(b)}</p>`).join("")}</div><div class="modal-section"><h3>${a ? "Selected resume — preserved version" : "Recommended resume — before preparation"}</h3><p>${e(a?.resumeReason || m.reason)}</p><div class="actions">${r ? badge(`${r.track} · Version ${r.version}`, "green") : badge("Resume missing", "orange")}${r ? `<a class="button-link small" href="/api/resumes/${r.id}">Download resume ↓</a>` : ""}</div>${r ? `<p class="tiny" style="overflow-wrap:anywhere">SHA-256 ${r.sha256}</p>` : ""}${a && !a.confirmation && !["Submitting", "Submission uncertain"].includes(a.status) ? `<label for="resume-override" style="margin-top:17px">Approve or override this exact version</label><div class="actions"><select id="resume-override">${state.resumes.map((x) => `<option value="${x.id}" ${a.resumeId === x.id ? "selected" : ""}>${e(x.track)} · v${x.version} · ${e(x.name)}</option>`).join("")}</select><button class="small" id="save-resume">Use this resume</button></div>` : ""}</div>${
      !a
        ? `<button class="primary" id="prepare-job" style="width:100%;margin-bottom:20px">Prepare application packet →</button><div class="note" style="margin-bottom:18px">Work completed: responsibilities classified and eligibility assessed. Remaining: select a resume, review unknown facts and prepare an answer packet. No employer form has been opened or filled.</div>`
        : `<div class="modal-section"><h3>Preparation & remaining steps</h3>${!a.eligibilityReviewed && !a.confirmation ? `<div class="field"><label for="eligibility-notes">Resolve the eligibility questions above</label><textarea id="eligibility-notes" placeholder="Record confirmed work authorization, joining date / hours, and any missing requirements. Do not assume unknown facts."></textarea><button class="small" id="approve-eligibility" style="margin-top:10px">Record eligibility review & mark ready</button></div>` : a.eligibilityNotes ? `<div class="note">User eligibility review: ${e(a.eligibilityNotes)}</div>` : ""}<p><strong>Why automation paused:</strong> ${e(a.pauseReason)}</p><div class="note">Browser handoff: no secure employer session or filled form is preserved. This packet is resumable here. Copy its answers, download its resume and complete the employer form in your own browser.</div><h3 style="margin-top:20px">Work already completed</h3>${a.completed.map((t) => `<p>✓ ${e(t)}</p>`).join("")}<h3 style="margin-top:20px">What’s left</h3>${a.remaining.map((t, i) => `<label class="check"><input type="checkbox" data-check="${i}" ${a.checks.includes(i) ? "checked" : ""}><span>${e(t)}</span></label>`).join("") || "<p>No remaining submission steps recorded.</p>"}</div><div class="modal-section"><h3>Prepared answers</h3><div class="actions"><a class="button-link small" href="/api/packet/${a.id}">Export private browser handoff ↓</a></div><p>Optional: use the included unpacked Chrome extension on supported ATS pages. The packet includes your personal details and resume; keep it private and delete it after use.</p><p>Factual answers come from your profile. Experience summaries need your review for the employer’s question. These are stored drafts; no employer fields have been filled.</p>${a.answers.map((x) => `<div class="answer"><div class="answer-top"><strong>${e(x.question)}</strong><button class="small" data-copy="${e(x.answer)}">Copy</button></div>${badge(x.verified ? "Verified profile answer" : "Draft — review before use", x.verified ? "green" : "orange")}<p>${e(x.answer)}</p></div>`).join("")}<button class="small" id="edit-answers" style="margin-top:15px">Edit / add answers</button></div><div class="modal-section"><h3>Submission confirmation</h3>${a.confirmation ? `${badge(a.confirmation.type, a.confirmation.type === "system-confirmed" ? "green" : "blue")}<p>${e(a.confirmation.evidence)}</p><p>${date(a.confirmation.time)}</p>${a.confirmation.fileId ? `<a class="button-link" href="/api/evidence/${a.confirmation.fileId}">Download confirmation ↓</a>` : ""}` : `<p>After submitting in the employer’s browser, record the confirmation. A checklist alone never marks an application as Applied.</p><label for="confirmation">Confirmation text, reference or email details</label><textarea id="confirmation" placeholder="For example: confirmation email received, reference number, and employer name"></textarea><label for="confirmation-file" style="margin-top:15px">Attach confirmation (optional, up to ${state.runtime === "vercel" ? 3 : 8} MB)</label><input type="file" id="confirmation-file" accept=".pdf,.png,.jpg,.jpeg,.txt"><label class="check"><input type="checkbox" id="confirm-exact">I submitted using the exact resume version shown above.</label><button class="primary" id="confirm-submission" style="margin-top:10px">Mark as submitted — user-confirmed</button>`}</div><div class="modal-section"><h3>Notes & follow-up</h3><label for="app-notes">Notes / contacts</label><textarea id="app-notes">${e(a.notes)}</textarea><label for="follow-up" style="margin-top:14px">Follow-up date</label><input type="date" id="follow-up" value="${e(a.followUp || "")}"><button class="small" id="save-notes" style="margin-top:12px">Save notes</button><label for="app-stage" style="margin-top:20px">Update stage</label><div class="actions"><select id="app-stage">${["Needs my input", "Ready for final step", "Assessment / Interview", "Rejected", "Offer", "Withdrawn", "Closed"].map((s) => `<option ${a.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><button id="save-stage" class="small">Update stage</button></div></div><div class="modal-section"><h3>Application timeline</h3>${state.events
            .filter((ev) => ev.app_id === a.id)
            .map(
              (ev) =>
                `<div class="timeline">${e(ev.message)}<time>${date(ev.created)}</time></div>`,
            )
            .join("")}</div>`
    }<details class="modal-section"><summary>Stored description / source summary</summary><p class="description">${e(j.description || "Description not available. Read the original employer page.")}</p></details>`,
    j.company + " · " + j.location,
  );
  document.querySelectorAll("[data-collection]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("jobs/" + id, { collection: b.dataset.collection });
          await refresh();
          openJob(id);
        } catch (err) {
          toast(err.message);
        }
      }),
  );
  const action = async (data) => {
    try {
      await api("applications/" + a.id, data);
      await refresh();
      openJob(id);
    } catch (err) {
      toast(err.message);
    }
  };
  if (!a)
    $("#prepare-job").onclick = async () => {
      try {
        await api("prepare", { jobId: id });
        await refresh();
        openJob(id);
      } catch (err) {
        toast(err.message);
      }
    };
  if (a) {
    if ($("#edit-answers"))
      $("#edit-answers").onclick = () => editAnswers(a, id);
    if ($("#approve-eligibility"))
      $("#approve-eligibility").onclick = () =>
        action({ action: "eligibility", notes: $("#eligibility-notes").value });
    if ($("#save-resume"))
      $("#save-resume").onclick = () =>
        action({ action: "resume", resumeId: $("#resume-override").value });
    document.querySelectorAll("[data-check]").forEach(
      (n) =>
        (n.onchange = async () => {
          const checks = [
            ...document.querySelectorAll("[data-check]:checked"),
          ].map((n) => Number(n.dataset.check));
          try {
            await api("applications/" + a.id, { action: "checks", checks });
            await refresh(false);
          } catch (err) {
            toast(err.message);
          }
        }),
    );
    if ($("#confirm-submission"))
      $("#confirm-submission").onclick = async () => {
        if (!$("#confirm-exact").checked)
          return toast("Confirm the exact resume version you submitted.");
        const file = $("#confirmation-file").files[0];
        try {
          await action({
            action: "confirm",
            evidence: $("#confirmation").value,
            attachment: file ? await filePayload(file) : null,
          });
        } catch (err) {
          toast(err.message);
        }
      };
    $("#save-notes").onclick = () =>
      action({
        action: "notes",
        notes: $("#app-notes").value,
        followUp: $("#follow-up").value,
      });
    $("#save-stage").onclick = () =>
      action({ action: "stage", status: $("#app-stage").value });
  }
}
async function filePayload(file) {
  if (file.size > (state?.maxUploadBytes || 8 * 1024 * 1024))
    throw new Error(
      "File exceeds the upload limit (3 MB on Vercel, 8 MB locally)",
    );
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mime:
      file.type ||
      (/\.docx$/i.test(file.name)
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/plain"),
    base64,
  };
}
function addJob() {
  modal(
    "Add an opportunity",
    `<form id="job-form">${field("company", "Company", "")}${field("title", "Exact job title", "")}${field("originalUrl", "Original job description URL", "", "url")}${field("applyUrl", "Direct application URL (if available)", "", "url")}${field("location", "Location / explicit remote countries", "")}${field("employmentType", "Employment type (Full-time / Internship / Unknown)", "Unknown")}${field("startDate", "Stated joining date (leave blank if unknown)", "", "date")}${field("industry", "Industry", "")}${field("description", "Full job description or permitted snapshot", "", "textarea")}<div class="note" style="margin-bottom:17px">This saves the supplied text and assesses it. It does not fetch or verify the vacancy page.</div><button class="primary">Save & assess opportunity</button></form>`,
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
function uploadResume() {
  modal(
    "Upload a resume version",
    `<form id="resume-form"><div class="field"><label for="resume-track">Resume track</label><select id="resume-track"><option>Product</option><option>Founder’s Office</option></select></div><div class="field"><label for="resume-file">PDF or DOCX · up to ${state.runtime === "vercel" ? 3 : 8} MB</label><input id="resume-file" type="file" accept=".pdf,.docx" required></div><div class="note" style="margin-bottom:20px">This becomes the default for new preparations in its track. Existing applications retain their exact previous version.</div><button class="primary">Save new version</button></form>`,
  );
  $("#resume-form").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api("resumes", {
        track: $("#resume-track").value,
        ...(await filePayload($("#resume-file").files[0])),
      });
      closeModal();
      view = "resumes";
      await refresh();
      toast("New version saved. Existing applications are unchanged.");
    } catch (err) {
      toast(err.message);
    }
  };
}
function addSource() {
  modal(
    "Connect a public ATS board",
    `<form id="source-form">${field("company", "Company", "")}<div class="field"><label for="kind">Connector</label><select id="kind" name="kind"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select></div>${field("board", "Public board identifier (not a URL)", "")}<div class="note" style="margin-bottom:20px">Copy the board identifier from the employer’s public ATS careers URL. A source error will be shown if the board is unavailable.</div><button class="primary">Add source</button></form>`,
  );
  $("#source-form").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api("sources", Object.fromEntries(new FormData(ev.target)));
      closeModal();
      await refresh();
      toast("Source added. Run discovery to check it.");
    } catch (err) {
      toast(err.message);
    }
  };
}
function bindShared(root = document) {
  root.querySelectorAll("[data-copy]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          toast("Answer copied");
        } catch {
          toast("Clipboard unavailable. Select and copy the visible answer.");
        }
      }),
  );
  root
    .querySelectorAll("[data-job]")
    .forEach((b) => (b.onclick = () => openJob(b.dataset.job)));
}
function bind() {
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        render();
        window.scrollTo(0, 0);
      }),
  );
  document.querySelectorAll("[data-track]").forEach(
    (b) =>
      (b.onclick = () => {
        view = "jobs";
        track = b.dataset.track;
        render();
      }),
  );
  document.querySelectorAll("[data-feed-track]").forEach(
    (b) =>
      (b.onclick = () => {
        track = b.dataset.feedTrack;
        render();
      }),
  );
  bindShared();
  document.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        const a = b.dataset.action;
        if (a === "add-job") addJob();
        if (a === "upload-resume") uploadResume();
        if (a === "add-source") addSource();
        if (a === "logout") {
          await api("logout", {});
          location.reload();
        }
        if (a === "discover") {
          try {
            await api("discover", {});
            toast(
              "Discovery queued. Connector results will appear in Activity.",
            );
            await refresh();
          } catch (err) {
            toast(err.message);
          }
        }
      }),
  );
  document.querySelectorAll("[data-source]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("sources/" + b.dataset.source, {
            enabled: b.dataset.enabled === "1",
          });
          await refresh();
        } catch (err) {
          toast(err.message);
        }
      }),
  );
  if ($("#search")) {
    $("#search").oninput = (ev) => {
      search = ev.target.value;
      $("#job-results").innerHTML = jobTable(filteredJobs());
      bindShared($("#job-results"));
      $("#job-results")
        .querySelector("[data-action]")
        ?.addEventListener("click", addJob);
    };
    for (const [id, fn] of [
      ["collection", (v) => (collection = v)],
      ["employment", (v) => (employment = v)],
      ["decision", (v) => (decision = v)],
      ["geography", (v) => (geography = v)],
      ["min-score", (v) => (minScore = Number(v))],
      ["sort", (v) => (sort = v)],
    ])
      $("#" + id).onchange = (ev) => {
        fn(ev.target.value);
        render();
      };
  }
  if ($("#profile-form"))
    $("#profile-form").onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api("profile", Object.fromEntries(new FormData(ev.target)));
        await refresh();
        toast("Verified profile saved");
      } catch (err) {
        toast(err.message);
      }
    };
  if ($("#settings-form"))
    $("#settings-form").onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api("settings", {
          mode: $("#mode").value,
          paused: $("#paused").checked,
          intervalHours: $("#intervalHours").value,
          dailyLimit: $("#dailyLimit").value,
          enableAuto: $("#enableAuto").checked,
        });
        await refresh();
        toast("Settings saved");
      } catch (err) {
        toast(err.message);
      }
    };
}
await refresh();
setInterval(async () => {
  if (!state) return;
  try {
    const fresh = await api("state");
    const changed = fresh.events[0]?.id !== state.events[0]?.id;
    state = fresh;
    if (
      changed &&
      !activeJob &&
      !["profile", "settings", "resumes"].includes(view) &&
      !$(".modal")
    )
      render();
  } catch {}
}, 15000);

function editAnswers(a, jobId) {
  modal(
    "Edit prepared answers",
    `<form id="answers-form">${a.answers.map((x, i) => `<div class="field"><label>${e(x.question)}</label><textarea name="answer-${i}">${e(x.answer)}</textarea></div>`).join("")}${field("custom-question", "Additional employer question", "")}${field("custom-answer", "Your factual answer", "", "textarea")}<button class="primary">Save answer packet</button></form>`,
  );
  $("#answers-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(ev.target),
      answers = a.answers.map((x, i) => ({
        ...x,
        answer: data.get("answer-" + i),
        verified: false,
      }));
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
    } catch (err) {
      toast(err.message);
    }
  };
}
