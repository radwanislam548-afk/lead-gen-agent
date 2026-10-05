// Due follow-ups: followup1 at day 3, followup2 (breakup) at day 7.

import type { Env } from "./db";
import { dueFollowup1, dueFollowup2, logEmail, updateLead } from "./db";
import { followup1Email, followup2Email } from "./templates";

async function sendViaResend(env: Env, to: string, subject: string, html: string, text: string): Promise<string | null> {
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
    }),
  });
  if (!res.ok) {
    console.log(`resend fu ${res.status} for ${to}`);
    return null;
  }
  const j: any = await res.json();
  return j.id ?? "sent";
}

export async function runFollowup(env: Env, origin: string): Promise<void> {
  console.log("followup start");
  let n1 = 0, n2 = 0;

  for (const lead of await dueFollowup1(env.DB, 40)) {
    const mail = followup1Email(lead, env, origin);
    const id = await sendViaResend(env, lead.email, mail.subject, mail.html, mail.text);
    if (!id) break;
    await logEmail(env.DB, lead.id, "followup1", id);
    await updateLead(env.DB, lead.id, { status: "followup1", followup_count: 1 });
    n1++;
    await new Promise((r) => setTimeout(r, 800));
  }

  for (const lead of await dueFollowup2(env.DB, 40)) {
    const mail = followup2Email(lead, env, origin);
    const id = await sendViaResend(env, lead.email, mail.subject, mail.html, mail.text);
    if (!id) break;
    await logEmail(env.DB, lead.id, "followup2", id);
    await updateLead(env.DB, lead.id, { status: "followup2", followup_count: 2 });
    n2++;
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(`followup done: fu1=${n1} fu2=${n2}`);
}
