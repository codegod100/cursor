/**
 * REST query interface over the materialized view (RFC §REST).
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ActionValidator } from "../protocol/validator.js";
import { mintOffer, mintTransition } from "../protocol/validator.js";
import type { ActKeyPair } from "../protocol/signing.js";
import type { SignedActEvent } from "../protocol/types.js";

export interface RestContext {
  validator: ActionValidator;
  kp: ActKeyPair;
  did: string;
  origin?: string;
  /** Emit signed event to IRC (optional). */
  publish?: (event: SignedActEvent) => void | Promise<void>;
}

export function createActApp(ctx: RestContext): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, did: ctx.did, protocol: "freeq.at/act", version: "0.4" }),
  );

  app.get("/api/v1/actions", (c) => {
    const kind = c.req.query("kind") ?? undefined;
    const to = c.req.query("to") ?? undefined;
    const state = c.req.query("state") ?? undefined;
    const caps = c.req.query("caps") ?? undefined;
    return c.json({ actions: ctx.validator.list({ kind, to, state, caps }) });
  });

  app.get("/api/v1/actions/:id", (c) => {
    const view = ctx.validator.getView(c.req.param("id"));
    if (!view) return c.json({ error: "not found" }, 404);
    return c.json(view);
  });

  app.post("/api/v1/actions", async (c) => {
    const body = await c.req.json<{
      kind?: string;
      title: string;
      to?: string;
      caps?: string[];
      deadline?: number;
      ctx?: string;
      ctxH?: string;
      target?: string;
    }>();
    if (!body.title) return c.json({ error: "title required" }, 400);
    const event = mintOffer(ctx.kp, ctx.did, {
      kind: body.kind,
      title: body.title,
      to: body.to,
      caps: body.caps,
      deadline: body.deadline,
      ctx: body.ctx,
      ctxH: body.ctxH,
      target: body.target,
      origin: ctx.origin,
    });
    const result = ctx.validator.apply(event);
    if (!result.ok) {
      return c.json({ error: result.reason, code: result.code }, 400);
    }
    await ctx.publish?.(event);
    return c.json({ event, view: result.view }, 201);
  });

  app.post("/api/v1/actions/:id/:verb", async (c) => {
    const id = c.req.param("id");
    const verb = c.req.param("verb");
    const view = ctx.validator.getView(id);
    if (!view) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      caps?: string[];
      extra?: Record<string, string>;
    };
    const event = mintTransition(ctx.kp, ctx.did, view, verb, {
      caps: body.caps,
      extra: body.extra,
    });
    const result = ctx.validator.apply(event);
    if (!result.ok) {
      const status = result.code === "defer" ? 503 : 400;
      return c.json({ error: result.reason, code: result.code }, status);
    }
    await ctx.publish?.(event);
    return c.json({ event, view: result.view });
  });

  return app;
}

export function listenActApi(
  ctx: RestContext,
  port = 8787,
): ReturnType<typeof serve> {
  const app = createActApp(ctx);
  console.error(`[act-api] listening on :${port} as ${ctx.did}`);
  return serve({ fetch: app.fetch, port });
}
