// Runs on the Career OS dashboard only. It lets the dashboard page talk to the
// extension: start an application, and collect "submitted" results.
(() => {
  const version = chrome.runtime.getManifest().version;
  const isDashboard = () =>
    !!document.querySelector('meta[name="career-os"][content="dashboard"]');
  document.documentElement.dataset.careerOsExtension = version;
  const post = (data) =>
    window.postMessage(
      { source: "career-os-extension", ...data },
      location.origin,
    );
  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      data?.target !== "career-os-extension" ||
      !isDashboard()
    )
      return;
    let reply;
    try {
      reply = await chrome.runtime.sendMessage(data.message);
    } catch (e) {
      reply = { error: "The extension was reloaded. Refresh this page." };
    }
    post({ id: data.id, reply });
  });
  // Tell the page whenever a new result is waiting.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.results && isDashboard())
      post({ type: "results", results: changes.results.newValue || [] });
  });
})();
