/**
 * Wire tag parse/build for freeq.at/act TAGMSG events.
 */

import { TAG } from "./types.js";
import type { ActFields, SignedActEvent } from "./types.js";
import { shortToWire, wireToShort } from "./canonical.js";

/** Parse IRCv3 message-tag string (`@a=b;c=d` or without leading @). */
export function parseTagString(raw: string): Record<string, string> {
  const s = raw.startsWith("@") ? raw.slice(1) : raw;
  // Strip trailing command if accidentally included
  const tagPart = s.includes(" ") ? s.slice(0, s.indexOf(" ")) : s;
  const out: Record<string, string> = {};
  for (const piece of tagPart.split(";")) {
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq === -1) {
      out[unescapeTag(piece)] = "";
    } else {
      out[unescapeTag(piece.slice(0, eq))] = unescapeTag(piece.slice(eq + 1));
    }
  }
  return out;
}

export function unescapeTag(v: string): string {
  return v
    .replace(/\\:/g, ";")
    .replace(/\\s/g, " ")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\");
}

export function escapeTag(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\:")
    .replace(/ /g, "\\s")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/** Short-name field map from wire tags (act / act-* only). */
export function extractActShortFields(
  tags: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    const short = wireToShort(k);
    if (!short || short === "sig") continue;
    out[short] = v;
  }
  return out;
}

export function fieldsToShortMap(f: ActFields): Record<string, string> {
  const m: Record<string, string> = {
    act: f.kind,
    "act-verb": f.verb,
    "act-id": f.id,
    "act-from": f.from,
  };
  if (f.to) m["act-to"] = f.to;
  if (f.title) m["act-title"] = f.title;
  if (f.ctx) m["act-ctx"] = f.ctx;
  if (f.ctxH) m["act-ctx-h"] = f.ctxH;
  if (f.caps?.length) m["act-caps"] = f.caps.join(",");
  if (f.deadline !== undefined) m["act-deadline"] = String(f.deadline);
  if (f.ref) m["act-ref"] = f.ref;
  if (f.extra) {
    for (const [k, v] of Object.entries(f.extra)) {
      const short = k.startsWith("act-") ? k : `act-${k}`;
      m[short] = v;
    }
  }
  return m;
}

export function shortMapToFields(m: Record<string, string>): ActFields | null {
  if (!m.act || !m["act-verb"] || !m["act-id"] || !m["act-from"]) return null;
  const known = new Set([
    "act",
    "act-verb",
    "act-id",
    "act-from",
    "act-to",
    "act-title",
    "act-ctx",
    "act-ctx-h",
    "act-caps",
    "act-deadline",
    "act-ref",
  ]);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!known.has(k) && k.startsWith("act-")) extra[k] = v;
  }
  return {
    kind: m.act,
    verb: m["act-verb"],
    id: m["act-id"],
    from: m["act-from"],
    to: m["act-to"],
    title: m["act-title"],
    ctx: m["act-ctx"],
    ctxH: m["act-ctx-h"],
    caps: m["act-caps"]
      ? m["act-caps"].split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    deadline: m["act-deadline"] ? Number(m["act-deadline"]) : undefined,
    ref: m["act-ref"],
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export function signedEventFromTags(
  tags: Record<string, string>,
  opts: { origin?: string; target?: string; receivedAt?: number } = {},
): SignedActEvent | null {
  const shorts = extractActShortFields(tags);
  // act-from may be stamped by sender; if absent, caller must inject
  const fields = shortMapToFields(shorts);
  if (!fields) return null;
  const sig = tags[TAG.sig] ?? tags["freeq.at/sig"] ?? tags["+freeq.at/sig"];
  if (!sig) return null;
  return {
    ...fields,
    sig,
    origin: opts.origin,
    target: opts.target,
    receivedAt: opts.receivedAt ?? Date.now(),
    rawTags: { ...tags },
  };
}

/** Build wire tags for TAGMSG (includes sig). Does not include act-from on wire
 *  unless includeFrom — RFC puts act-from in the canonical; senders should
 *  include it as a tag so receivers rebuild without guessing. */
export function buildWireTags(
  shortFields: Record<string, string>,
  sig: string,
  includeFrom = true,
): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(shortFields)) {
    if (!includeFrom && k === "act-from") continue;
    tags[shortToWire(k)] = v;
  }
  tags[TAG.sig] = sig;
  return tags;
}

/** Format `@tags TAGMSG target` IRC line. */
export function formatTagmsg(
  target: string,
  tags: Record<string, string>,
): string {
  const body = Object.entries(tags)
    .map(([k, v]) => `${escapeTag(k)}=${escapeTag(v)}`)
    .join(";");
  return `@${body} TAGMSG ${target}`;
}

export function parseIrcLine(line: string): {
  tags: Record<string, string>;
  prefix?: string;
  command: string;
  params: string[];
} | null {
  let rest = line.replace(/\r?\n$/, "");
  let tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    if (sp === -1) return null;
    tags = parseTagString(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }
  let prefix: string | undefined;
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    if (sp === -1) return null;
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const parts = rest.split(" ");
  const command = parts[0] ?? "";
  const params: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    if (parts[i]!.startsWith(":")) {
      params.push(parts.slice(i).join(" ").slice(1));
      break;
    }
    params.push(parts[i]!);
  }
  return { tags, prefix, command, params };
}
