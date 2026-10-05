// Single-Worker entry: HTTP routes + cron dispatcher.

import type { Env } from "./db";
import { routeApi } from "./api";
import { renderDashboard } from "./dashboard";
import { runCollector } from "./collector";
import { runPersonalizer } from "./personalizer";
import { runSender } from "./sender";
import { runFollowup } from "./followup";
import { runReplyWatcher } from "./reply-watcher";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/dashboard") {
      return renderDashboard(req, env, url);
    }
    if (url.pathname.startsWith("/api/")) {
      return routeApi(req, env, url);
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const origin = env.ORIGIN || "https://lead-gen-agent.workers.dev";
    switch (event.cron) {
      case "0 6 * * *":
        ctx.waitUntil(runCollector(env));
        break;
      case "0 7 * * *":
        ctx.waitUntil(runPersonalizer(env));
        break;
      case "0 9 * * *":
        ctx.waitUntil(runSender(env, origin));
        break;
      case "0 10 * * *":
        ctx.waitUntil(runFollowup(env, origin));
        break;
      case "0 * * * *":
        ctx.waitUntil(runReplyWatcher(env));
        break;
      default:
        console.log("unknown cron", event.cron);
    }
  },
};
