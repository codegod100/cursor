/** freeq.at/act RFC v0.4 types */

export const ACT_VENDOR = "+freeq.at";
export const ACT_CAP = "freeq.at/act";

/** Wire tag names (with client-tag `+` vendor prefix). */
export const TAG = {
  kind: `${ACT_VENDOR}/act`,
  verb: `${ACT_VENDOR}/act-verb`,
  id: `${ACT_VENDOR}/act-id`,
  to: `${ACT_VENDOR}/act-to`,
  from: `${ACT_VENDOR}/act-from`,
  title: `${ACT_VENDOR}/act-title`,
  ctx: `${ACT_VENDOR}/act-ctx`,
  ctxH: `${ACT_VENDOR}/act-ctx-h`,
  caps: `${ACT_VENDOR}/act-caps`,
  deadline: `${ACT_VENDOR}/act-deadline`,
  ref: `${ACT_VENDOR}/act-ref`,
  sig: `${ACT_VENDOR}/sig`,
} as const;

/** Canonical JSON keys (prefix stripped). */
export type ActCanonicalKey =
  | "act"
  | "act-verb"
  | "act-id"
  | "act-to"
  | "act-from"
  | "act-title"
  | "act-ctx"
  | "act-ctx-h"
  | "act-caps"
  | "act-deadline"
  | "act-ref"
  | string; // kind-specific act-* fields allowed

export type HandoffVerb =
  | "offer"
  | "accept"
  | "claim"
  | "decline"
  | "progress"
  | "complete"
  | "fail"
  | "cancel";

export type ActionKind = "handoff" | "approval" | "grant" | string;

/** Authoritative lifecycle states (materialized view). */
export type ActionState =
  | "offered" // directed offer awaiting accept/decline
  | "open" // claimable (no act-to)
  | "assigned" // accepted or claimed
  | "completed"
  | "failed"
  | "declined"
  | "cancelled"
  | "expired";

/** View-only annotation — never signed / never relayed. */
export type ViewAnnotation = "orphaned" | "unconfirmed";

export interface ActFields {
  kind: ActionKind;
  verb: string;
  id: string;
  from: string; // DID of sender of this event
  to?: string; // assignee DID (omit = open/claimable)
  title?: string;
  ctx?: string;
  ctxH?: string;
  caps?: string[]; // reverse-DNS hints
  deadline?: number; // unix seconds
  ref?: string; // prior act-id / msgid correlation
  /** Any additional act-* fields (kind-specific), keyed without vendor prefix. */
  extra?: Record<string, string>;
}

export interface SignedActEvent extends ActFields {
  sig: string; // ed25519:kid:sig
  /** Origin server that minted / relayed (for key lookup + serialization). */
  origin?: string;
  /** IRC target (channel or DID) — visibility axis, not signed. */
  target?: string;
  /** Wall-clock receive time (local). */
  receivedAt?: number;
  /** Raw wire tags as received (for verbatim rebuild). */
  rawTags?: Record<string, string>;
}

export interface ActionView {
  id: string;
  kind: ActionKind;
  state: ActionState;
  offerer: string;
  assignee?: string;
  title?: string;
  caps?: string[];
  deadline?: number;
  ctx?: string;
  ctxH?: string;
  target?: string;
  origin?: string;
  /** View-only; never authoritative. */
  annotations?: ViewAnnotation[];
  updatedAt: number;
  events: ActLogEntry[];
}

export interface ActLogEntry {
  verb: string;
  from: string;
  at: number; // from ULID time when possible
  confirmed: boolean; // false = recorded but not yet ordered by mint origin
  sig: string;
}

export type VerifyOutcome =
  | { status: "valid"; kid: string }
  | { status: "invalid"; reason: string }
  | { status: "unverifiable"; reason: string };

export type TransitionResult =
  | { ok: true; view: ActionView }
  | { ok: false; reason: string; code: "reject" | "defer" };

/** Recommended deadline skew grace (RFC §Lifecycle). */
export const DEADLINE_GRACE_SECS = 120;

/** Recommended orphan TTL when minting server unreachable. */
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
