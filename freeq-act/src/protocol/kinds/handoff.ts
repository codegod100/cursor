/**
 * handoff kind — transition table + authorization (RFC §Lifecycle).
 * Policy artifact, not plumbing.
 */

import type { ActionState, ActionView, HandoffVerb } from "../types.js";

export const HANDOFF_KIND = "handoff";

/** verb → who may send + precondition state(s) */
export const HANDOFF_TRANSITIONS: Record<
  HandoffVerb,
  {
    fromStates: ActionState[] | "*";
    /** After successful transition. */
    toState: ActionState | ((view: ActionView, open: boolean) => ActionState);
    authz:
      | "anyone"
      | "addressee" // directed: act-to DID
      | "caps-match" // open: any DID declaring matching caps (caller checks)
      | "assignee"
      | "offerer";
  }
> = {
  offer: {
    fromStates: "*", // mints new act-id
    toState: (_v, open) => (open ? "open" : "offered"),
    authz: "anyone",
  },
  accept: {
    fromStates: ["offered"],
    toState: "assigned",
    authz: "addressee",
  },
  claim: {
    fromStates: ["open"],
    toState: "assigned",
    authz: "caps-match",
  },
  decline: {
    fromStates: ["offered"],
    toState: "declined",
    authz: "addressee",
  },
  progress: {
    fromStates: ["assigned"],
    toState: "assigned",
    authz: "assignee",
  },
  complete: {
    fromStates: ["assigned"],
    toState: "completed",
    authz: "assignee",
  },
  fail: {
    fromStates: ["assigned"],
    toState: "failed",
    authz: "assignee",
  },
  cancel: {
    fromStates: ["offered", "open", "assigned"],
    toState: "cancelled",
    authz: "offerer",
  },
};

export function isHandoffVerb(v: string): v is HandoffVerb {
  return v in HANDOFF_TRANSITIONS;
}

export function authorizeHandoff(
  verb: HandoffVerb,
  view: ActionView | null,
  senderDid: string,
  opts: { claimedCaps?: string[]; openOffer?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const rule = HANDOFF_TRANSITIONS[verb];

  if (verb === "offer") {
    return { ok: true };
  }
  if (!view) return { ok: false, reason: "unknown act-id" };

  if (rule.fromStates !== "*") {
    if (!rule.fromStates.includes(view.state)) {
      return {
        ok: false,
        reason: `illegal transition: state=${view.state} verb=${verb}`,
      };
    }
  }

  switch (rule.authz) {
    case "anyone":
      return { ok: true };
    case "addressee":
      if (!view.assignee || view.assignee !== senderDid) {
        // Directed offer stores intended assignee in assignee while offered
        return { ok: false, reason: "only addressed DID may send this verb" };
      }
      return { ok: true };
    case "assignee":
      if (view.assignee !== senderDid) {
        return { ok: false, reason: "only assignee may send this verb" };
      }
      return { ok: true };
    case "offerer":
      if (view.offerer !== senderDid) {
        return { ok: false, reason: "only offerer may cancel" };
      }
      return { ok: true };
    case "caps-match": {
      const needed = view.caps ?? [];
      if (needed.length === 0) return { ok: true }; // no filter
      const have = new Set(opts.claimedCaps ?? []);
      // Self-declared: claimer asserts caps; server never interprets — we only
      // check intersection against the offer's act-caps hint when provided.
      const ok = needed.some((c) => have.has(c));
      if (!ok) {
        return { ok: false, reason: "claimer caps do not match act-caps" };
      }
      return { ok: true };
    }
  }
}

export function nextHandoffState(
  verb: HandoffVerb,
  view: ActionView | null,
  open: boolean,
): ActionState {
  const rule = HANDOFF_TRANSITIONS[verb];
  if (typeof rule.toState === "function") {
    return rule.toState(view ?? ({} as ActionView), open);
  }
  return rule.toState;
}
