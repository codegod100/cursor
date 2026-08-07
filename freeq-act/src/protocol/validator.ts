/**
 * Transition validator — signature gate (valid / invalid / unverifiable→defer)
 * then kind policy. Minting server serializes claims (first verified wins).
 */

import { ulid, decodeTime } from "ulid";
import {
  DEADLINE_GRACE_SECS,
  ORPHAN_TTL_MS,
  type ActionView,
  type SignedActEvent,
  type TransitionResult,
  type ActLogEntry,
} from "./types.js";
import {
  verifyActSignature,
  signActFields,
  type ActKeyPair,
} from "./signing.js";
import { fieldsToShortMap } from "./tags.js";
import {
  authorizeHandoff,
  isHandoffVerb,
  nextHandoffState,
  HANDOFF_KIND,
} from "./kinds/handoff.js";
import type { AppendOnlyKeyStore } from "./signing.js";

export interface ValidatorOptions {
  keys: AppendOnlyKeyStore;
  /** Our DID — used when we are the minting origin for serialization. */
  selfDid?: string;
  /** Origin hostname we mint under (for orphan detection). */
  selfOrigin?: string;
  /** Optional remote key lookup; failures → defer. */
  fetchKey?: (did: string, kid: string) => Uint8Array | null | "unavailable";
  now?: () => number;
  deadlineGraceSecs?: number;
  orphanTtlMs?: number;
  /** Max deferred events per origin. */
  deferLimitPerOrigin?: number;
}

export class ActionValidator {
  private views = new Map<string, ActionView>();
  private deferred: SignedActEvent[] = [];
  private opts: Required<
    Pick<
      ValidatorOptions,
      "deadlineGraceSecs" | "orphanTtlMs" | "deferLimitPerOrigin"
    >
  > &
    ValidatorOptions;

  constructor(opts: ValidatorOptions) {
    this.opts = {
      deadlineGraceSecs: DEADLINE_GRACE_SECS,
      orphanTtlMs: ORPHAN_TTL_MS,
      deferLimitPerOrigin: 256,
      ...opts,
    };
  }

  getView(id: string): ActionView | undefined {
    return this.views.get(id);
  }

  list(filter: {
    kind?: string;
    to?: string;
    state?: string;
    caps?: string;
  } = {}): ActionView[] {
    let all = [...this.views.values()];
    if (filter.kind) all = all.filter((v) => v.kind === filter.kind);
    if (filter.to) all = all.filter((v) => v.assignee === filter.to);
    if (filter.state) {
      if (filter.state === "orphaned") {
        all = all.filter((v) => v.annotations?.includes("orphaned"));
      } else {
        all = all.filter((v) => v.state === filter.state);
      }
    }
    if (filter.caps) {
      all = all.filter((v) => v.caps?.includes(filter.caps!));
    }
    return all;
  }

  /** Rebuildable source: all views. */
  allViews(): ActionView[] {
    return [...this.views.values()];
  }

  apply(event: SignedActEvent): TransitionResult {
    const short = fieldsToShortMap(event);
    // Prefer raw tags for rebuild-when-present (sign-what's-present)
    const fieldsForSig: Record<string, string> = event.rawTags
      ? stripSig(extractShortFromRaw(event.rawTags))
      : Object.fromEntries(
          Object.entries(short).filter(([k]) => k !== "act-from"),
        );
    // Ensure act-from is not double-applied incorrectly — verify uses actFrom arg
    delete fieldsForSig["act-from"];

    const resolver = (did: string, kid: string) => {
      const local = this.opts.keys.get(did, kid);
      if (local) return local;
      if (this.opts.fetchKey) return this.opts.fetchKey(did, kid);
      return null;
    };

    const outcome = verifyActSignature(
      fieldsForSig,
      event.from,
      event.sig,
      resolver,
    );

    if (outcome.status === "invalid") {
      return { ok: false, reason: outcome.reason, code: "reject" };
    }
    if (outcome.status === "unverifiable") {
      this.park(event);
      return { ok: false, reason: outcome.reason, code: "defer" };
    }

    return this.applyVerified(event);
  }

  /** Retry deferred queue (call after key becomes available). */
  retryDeferred(): TransitionResult[] {
    const queued = this.deferred.splice(0);
    const results: TransitionResult[] = [];
    for (const ev of queued) {
      results.push(this.apply(ev));
    }
    return results;
  }

