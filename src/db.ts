// Shared environment bindings + D1 helpers

export interface Env {
  DB: D1Database;
  CONFIG: KVNamespace;
  RESEND_API_KEY: string;
  MANIFEST_API_KEY: string;
  MANIFEST_BASE_URL: string;
  APIFY_API_KEY: string;
  BRIGHTDATA_API_KEY: string;
  SERPAPI_KEY: string;
  YT_API_KEY: string;
  EXTENSION_TOKEN: string;
  FROM_EMAIL: string;
  FROM_NAME: string;
  DASHBOARD_USER: string;
  DASHBOARD_PASS: string;
  DAILY_SEND_CAP: string;
  ORIGIN: string;
}

export interface Lead {
  id: number;
  name: string | null;
  email: string;
  source: string | null;
  niche: string | null;
  website: string | null;
  social_url: string | null;
  page_title: string | null;
  page_text_snippet: string | null;
  subs_or_followers: number | null;
  status: string;
  first_line: string | null;
  sent_at: string | null;
  followup_count: number;
  replied_at: string | null;
  created_at: string;
}

export interface NewLead {
  name?: string;
  email: string;
  source: string;
  niche?: string;
  website?: string;
  social_url?: string;
  page_title?: string;
  page_text_snippet?: string;
  subs_or_followers?: number;
}

const TERMINAL = new Set(["replied", "bounced", "unsubscribed", "paused"]);

/** Insert a lead; returns { inserted:false, reason } if duplicate or terminal. */
export async function insertLead(
  db: D1Database,
  lead: NewLead
): Promise<{ inserted: boolean; id?: number; reason?: string }> {
  const email = lead.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { inserted: false, reason: "invalid_email" };
  }
  if (/^(noreply|no-reply|donotreply|mailer-daemon)@/i.test(email)) {
    return { inserted: false, reason: "role_account" };
  }
  try {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO leads
         (name, email, source, niche, website, social_url, page_title, page_text_snippet, subs_or_followers, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
      )
      .bind(
        lead.name ?? null,
        email,
        lead.source,
        lead.niche ?? null,
        lead.website ?? null,
        lead.social_url ?? null,
        lead.page_title ?? null,
        lead.page_text_snippet ?? null,
        lead.subs_or_followers ?? null
      )
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return { inserted: false, reason: "duplicate" };
    }
    return { inserted: true, id: Number(res.meta.last_row_id) };
  } catch (e) {
    console.log("insertLead error", e);
    return { inserted: false, reason: "db_error" };
  }
}

export async function getLeadsByStatus(
  db: D1Database,
  status: string,
  limit = 50
): Promise<Lead[]> {
  const res = await db
    .prepare(`SELECT * FROM leads WHERE status = ? ORDER BY id LIMIT ?`)
    .bind(status, limit)
    .all<Lead>();
  return res.results ?? [];
}

export async function getLead(db: D1Database, id: number): Promise<Lead | null> {
  return await db
    .prepare(`SELECT * FROM leads WHERE id = ?`)
    .bind(id)
    .first<Lead>();
}

export async function updateLead(
  db: D1Database,
  id: number,
  fields: Partial<Pick<Lead, "status" | "first_line" | "sent_at" | "followup_count" | "replied_at" | "niche">>
): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => (fields as any)[k] ?? null);
  await db
    .prepare(`UPDATE leads SET ${set} WHERE id = ?`)
    .bind(...vals, id)
    .run();
}

export async function countByStatus(db: D1Database): Promise<Record<string, number>> {
  const res = await db
    .prepare(`SELECT status, COUNT(*) as n FROM leads GROUP BY status`)
    .all<{ status: string; n: number }>();
  const out: Record<string, number> = {};
  for (const r of res.results ?? []) out[r.status] = r.n;
  return out;
}

export async function totalLeads(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) as n FROM leads`).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Leads due for followup1: sent >=3 days ago, no followup yet. */
export async function dueFollowup1(db: D1Database, limit = 50): Promise<Lead[]> {
  const res = await db
    .prepare(
      `SELECT * FROM leads
       WHERE status = 'sent' AND followup_count = 0
         AND sent_at <= datetime('now', '-3 days')
       ORDER BY sent_at LIMIT ?`
    )
    .bind(limit)
    .all<Lead>();
  return res.results ?? [];
}

/** Leads due for followup2: followup1 sent >=4 days ago (7 days after cold). */
export async function dueFollowup2(db: D1Database, limit = 50): Promise<Lead[]> {
  const res = await db
    .prepare(
      `SELECT l.* FROM leads l
       JOIN email_log e ON e.lead_id = l.id AND e.type = 'followup1'
       WHERE l.status = 'followup1'
         AND e.sent_at <= datetime('now', '-4 days')
       GROUP BY l.id
       ORDER BY MAX(e.sent_at) LIMIT ?`
    )
    .bind(limit)
    .all<Lead>();
  return res.results ?? [];
}

export async function logEmail(
  db: D1Database,
  leadId: number,
  type: string,
  resendId?: string
): Promise<void> {
  await db
    .prepare(`INSERT INTO email_log (lead_id, type, resend_id) VALUES (?, ?, ?)`)
    .bind(leadId, type, resendId ?? null)
    .run();
}

export async function recentSentEmails(
  db: D1Database,
  hours = 48,
  limit = 100
): Promise<{ lead_id: number; resend_id: string | null; type: string }[]> {
  const res = await db
    .prepare(
      `SELECT lead_id, resend_id, type FROM email_log
       WHERE sent_at >= datetime('now', ? || ' hours') AND resend_id IS NOT NULL
       ORDER BY sent_at DESC LIMIT ?`
    )
    .bind(`-${hours}`, limit)
    .all<{ lead_id: number; resend_id: string | null; type: string }>();
  return res.results ?? [];
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

/** Extract emails from arbitrary text; filters obvious junk. */
export function extractEmails(text: string): string[] {
  const found = new Set<string>();
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const e = m[0].toLowerCase();
    if (e.endsWith(".png") || e.endsWith(".jpg") || e.endsWith(".svg")) continue;
    if (/^(noreply|no-reply|donotreply|example@|test@)/i.test(e)) continue;
    found.add(e);
  }
  return [...found].slice(0, 20);
}

/** Very rough niche guess from text/url. */
export function guessNiche(text: string): string {
  const t = text.toLowerCase();
  if (/youtuber|subscriber|channel|vlog/.test(t)) return "youtuber";
  if (/coach|mentor|course|webinar/.test(t)) return "coach";
  if (/agency|studio|marketing/.test(t)) return "agency";
  if (/saas|software|app\b/.test(t)) return "saas";
  if (/shop|store|ecommerce|e-commerce/.test(t)) return "ecommerce";
  if (/podcast/.test(t)) return "podcast";
  return "business";
}
