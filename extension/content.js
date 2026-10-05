// Content script: extracts lead-ish data from the current page.

function extractEmails(text) {
  const found = new Set();
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const e = m[0].toLowerCase();
    if (/\.(png|jpg|jpeg|svg|gif)$/.test(e)) continue;
    if (/^(noreply|no-reply|donotreply|example@|test@)/.test(e)) continue;
    found.add(e);
    if (found.size >= 10) break;
  }
  return [...found];
}

function extractSocial() {
  const out = [];
  const domains = ["youtube.com", "instagram.com", "tiktok.com", "linkedin.com", "twitter.com", "x.com", "facebook.com"];
  document.querySelectorAll("a[href]").forEach((a) => {
    try {
      const u = new URL(a.href);
      if (domains.some((d) => u.hostname.includes(d)) && u.href !== location.href) out.push(u.href);
    } catch {}
  });
  return [...new Set(out)].slice(0, 10);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "extract") return;
  try {
    const bodyText = (document.body?.innerText || "").slice(0, 8000);
    const mailtos = [...document.querySelectorAll('a[href^="mailto:"]')].map((a) =>
      a.getAttribute("href").replace(/^mailto:/i, "").split("?")[0].toLowerCase()
    );
    const emails = [...new Set([...mailtos, ...extractEmails(bodyText)])].slice(0, 10);
    sendResponse({
      url: location.href,
      title: document.title,
      text: bodyText,
      emails,
      social: extractSocial(),
    });
  } catch (e) {
    sendResponse({ url: location.href, title: document.title, text: "", emails: [], social: [] });
  }
  return true;
});