  private park(event: SignedActEvent): void {
    const origin = event.origin ?? "unknown";
    const sameOrigin = this.deferred.filter(
      (e) => (e.origin ?? "unknown") === origin,
    );
    if (sameOrigin.length >= this.opts.deferLimitPerOrigin!) {
      // Evict oldest for this origin
      const idx = this.deferred.findIndex(
        (e) => (e.origin ?? "unknown") === origin,
      );
      if (idx >= 0) {
        console.warn(
          `[act] defer queue full for ${origin}; evicting oldest act-id=${this.deferred[idx]!.id}`,
        );
        this.deferred.splice(idx, 1);
      }
    }
    this.deferred.push(event);
  }

  private applyVerified(event: SignedActEvent): TransitionResult {
    const now = (this.opts.now ?? Date.now)();

    if (event.kind === HANDOFF_KIND || event.kind === "handoff") {
      return this.applyHandoff(event, now);
    }

    // Substrate hook: unknown kinds still store offer-shaped events minimally
    if (event.verb === "offer" || event.verb === "request") {
      if (this.views.has(event.id)) {
        return { ok: false, reason: "act-id already exists", code: "reject" };
      }
      const open = !event.to;
      const view: ActionView = {
        id: event.id,
        kind: event.kind,
        state: open ? "open" : "offered",
        offerer: event.from,
        assignee: event.to,
        title: event.title,
        caps: event.caps,
        deadline: event.deadline,
        ctx: event.ctx,
        ctxH: event.ctxH,
        target: event.target,
        origin: event.origin,
        updatedAt: now,
        events: [logEntry(event, true)],
      };
      this.views.set(event.id, view);
      return { ok: true, view };
    }

    return {
      ok: false,
      reason: `unsupported kind ${event.kind}`,
      code: "reject",
    };
  }

  private applyHandoff(event: SignedActEvent, now: number): TransitionResult {
    if (!isHandoffVerb(event.verb)) {
      return { ok: false, reason: `unknown verb ${event.verb}`, code: "reject" };
    }

    const existing = this.views.get(event.id) ?? null;

    if (event.verb === "offer") {
      if (existing) {
        return { ok: false, reason: "act-id already exists", code: "reject" };
      }
      const open = !event.to;
      if (open && event.target && !event.target.startsWith("#")) {
        // Open direct action: legal but pointless — may reject
        return {
          ok: false,
          reason: "open direct action rejected as malformed",
          code: "reject",
        };
      }
      if (deadlineExpired(event.deadline, now, this.opts.deadlineGraceSecs!)) {
        return { ok: false, reason: "offer past deadline", code: "reject" };
      }
      const view: ActionView = {
        id: event.id,
        kind: HANDOFF_KIND,
        state: open ? "open" : "offered",
        offerer: event.from,
        assignee: event.to, // intended addressee while offered
        title: event.title,
        caps: event.caps,
        deadline: event.deadline,
        ctx: event.ctx,
        ctxH: event.ctxH,
        target: event.target,
        origin: event.origin,
        updatedAt: now,
        events: [logEntry(event, true)],
      };
      this.views.set(event.id, view);
      return { ok: true, view };
    }

    if (!existing) {
      return { ok: false, reason: "unknown act-id", code: "reject" };
    }

    // Deadline on accept
    if (
      (event.verb === "accept" || event.verb === "claim") &&
      deadlineExpired(existing.deadline, now, this.opts.deadlineGraceSecs!)
    ) {
      return { ok: false, reason: "past deadline", code: "reject" };
    }

    const auth = authorizeHandoff(event.verb, existing, event.from, {
      claimedCaps: event.caps ?? existing.caps,
    });
    if (!auth.ok) return { ok: false, reason: auth.reason, code: "reject" };

    // First valid claim wins atomically (we're the local serializer)
    if (event.verb === "claim" && existing.state !== "open") {
      return { ok: false, reason: "already claimed", code: "reject" };
    }

    const open = existing.state === "open";
    const next = nextHandoffState(event.verb, existing, open);
    const updated: ActionView = {
      ...existing,
      state: next,
      updatedAt: now,
      annotations: existing.annotations?.filter((a) => a !== "orphaned"),
      events: [...existing.events, logEntry(event, true)],
    };
    if (event.verb === "accept" || event.verb === "claim") {
      updated.assignee = event.from;
    }
    if (event.verb === "decline" || event.verb === "cancel") {
      // keep assignee as historical intended party
    }
    this.views.set(event.id, updated);
    return { ok: true, view: updated };
  }

  /** Mark orphaned in local view when mint origin unreachable past TTL. */
  markOrphans(unreachableOrigins: Set<string>, now = Date.now()): void {
    for (const view of this.views.values()) {
      if (["completed", "failed", "declined", "cancelled", "expired"].includes(view.state)) {
        continue;
      }
      const origin = view.origin;
      if (!origin || !unreachableOrigins.has(origin)) continue;
      const age = now - view.updatedAt;
      if (age < this.opts.orphanTtlMs!) continue;
      const ann = new Set(view.annotations ?? []);
      ann.add("orphaned");
      view.annotations = [...ann];
    }
  }

