// Daily batch sender via Resend. Respects DAILY_SEND_CAP via KV counter.

import type { Env } from "./db";
import { getLeadsByStatus, logEmail, updateLead } from "./db";
import { coldEmail, unsubUrl } from "./templates";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sentToday(env: Env): Promise<number> {
  const v = await env.CONFIG.get(`sent:${todayKey()}`);
  return Number(v ?? 0);
}

async function bumpSent(env: Env): Promise<void> {
  const n = (await sentToday(env)) + 1;
  // expire after 2 days
  await env.CONFIG.put(`sent:${todayKey()}`, String(n), { expirationTtl: 172800 });
}

async function sendOne(
  env: Env,
  to: string,
  subject: string,
  html: string,
  text: string,
  listUnsub?: string
): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text,
      ...(listUnsub ? { headers: { "List-Unsubscribe": `<${listUnsub}>` } } : {}),
    }),
  });
  if (!res.ok) {
    console.log(`resend ${res.status} for ${to}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const j: any = await res.json();
  return j.id ?? "sent";
}

export async function runSender(env: Env, origin: string): Promise<void> {
  console.log("sender start");
  const cap = Number(env.DAILY_SEND_CAP || "20");
  const used = await sentToday(env);
  const remaining = cap - used;
  if (remaining <= 0) {
    console.log(`sender: daily cap reached (${cap})`);
    return;
  }
  const leads = await getLeadsByStatus(env.DB, "personalized", Math.min(remaining, 50));
  let sent = 0;
  for (const lead of leads) {
    const mail = coldEmail(lead, env, origin);
    const id = await sendOne(env, lead.email, mail.subject, mail.html, mail.text, unsubUrl(origin, lead, env));
    if (id) {
      await logEmail(env.DB, lead.id, "cold", id);
      await updateLead(env.DB, lead.id, { status: "sent", sent_at: new Date().toISOString() });
      await bumpSent(env);
      sent++;
    } else {
      // don't hammer on failures
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log(`sender done: ${sent}/${leads.length} (cap ${cap}, used ${used})`);
}
