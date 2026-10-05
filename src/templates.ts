// Email templates (cold + follow-ups). Unsubscribe link appended by sender.

import type { Env, Lead } from "./db";
import { createHashSync } from "./util";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

function brand(lead: Lead): string {
  return lead.name || lead.website || "there";
}

function footer(unsubUrl: string): { html: string; text: string } {
  return {
    html: `<br><br>—<br>Radwan | Jepy Studio — video editing for creators & brands<br><a href="https://jepystudio.com">jepystudio.com</a><br><span style="font-size:12px;color:#888"><a href="${unsubUrl}">Unsubscribe</a></span>`,
    text: `\n\n—\nRadwan | Jepy Studio — video editing for creators & brands\njepystudio.com\nUnsubscribe: ${unsubUrl}`,
  };
}

export function unsubUrl(origin: string, lead: Lead, env: Env): string {
  const sig = createHashSync(`${lead.id}:${lead.email}:${env.EXTENSION_TOKEN}`).slice(0, 16);
  return `${origin}/api/unsubscribe?email=${encodeURIComponent(lead.email)}&sig=${sig}`;
}

export function unsubValid(lead: Lead, sig: string, env: Env): boolean {
  return sig === createHashSync(`${lead.id}:${lead.email}:${env.EXTENSION_TOKEN}`).slice(0, 16);
}

export function coldEmail(lead: Lead, env: Env, origin: string): BuiltEmail {
  const first = lead.first_line?.trim() || `Came across ${brand(lead)} and liked what you're putting out.`;
  const f = footer(unsubUrl(origin, lead, env));
  const text =
    `${first}\n\n` +
    `I'm Radwan — I run Jepy Studio, a video editing agency working with creators and brands. ` +
    `We handle short-form, YouTube edits, and motion design so you can post consistently without the editing bottleneck.\n\n` +
    `Open to a free 30-sec trial edit of one of your videos? No strings attached.\n\n` +
    `Best,\nRadwan` +
    f.text;
  return {
    subject: `quick idea for ${brand(lead)}'s videos`,
    html: text.replace(/\n/g, "<br>") + f.html,
    text,
  };
}

export function followup1Email(lead: Lead, env: Env, origin: string): BuiltEmail {
  const f = footer(unsubUrl(origin, lead, env));
  const text =
    `Just floating this to the top of your inbox, ${brand(lead)}.\n\n` +
    `Still happy to do that free 30-sec trial edit — one of your videos, my team, no cost. ` +
    `Worst case you get a free edited clip.\n\n` +
    `Worth a shot?\n\nBest,\nRadwan` + f.text;
  return {
    subject: `Re: quick idea for ${brand(lead)}'s videos`,
    html: text.replace(/\n/g, "<br>") + f.html,
    text,
  };
}

export function followup2Email(lead: Lead, env: Env, origin: string): BuiltEmail {
  const f = footer(unsubUrl(origin, lead, env));
  const text =
    `I'll close the loop on my end, ${brand(lead)}.\n\n` +
    `If editing ever becomes the bottleneck between you and consistent posting, reply to this email — ` +
    `the free trial offer stands.\n\n` +
    `Cheers,\nRadwan` + f.text;
  return {
    subject: `closing the loop`,
    html: text.replace(/\n/g, "<br>") + f.html,
    text,
  };
}