  /** Liveness sweep — minting origin marks expired (local MVP). */
  sweepExpired(now = Date.now()): ActionView[] {
    const changed: ActionView[] = [];
    for (const view of this.views.values()) {
      if (!["offered", "open", "assigned"].includes(view.state)) continue;
      if (!view.deadline) continue;
      if (!deadlineExpired(view.deadline, now, this.opts.deadlineGraceSecs!)) {
        continue;
      }
      // Only sweep if we minted (or origin unset in local mode)
      if (
        this.opts.selfOrigin &&
        view.origin &&
        view.origin !== this.opts.selfOrigin
      ) {
        continue;
      }
      view.state = "expired";
      view.updatedAt = now;
      view.events.push({
        verb: "expired",
        from: "system",
        at: now,
        confirmed: true,
        sig: "",
      });
      changed.push(view);
    }
    return changed;
  }
}

function deadlineExpired(
  deadline: number | undefined,
  nowMs: number,
  graceSecs: number,
): boolean {
  if (deadline === undefined) return false;
  const nowSecs = Math.floor(nowMs / 1000);
  return nowSecs > deadline + graceSecs;
}

function logEntry(event: SignedActEvent, confirmed: boolean): ActLogEntry {
  let at = event.receivedAt ?? Date.now();
  try {
    at = decodeTime(event.id);
  } catch {
    /* keep receivedAt */
  }
  return {
    verb: event.verb,
    from: event.from,
    at,
    confirmed,
    sig: event.sig,
  };
}

function extractShortFromRaw(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const name = k.replace(/^\+/, "").replace(/^freeq\.at\//, "");
    if (name === "act" || name.startsWith("act-") || name === "sig") {
      out[name] = v;
    }
  }
  return out;
}

function stripSig(m: Record<string, string>): Record<string, string> {
  const { sig: _, ...rest } = m;
  return rest;
}

/** Helper: mint a signed offer event. */
export function mintOffer(
  kp: ActKeyPair,
  fromDid: string,
  opts: {
    kind?: string;
    title: string;
    to?: string;
    caps?: string[];
    deadline?: number;
    ctx?: string;
    ctxH?: string;
    target?: string;
    origin?: string;
    extra?: Record<string, string>;
  },
): SignedActEvent {
  const id = ulid();
  const fields = {
    kind: opts.kind ?? HANDOFF_KIND,
    verb: "offer",
    id,
    from: fromDid,
    to: opts.to,
    title: opts.title,
    caps: opts.caps,
    deadline: opts.deadline,
    ctx: opts.ctx,
    ctxH: opts.ctxH,
    extra: opts.extra,
  };
  const short = fieldsToShortMap(fields);
  const { "act-from": _af, ...toSign } = short;
  const sig = signActFields(toSign, fromDid, kp);
  return {
    ...fields,
    sig,
    target: opts.target,
    origin: opts.origin,
    receivedAt: Date.now(),
    rawTags: {
      ...Object.fromEntries(
        Object.entries(short).map(([k, v]) => [`+freeq.at/${k}`, v]),
      ),
      "+freeq.at/sig": sig,
    },
  };
}

/** Mint a signed transition against an existing action. */
export function mintTransition(
  kp: ActKeyPair,
  fromDid: string,
  base: ActionView,
  verb: string,
  opts: { caps?: string[]; title?: string; extra?: Record<string, string> } = {},
): SignedActEvent {
  // Minimal signed set: act, act-verb, act-id (+ optional caps for claim).
  const short: Record<string, string> = {
    act: base.kind,
    "act-verb": verb,
    "act-id": base.id,
    "act-from": fromDid,
  };
  if (opts.caps?.length) short["act-caps"] = opts.caps.join(",");
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      short[k.startsWith("act-") ? k : `act-${k}`] = v;
    }
  }
  const { "act-from": _af, ...toSign } = short;
  const sig = signActFields(toSign, fromDid, kp);
  return {
    kind: base.kind,
    verb,
    id: base.id,
    from: fromDid,
    title: opts.title ?? base.title,
    caps: opts.caps,
    deadline: base.deadline,
    ctx: base.ctx,
    ctxH: base.ctxH,
    sig,
    target: base.target,
    origin: base.origin,
    receivedAt: Date.now(),
    rawTags: {
      ...Object.fromEntries(
        Object.entries(short).map(([k, v]) => [`+freeq.at/${k}`, v]),
      ),
      "+freeq.at/sig": sig,
    },
  };
}
