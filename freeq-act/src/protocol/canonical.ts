/**
 * JCS (RFC 8785) canonicalization — sorted object keys, no insignificant whitespace.
 * Mirrors freeq-sdk's canonicalize so act sigs interoperate.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

export function canonicalize(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JCS: non-finite numbers are not allowed");
    }
    // JSON number serialization (no exponent normalization beyond JSON.stringify)
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = value[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Build the act canonical object from present act-* fields + act-from.
 * Keys are short names (act, act-verb, …) — not the wire vendor prefix.
 * `+freeq.at/sig` is never included.
 */
export function buildCanonicalObject(
  fields: Record<string, string>,
  actFrom: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === "") continue;
    // Accept either wire names (+freeq.at/act-verb) or short names (act-verb)
    const short = wireToShort(k);
    if (!short) continue;
    if (short === "sig") continue; // never sign the signature
    out[short] = v;
  }
  out["act-from"] = actFrom;
  return out;
}

export function wireToShort(tag: string): string | null {
  const prefixes = ["+freeq.at/", "freeq.at/", "+"];
  let name = tag;
  for (const p of prefixes) {
    if (name.startsWith(p)) {
      name = name.slice(p.length);
      break;
    }
  }
  // Must be `act` or `act-*` (sig handled separately)
  if (name === "act" || name.startsWith("act-") || name === "sig") return name;
  return null;
}

export function shortToWire(short: string): string {
  return `+freeq.at/${short}`;
}

export function canonicalizeAct(
  fields: Record<string, string>,
  actFrom: string,
): string {
  return canonicalize(buildCanonicalObject(fields, actFrom));
}
