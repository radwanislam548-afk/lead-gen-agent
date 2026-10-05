// Simple dashboard: stats, filters, lead table, CSV export, actions.

import type { Env, Lead } from "./db";
import { countByStatus, totalLeads } from "./db";

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

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const STATUSES = ["new", "personalized", "sent", "followup1", "followup2", "replied", "bounced", "unsubscribed", "paused"];
const SOURCES = ["youtube", "maps", "website", "instagram", "tiktok", "extension"];

export async function renderDashboard(req: Request, env: Env, url: URL): Promise<Response> {
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ") || !basicAuth(req, env)) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="leadgen"' } });
  }

  const fStatus = url.searchParams.get("status") || "";
  const fSource = url.searchParams.get("source") || "";

  const [counts, total] = await Promise.all([countByStatus(env.DB), totalLeads(env.DB)]);
  const sentTotal = (counts["sent"] ?? 0) + (counts["followup1"] ?? 0) + (counts["followup2"] ?? 0) + (counts["replied"] ?? 0);
  const replyRate = sentTotal ? Math.round(((counts["replied"] ?? 0) / sentTotal) * 100) : 0;

  const conds: string[] = [];
  const vals: any[] = [];
  if (fStatus) { conds.push("status = ?"); vals.push(fStatus); }
  if (fSource) { conds.push("source = ?"); vals.push(fSource); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const leads = await env.DB.prepare(
    `SELECT * FROM leads ${where} ORDER BY id DESC LIMIT 100`
  ).bind(...vals).all<Lead>();

  const statCards = STATUSES.map(
    (s) => `<div class="card"><div class="num">${counts[s] ?? 0}</div><div class="lbl">${s}</div></div>`
  ).join("");

  const rows = (leads.results ?? []).map((l) => {
    const action =
      l.status === "paused"
        ? `<form method="post" action="/api/lead/${l.id}/resume"><button>Resume</button></form>`
        : `<form method="post" action="/api/lead/${l.id}/pause"><button>Pause</button></form>
           <form method="post" action="/api/lead/${l.id}/unsubscribe"><button>Unsub</button></form>`;
    return `<tr>
      <td>${l.id}</td><td>${esc(l.name)}</td><td>${esc(l.email)}</td>
      <td>${esc(l.source)}</td><td>${esc(l.niche)}</td><td><span class="pill">${esc(l.status)}</span></td>
      <td>${esc((l.first_line || "").slice(0, 60))}</td><td class="acts">${action}</td>
    </tr>`;
  }).join("");

  const opt = (list: string[], cur: string, all: string) =>
    `<option value="">${all}</option>` + list.map((s) => `<option value="${s}"${s === cur ? " selected" : ""}>${s}</option>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lead Gen Dashboard</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#0f1115;color:#e8e8e8;padding:20px}
h1{font-size:20px}.cards{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.card{background:#1a1e26;border-radius:10px;padding:12px 18px;min-width:90px}
.num{font-size:24px;font-weight:700}.lbl{font-size:12px;color:#999}
.bar{display:flex;gap:10px;align-items:center;margin:16px 0;flex-wrap:wrap}
select,button{padding:8px 12px;border-radius:8px;border:1px solid #333;background:#1a1e26;color:#e8e8e8}
button{cursor:pointer}.btn-green{background:#166534;border-color:#166534}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px;border-bottom:1px solid #222;text-align:left;vertical-align:top}
.pill{background:#2a3040;border-radius:20px;padding:2px 10px;font-size:12px}
.acts form{display:inline}
.meta{color:#999;font-size:13px}
</style></head><body>
<h1>🎯 Lead Gen Dashboard</h1>
<div class="meta">Total leads: <b>${total}</b> · Reply rate: <b>${replyRate}%</b></div>
<div class="cards">${statCards}</div>
<form class="bar" method="get" action="/dashboard">
  <select name="status">${opt(STATUSES, fStatus, "All statuses")}</select>
  <select name="source">${opt(SOURCES, fSource, "All sources")}</select>
  <button type="submit">Filter</button>
  <a href="/api/export.csv?status=${encodeURIComponent(fStatus)}&source=${encodeURIComponent(fSource)}"><button type="button" class="btn-green">⬇ Export CSV</button></a>
</form>
<table><tr><th>ID</th><th>Name</th><th>Email</th><th>Source</th><th>Niche</th><th>Status</th><th>First line</th><th></th></tr>${rows}</table>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
