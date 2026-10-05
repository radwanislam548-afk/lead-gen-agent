// Hourly watcher: bounce/complaint handling via Resend email status.
// Reply detection is primarily webhook-driven (POST /api/webhooks/resend);
// this cron catches bounces so we stop mailing dead addresses.

import type { Env } from "./db";
import { recentSentEmails, updateLead } from "./db";

async function resendStatus(env: Env, emailId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    // Resend returns last_event among: sent, delivered, bounced, complained, opened, clicked
    return j.last_event ?? null;
  } catch {
    return null;
  }
}

export async function runReplyWatcher(env: Env): Promise<void> {
  console.log("reply-watcher start");
  const emails = await recentSentEmails(env.DB, 72, 80);
  let bounced = 0;
  for (const e of emails) {
    if (!e.resend_id) continue;
    const st = await resendStatus(env, e.resend_id);
    if (st === "bounced") {
      await updateLead(env.DB, e.lead_id, { status: "bounced" });
      bounced++;
    } else if (st === "complained") {
      await updateLead(env.DB, e.lead_id, { status: "unsubscribed" });
      bounced++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`reply-watcher done: flagged=${bounced} checked=${emails.length}`);
}

/** Called by the Resend webhook for reply events. */
export async function markReplied(db: D1Database, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const res = await db
    .prepare(`UPDATE leads SET status = 'replied', replied_at = datetime('now') WHERE email = ? AND status NOT IN ('replied','unsubscribed','bounced')`)
    .bind(e)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
