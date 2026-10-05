// AI personalization via Manifest gateway (OpenAI-compatible, auto-fallback).

import type { Env } from "./db";
import { getLeadsByStatus, updateLead } from "./db";

function buildPrompt(lead: {
  name: string | null;
  niche: string | null;
  website: string | null;
  page_text_snippet: string | null;
}): string {
  const ctx = [
    lead.name ? `Name: ${lead.name}` : "",
    lead.niche ? `Niche: ${lead.niche}` : "",
    lead.website ? `Website: ${lead.website}` : "",
    lead.page_text_snippet ? `About them: ${lead.page_text_snippet.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    `You are writing a cold outreach opening line for a video editing agency (Jepy Studio).\n` +
    `Lead context:\n${ctx}\n\n` +
    `Write ONE natural, specific opening line (max 20 words) referencing something real about their content or business. ` +
    `No flattery cliches, no "I hope this email finds you well", no exclamation marks. Plain, human tone.`
  );
}

async function personalizeOne(env: Env, lead: { id: number; name: string | null; niche: string | null; website: string | null; page_text_snippet: string | null }): Promise<string | null> {
  const url = `${env.MANIFEST_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MANIFEST_API_KEY}`,
      },
      body: JSON.stringify({
        model: "auto", // Manifest routes + falls back automatically
        messages: [{ role: "user", content: buildPrompt(lead) }],
        max_tokens: 80,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      console.log(`manifest ${res.status} for lead ${lead.id}`);
      return null;
    }
    const j: any = await res.json();
    const line: string | undefined = j.choices?.[0]?.message?.content?.trim();
    return line || null;
  } catch (e) {
    console.log("personalize error", lead.id, e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function runPersonalizer(env: Env): Promise<void> {
  console.log("personalizer start");
  const leads = await getLeadsByStatus(env.DB, "new", 50);
  let done = 0;
  for (const lead of leads) {
    const line = await personalizeOne(env, lead);
    if (line) {
      await updateLead(env.DB, lead.id, { first_line: line, status: "personalized" });
      done++;
    }
    // small gap to be polite to the gateway
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`personalizer done: ${done}/${leads.length}`);
  await env.CONFIG.put("last_personalizer_run", new Date().toISOString());
}
