// Keeps track of which browser tab is applying to which job, hands the form
// filler its data, and holds "submitted" results until the dashboard collects them.
const session = chrome.storage.session,
  local = chrome.storage.local;
const read = async (area, key, fallback) =>
  (await area.get(key))[key] ?? fallback;

async function startApplication(packet) {
  if (!packet?.jobId || !/^https:\/\//.test(packet.applyUrl || ""))
    throw new Error("This job has no secure application link");
  const { resume, ...job } = packet;
  const jobs = await read(session, "jobs", {}),
    resumes = await read(session, "resumes", {}),
    tabs = await read(session, "tabs", {});
  // Resumes are large and shared by many jobs: keep each one once.
  if (resume?.id) resumes[resume.id] = resume;
  jobs[job.jobId] = { ...job, resumeId: resume?.id || null, formSeen: false };
  // Record the tab before it loads, so its first page is already recognised.
  const tab = await chrome.tabs.create({ url: "about:blank" });
  tabs[tab.id] = job.jobId;
  await session.set({ jobs, resumes, tabs, latest: job.jobId });
  await chrome.tabs.update(tab.id, { url: packet.applyUrl });
  return { ok: true };
}
async function packetFor(jobId) {
  const jobs = await read(session, "jobs", {}),
    job = jobs[jobId];
  if (!job) return null;
  const resumes = await read(session, "resumes", {});
  return { ...job, resume: resumes[job.resumeId] || null };
}
async function jobIdForTab(tabId) {
  return (await read(session, "tabs", {}))[tabId] || null;
}
async function patchJob(jobId, patch) {
  const jobs = await read(session, "jobs", {});
  if (!jobs[jobId]) return;
  jobs[jobId] = { ...jobs[jobId], ...patch };
  await session.set({ jobs });
}
async function recordSubmitted(jobId, url) {
  const jobs = await read(session, "jobs", {}),
    job = jobs[jobId];
  if (!job || job.submitted) return;
  const results = await read(local, "results", []);
  if (!results.some((r) => r.jobId === jobId))
    results.push({
      jobId,
      company: job.company,
      title: job.title,
      // Only claim a resume when this extension attached it itself.
      resumeId: job.report?.resume === "attached" ? job.resumeId : null,
      url: String(url || "").slice(0, 300),
      at: new Date().toISOString(),
    });
  await local.set({ results });
  await patchJob(jobId, { submitted: true });
}

const handlers = {
  // From the dashboard page (through bridge.js)
  apply: (m) => startApplication(m.packet),
  results: async () => ({ results: await read(local, "results", []) }),
  ack: async (m) => {
    const done = new Set(m.jobIds || []);
    await local.set({
      results: (await read(local, "results", [])).filter(
        (r) => !done.has(r.jobId),
      ),
    });
    return { ok: true };
  },
  // From the form filler running in an application tab
  hello: async (m, sender) => {
    const jobId = await jobIdForTab(sender.tab?.id);
    return { packet: jobId ? await packetFor(jobId) : null };
  },
  filled: async (m, sender) => {
    const jobId = await jobIdForTab(sender.tab?.id);
    if (jobId)
      await patchJob(jobId, {
        formSeen: true,
        report: { filled: m.filled, needs: m.needs, resume: m.resume },
      });
    return { ok: true };
  },
  submitted: async (m, sender) => {
    const jobId = await jobIdForTab(sender.tab?.id);
    if (jobId) await recordSubmitted(jobId, m.url);
    return { ok: true };
  },
  // From the popup
  status: async () => {
    const latest = await read(session, "latest", null);
    return { job: latest ? await packetFor(latest) : null };
  },
  adopt: async (m) => {
    // The popup asked to fill the current tab: treat it as this job's tab.
    const latest = await read(session, "latest", null);
    if (!latest) return { packet: null };
    const tabs = await read(session, "tabs", {});
    tabs[m.tabId] = latest;
    await session.set({ tabs });
    return { packet: await packetFor(latest) };
  },
};
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message, sender).then(reply, (e) => reply({ error: e.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await read(session, "tabs", {});
  if (tabs[tabId]) {
    delete tabs[tabId];
    await session.set({ tabs });
  }
});

// Fill application pages on any site, but only in tabs this extension opened
// for an application (or that you chose with "Fill this page"). Each page and
// frame gets the filler once it has loaded; the filler then watches the page.
async function inject(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target:
        frameId === undefined
          ? { tabId, allFrames: true }
          : { tabId, frameIds: [frameId] },
      files: ["fill.js", "content.js"],
    });
  } catch {
    // Pages the browser protects (chrome://, the Web Store) cannot be filled.
  }
}
chrome.webNavigation.onCompleted.addListener(
  async ({ tabId, frameId, url }) => {
    if (!/^https?:/.test(url || "")) return;
    if (await jobIdForTab(tabId)) await inject(tabId, frameId);
  },
);
