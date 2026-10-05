# Lead Gen Agent — Setup Guide

Serverless lead-gen + cold email automation: Cloudflare Workers + D1 + Resend + Manifest AI + Chrome extension.

## ১. প্রথমবার setup (one-time)

```bash
npm install

# Cloudflare login (browser-এ confirm করতে হবে)
npx wrangler login

# D1 database বানাও
npx wrangler d1 create leadgen
# -> database_id টা wrangler.toml-এ বসাও

# KV namespace বানাও
npx wrangler kv namespace create CONFIG
# -> id টা wrangler.toml-এ বসাও

# Tables বানাও
npm run db:migrate
```

## ২. Secrets বসাও

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MANIFEST_API_KEY
npx wrangler secret put APIFY_API_KEY
npx wrangler secret put BRIGHTDATA_API_KEY
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put YT_API_KEY
npx wrangler secret put EXTENSION_TOKEN      # নিজে একটা random string বানাও
npx wrangler secret put DASHBOARD_USER       # যেমন: admin
npx wrangler secret put DASHBOARD_PASS       # strong password
```

`wrangler.toml`-এর `[vars]`-এ ঠিক করো: `MANIFEST_BASE_URL`, `FROM_EMAIL`, `ORIGIN` (deploy-এর পর আসল workers.dev URL)।

## ৩. Deploy

```bash
npm run deploy
# অথবা main branch-এ push করলেই GitHub Actions auto-deploy করবে
# (repo Settings -> Secrets-এ CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID বসাতে হবে)
```

## ৪. Resend webhook (reply auto-stop-এর জন্য)

Resend dashboard -> Webhooks -> `https://<worker>/api/webhooks/resend` add করো,
events: `email.replied`, `email.bounced`, `email.complained`.

## ৫. Chrome extension install

1. `chrome://extensions` খোলো -> Developer mode ON
2. "Load unpacked" -> `extension/` folder select
3. Extension popup খুলে Settings-এ Worker URL + EXTENSION_TOKEN বসিয়ে Save
4. যেকোনো page-এ গিয়ে "Scrape this page" চাপ দাও 🎯

## ৬. প্রতিদিন যা auto-চলবে (cron)

| Time (UTC) | কাজ |
|---|---|
| 06:00 | Lead collection (YouTube/Maps/social) |
| 07:00 | Manifest AI personalization |
| 09:00 | Batch email send (daily cap মেনে) |
| 10:00 | Due follow-ups |
| hourly | Bounce/complaint check |

Dashboard: `https://<worker>/dashboard` (basic auth) — filter + **Export CSV** button আছে।
