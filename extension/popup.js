// Popup: settings + scrape button -> content script -> Worker API.

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const s = await chrome.storage.sync.get(["workerUrl", "token"]);
  if (s.workerUrl) $("workerUrl").value = s.workerUrl;
  if (s.token) $("token").value = s.token;
}

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    workerUrl: $("workerUrl").value.trim().replace(/\/$/, ""),
    token: $("token").value.trim(),
  });
  setStatus("Settings saved.", true);
});

function setStatus(msg, ok) {
  const el = $("status");
  el.textContent = msg;
  el.className = ok ? "ok" : "err";
}

$("scrape").addEventListener("click", async () => {
  setStatus("Scraping…", true);
  try {
    const { workerUrl, token } = await chrome.storage.sync.get(["workerUrl", "token"]);
    if (!workerUrl || !token) {
      setStatus("Set Worker URL + token in Settings first.", false);
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) {
      setStatus("Open a normal web page first.", false);
      return;
    }
    const data = await chrome.tabs.sendMessage(tab.id, { action: "extract" });
    const res = await fetch(`${workerUrl}/api/scrape-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    const j = await res.json();
    if (j.ok) {
      setStatus(j.inserted ? `✅ Lead saved: ${j.email}` : `ℹ️ ${j.reason || "already saved"}: ${j.email || ""}`, true);
    } else {
      setStatus(`❌ ${j.error === "no_email_found" ? "No email found on this page." : j.error || "failed"}`, false);
    }
  } catch (e) {
    setStatus(`❌ ${e.message || e}`, false);
  }
});

loadSettings();
