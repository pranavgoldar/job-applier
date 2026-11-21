// Fallback for application pages on a company's own website: fill the page you
// are looking at with the job you last opened from the dashboard.
const $ = (id) => document.getElementById(id);
(async () => {
  const { job } = await chrome.runtime.sendMessage({ type: "status" });
  if (!job) {
    $("status").textContent =
      "Open a job in your Career OS dashboard and press Apply. The form fills itself on supported sites.";
    return;
  }
  $("status").textContent =
    `Ready for: ${job.title} at ${job.company}. Use this button if the form on this page was not filled automatically.`;
  $("fill").disabled = false;
  $("fill").onclick = async () => {
    $("fill").disabled = true;
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.runtime.sendMessage({ type: "adopt", tabId: tab.id });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["fill.js", "content.js"],
      });
      $("out").textContent =
        "Done. Look at the panel in the corner of the page.";
    } catch (e) {
      $("out").textContent = "Could not fill this page: " + e.message;
    }
    $("fill").disabled = false;
  };
})();
