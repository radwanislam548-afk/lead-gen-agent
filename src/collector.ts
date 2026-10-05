// Daily lead collection: YouTube, Google Maps (SerpAPI), websites, Apify social actors.

import type { Env } from "./db";
import { extractEmails, guessNiche, insertLead } from "./db";

const SEARCH_QUERIES = [
  "video editing services for youtubers",
  "online coach video editor",
  "video editing agency for creators",
];

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text") && !ct.includes("html")) return "";
    return (await res.text()).slice(0, 200000);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

/** Scrape contact/about pages of a website for emails. */
async function emailsFromWebsite(site: string): Promise<{ emails: string[]; snippet: string }> {
  const base = site.startsWith("http") ? site : `https://${site}`;
  const paths = ["", "/contact", "/contact-us", "/about", "/about-us"];
  const emails = new Set<string>();
  let snippet = "";
  for (const p of paths) {
    const html = await fetchText(base.replace(/\/$/, "") + p);
    if (!html) continue;
    for (const e of extractEmails(html)) emails.add(e);
    if (!snippet) {
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      snippet = text.slice(0, 600);
    }
    if (emails.size >= 3) break;
  }
  return { emails: [...emails].slice(0, 3), snippet };
}

/** YouTube: search channels/videos, pull business emails from channel About. */
async function collectYouTube(env: Env): Promise<number> {
  if (!env.YT_API_KEY) { console.log("YT skipped: no key"); return 0; }
  let added = 0;
  for (const q of SEARCH_QUERIES) {
    try {
      const s = await fetchJson(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=15&q=${encodeURIComponent(q)}&key=${env.YT_API_KEY}`
      );
      const ids: string[] = (s.items ?? []).map((i: any) => i.snippet?.channelId).filter(Boolean);
      if (!ids.length) continue;
      const c = await fetchJson(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids.join(",")}&key=${env.YT_API_KEY}`
      );
      for (const ch of c.items ?? []) {
        const desc: string = ch.snippet?.description ?? "";
        const emails = extractEmails(desc);
        if (!emails.length) continue;
        const subs = Number(ch.statistics?.subscriberCount ?? 0);
        if (subs < 5000 || subs > 1000000) continue; // target band
        const r = await insertLead(env.DB, {
          name: ch.snippet?.title,
          email: emails[0],
          source: "youtube",
          niche: guessNiche(desc + " " + (ch.snippet?.title ?? "")),
          social_url: `https://www.youtube.com/channel/${ch.id}`,
          page_text_snippet: desc.slice(0, 600),
          subs_or_followers: subs,
        });
        if (r.inserted) added++;
      }
    } catch (e) {
      console.log("youtube collect error", q, e);
    }
  }
  console.log(`youtube: +${added}`);
  return added;
}

/** Google Maps via SerpAPI: businesses -> websites -> emails. */
async function collectMaps(env: Env): Promise<number> {
  if (!env.SERPAPI_KEY) { console.log("maps skipped: no key"); return 0; }
  let added = 0;
  const queries = ["video production company", "content creator agency"];
  for (const q of queries) {
    try {
      const s = await fetchJson(
        `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(q)}&api_key=${env.SERPAPI_KEY}`
      );
      for (const b of (s.local_results ?? []).slice(0, 15)) {
        const site: string | undefined = b.website;
        if (!site) continue;
        const { emails, snippet } = await emailsFromWebsite(site);
        if (!emails.length) continue;
        const r = await insertLead(env.DB, {
          name: b.title,
          email: emails[0],
          source: "maps",
          niche: guessNiche((b.title ?? "") + " " + snippet),
          website: site,
          page_text_snippet: snippet,
        });
        if (r.inserted) added++;
      }
    } catch (e) {
      console.log("maps collect error", q, e);
    }
  }
  console.log(`maps: +${added}`);
  return added;
}

/**
 * Apify: run a social actor (e.g. instagram-profile-scraper) and harvest
 * bio emails. Generic runner with bounded polling (Workers time limits).
 */
async function runApifyActor(env: Env, actorId: string, input: any): Promise<any[]> {
  const base = "https://api.apify.com/v2";
  const start = await fetch(`${base}/acts/${actorId}/runs?token=${env.APIFY_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`apify start ${start.status}`);
  const sJson: any = await start.json();
  const runId = sJson.data.id;
  // Poll up to ~90s
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`${base}/actor-runs/${runId}?token=${env.APIFY_API_KEY}`);
    const sj: any = await st.json();
    if (sj.data?.status === "SUCCEEDED") {
      const ds = await fetch(`${base}/actor-runs/${runId}/dataset/items?token=${env.APIFY_API_KEY}&limit=50`);
      const items = await ds.json();
      return Array.isArray(items) ? items : [];
    }
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(sj.data?.status)) break;
  }
  console.log(`apify actor ${actorId} did not finish in time (run ${runId})`);
  return [];
}

async function collectSocial(env: Env): Promise<number> {
  if (!env.APIFY_API_KEY) { console.log("social skipped: no key"); return 0; }
  let added = 0;
  try {
    // Example: instagram profiles mentioning video/creator niches
    const items = await runApifyActor(env, "apify~instagram-profile-scraper", {
      usernames: [], // fill via search in v2; kept minimal for cron safety
    });
    for (const it of items) {
      const bio: string = it.biography ?? "";
      const emails = extractEmails(bio + " " + (it.externalUrl ?? ""));
      if (!emails.length) continue;
      const r = await insertLead(env.DB, {
        name: it.fullName || it.username,
        email: emails[0],
        source: "instagram",
        niche: guessNiche(bio),
        social_url: `https://www.instagram.com/${it.username}/`,
        page_text_snippet: bio.slice(0, 600),
        subs_or_followers: Number(it.followersCount ?? 0) || null,
      });
      if (r.inserted) added++;
    }
  } catch (e) {
    console.log("social collect error", e);
  }
  console.log(`social: +${added}`);
  return added;
}

export async function runCollector(env: Env): Promise<void> {
  console.log("collector start");
  const [yt, maps, social] = await Promise.all([
    collectYouTube(env).catch((e) => (console.log(e), 0)),
    collectMaps(env).catch((e) => (console.log(e), 0)),
    collectSocial(env).catch((e) => (console.log(e), 0)),
  ]);
  console.log(`collector done: yt=${yt} maps=${maps} social=${social}`);
  await env.CONFIG.put("last_collector_run", new Date().toISOString());
}
