// HTTP API: extension scrape trigger, CSV export, unsubscribe, webhooks, lead actions.

import type { Env } from "./db";
import { extractEmails, guessNiche, insertLead, updateLead } from "./db";
import { unsubValid } from "./templates";
import { markReplied } from "./reply-watcher";
import { csvCell } from "./util";

function basicAuth(req: Request, env: Env): boolean {
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  try {
    const [u, p] = atob(h.slice(6)).split(":");
    return u === env.DASHBOARD_USER && p === env.DASHBOARD_PASS;
  } catch {
    return false;
  }
}

function needAuth(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="leadgen"' },
  });
}

function bearerOk(req: Request, env: Env): boolean {
  const h = req.headers.get("Authorization") || "";
  return h === `Bearer ${env.EXTENSION_TOKEN}`;
}

export async function routeApi(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  if (p === "/api/scrape-trigger" && req.method === "POST") return scrapeTrigger(req, env);
  if (p === "/api/export.csv" && req.method === "GET") return exportCsv(req, env, url);
  if (p === "/api/unsubscribe" && req.method === "GET") return unsubscribe(req, env, url);
  if (p === "/api/webhooks/resend" && req.method === "POST") return resendWebhook(req, env);
  const m = p.match(/^\/api\/lead\/(\d+)\/(pause|unsubscribe|resume)$/);
  if (m && req.method === "POST") return leadAction(req, env, Number(m[1]), m[2], url);
  return new Response("Not found", { status: 404 });
}

// ---------- Extension: one-click scrape ----------

interface ScrapePayload {
  url?: string;
  title?: string;
  text?: string;
  emails?: string[];
  social?: string[];
}

async function brightDataFetch(env: Env, targetUrl: string): Promise<string> {
  // Bright Data Web Scraper API. Zone name configured via CONFIG KV (key: brightdata_zone).
  const zone = await env.CONFIG.get("brightdata_zone");
  if (!zone) return "";
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.BRIGHTDATA_API_KEY}`,
    },
    body: JSON.stringify({ zone, url: targetUrl, format: "raw" }),
  });
  if (!res.ok) {
    console.log(`brightdata ${res.status}`);
    return "";
  }
  return (await res.text()).slice(0, 200000);
}

async function scrapeTrigger(req: Request, env: Env): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Forbidden", { status: 403 });
  let body: ScrapePayload;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const pageUrl = (body.url || "").slice(0, 500);
  const title = (body.title || "").slice(0, 300);
  const text = (body.text || "").slice(0, 8000);
  if (!pageUrl) return Response.json({ ok: false, error: "missing_url" }, { status: 400 });

  let emails = (body.emails ?? []).map((e) => e.toLowerCase()).slice(0, 5);
  let deepScraped = false;

  // No email on the page? Try Bright Data deep scrape (contact page etc.)
  if (!emails.length && env.BRIGHTDATA_API_KEY) {
    const html = await brightDataFetch(env, pageUrl);
    if (html) {
      emails = extractEmails(html).slice(0, 5);
      deepScraped = true;
    }
  }

  if (!emails.length) {
    return Response.json({ ok: false, error: "no_email_found", deepScraped }, { status: 200 });
  }

  const niche = guessNiche(`${title} ${text}`);
  const social = (body.social ?? [])[0];
  const r = await insertLead(env.DB, {
    name: title || undefined,
    email: emails[0],
    source: "extension",
    niche,
    website: pageUrl,
    social_url: social,
    page_title: title,
    page_text_snippet: text.slice(0, 600),
  });

  return Response.json({
    ok: true,
    inserted: r.inserted,
    reason: r.reason,
    lead_id: r.id,
    email: emails[0],
    niche,
    deepScraped,
  });
}

// ---------- CSV export ----------

const CSV_COLS = [
  "id", "name", "email", "source", "niche", "website", "social_url",
  "status", "first_line", "sent_at", "followup_count", "replied_at", "created_at",
] as const;

async function exportCsv(req: Request, env: Env, url: URL): Promise<Response> {
  if (!basicAuth(req, env)) return needAuth();
  const status = url.searchParams.get("status") || "";
  const source = url.searchParams.get("source") || "";
  const conds: string[] = [];
  const vals: any[] = [];
  if (status) { conds.push("status = ?"); vals.push(status); }
  if (source) { conds.push("source = ?"); vals.push(source); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const res = await env.DB.prepare(
    `SELECT ${CSV_COLS.join(", ")} FROM leads ${where} ORDER BY id DESC LIMIT 5000`
  )
    .bind(...vals)
    .all<Record<string, any>>();

  const lines = [CSV_COLS.join(",")];
  for (const row of res.results ?? []) {
    lines.push(CSV_COLS.map((c) => csvCell(row[c])).join(","));
  }
  // BOM so Excel opens UTF-8 correctly
  const csv = "﻿" + lines.join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
    },
  });
}

// ---------- Unsubscribe ----------

async function unsubscribe(req: Request, env: Env, url: URL): Promise<Response> {
  const email = (url.searchParams.get("email") || "").toLowerCase();
  const sig = url.searchParams.get("sig") || "";
  const lead = await env.DB.prepare(`SELECT * FROM leads WHERE email = ?`).bind(email).first<any>();
  if (!lead || !unsubValid(lead, sig, env)) {
    return new Response("Invalid link.", { status: 400 });
  }
  await updateLead(env.DB, lead.id, { status: "unsubscribed" });
  return new Response(
    `<html><body style="font-family:sans-serif;text-align:center;padding:60px">` +
      `<h2>You've been unsubscribed.</h2><p>No more emails from Jepy Studio outreach.</p>` +
      `</body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

// ---------- Resend webhook ----------

async function resendWebhook(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  // Resend (Svix) event shape: { type, data: { to, ... } }
  const type: string = body.type || "";
  const to: string | undefined = body.data?.to?.[0] || body.data?.to;
  console.log("webhook", type, to);
  if (to) {
    const email = String(to).toLowerCase();
    if (type === "email.replied") {
      await markReplied(env.DB, email);
    } else if (type === "email.bounced") {
      await env.DB.prepare(`UPDATE leads SET status='bounced' WHERE email=?`).bind(email).run();
    } else if (type === "email.complained") {
      await env.DB.prepare(`UPDATE leads SET status='unsubscribed' WHERE email=?`).bind(email).run();
    }
  }
  return Response.json({ ok: true });
}

// ---------- Dashboard lead actions ----------

async function leadAction(
  req: Request,
  env: Env,
  id: number,
  action: string,
  url: URL
): Promise<Response> {
  if (!basicAuth(req, env)) return needAuth();
  if (action === "pause") await updateLead(env.DB, id, { status: "paused" });
  else if (action === "unsubscribe") await updateLead(env.DB, id, { status: "unsubscribed" });
  else if (action === "resume") {
    const lead = await env.DB.prepare(`SELECT first_line FROM leads WHERE id=?`).bind(id).first<{ first_line: string | null }>();
    await updateLead(env.DB, id, { status: lead?.first_line ? "personalized" : "new" });
  }
  return Response.redirect(`${url.origin}/dashboard`, 303);
}
