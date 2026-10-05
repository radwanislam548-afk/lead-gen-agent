// Service worker: right-click context menu -> scrape without opening popup.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "scrape-lead",
    title: "Scrape lead from this page",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "scrape-lead" || !tab?.id) return;
  try {
    const { workerUrl, token } = await chrome.storage.sync.get(["workerUrl", "token"]);
    if (!workerUrl || !token) return;
    const data = await chrome.tabs.sendMessage(tab.id, { action: "extract" });
    await fetch(`${workerUrl}/api/scrape-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn("scrape failed", e);
  }
});
