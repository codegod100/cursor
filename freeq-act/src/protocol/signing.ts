/**
 * Durable act signing — ed25519 over JCS(act-* + act-from).
 * Sig wire: ed25519:<kid>:<sig> where kid = base64url(SHA-256(pubkey)[0:16])
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { canonicalizeAct } from "./canonical.js";
import type { VerifyOutcome } from "./types.js";

// @noble/ed25519 v3 requires an explicit sha512 (sync) binding.
ed.hashes.sha512 = (...msgs: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...msgs));

const te = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, "binary")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Hash-derived kid: first 16 bytes of SHA-256(pubkey), base64url. */
export function kidFromPublicKey(pubkey: Uint8Array): string {
  return b64url(sha256(pubkey).slice(0, 16));
}

export interface ActKeyPair {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 32 bytes
  kid: string;
}

export function generateKeyPair(): ActKeyPair {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = ed.getPublicKey(privateKey);
  return { privateKey, publicKey, kid: kidFromPublicKey(publicKey) };
}

export function keyPairFromSeed(seedHex: string): ActKeyPair {
  const privateKey = hexToBytes(seedHex);
  if (privateKey.length !== 32) throw new Error("seed must be 32 bytes hex");
  const publicKey = ed.getPublicKey(privateKey);
  return { privateKey, publicKey, kid: kidFromPublicKey(publicKey) };
}

export function exportSeedHex(kp: ActKeyPair): string {
  return bytesToHex(kp.privateKey);
}

export function formatSig(kid: string, signature: Uint8Array): string {
  return `ed25519:${kid}:${b64url(signature)}`;
}

export function parseSig(
  tag: string,
): { alg: string; kid: string; sig: Uint8Array } | null {
  const parts = tag.split(":");
  if (parts.length !== 3) return null;
  const [alg, kid, sigB64] = parts;
  if (!alg || !kid || !sigB64) return null;
  try {
    return { alg, kid, sig: b64urlDecode(sigB64) };
  } catch {
    return null;
  }
}

export function signActFields(
  fields: Record<string, string>,
  actFrom: string,
  kp: ActKeyPair,
): string {
  const canonical = canonicalizeAct(fields, actFrom);
  const sig = ed.sign(te.encode(canonical), kp.privateKey);
  return formatSig(kp.kid, sig);
}

/**
 * Three-way verify (RFC §Lifecycle):
 * - valid: signature checks out against resolved key
 * - invalid: key resolved but sig fails / tampering / kid mismatch
 * - unverifiable: key cannot currently be fetched
 */
export function verifyActSignature(
  fields: Record<string, string>,
  actFrom: string,
  sigTag: string,
  resolveKey: (did: string, kid: string) => Uint8Array | null | "unavailable",
): VerifyOutcome {
  const parsed = parseSig(sigTag);
  if (!parsed) return { status: "invalid", reason: "malformed sig tag" };
  if (parsed.alg !== "ed25519") {
    return { status: "invalid", reason: `unsupported alg ${parsed.alg}` };
  }

  const resolved = resolveKey(actFrom, parsed.kid);
  if (resolved === "unavailable") {
    return { status: "unverifiable", reason: "key origin unreachable" };
  }
  if (resolved === null) {
    return { status: "invalid", reason: "unknown kid for DID" };
  }

  // Self-certifying kid: substitution detectable
  const expectedKid = kidFromPublicKey(resolved);
  if (expectedKid !== parsed.kid) {
    return { status: "invalid", reason: "kid does not match resolved key" };
  }

  const canonical = canonicalizeAct(fields, actFrom);
  const ok = ed.verify(parsed.sig, te.encode(canonical), resolved);
  if (!ok) return { status: "invalid", reason: "signature mismatch" };
  return { status: "valid", kid: parsed.kid };
}

/** In-memory append-only key store: (DID, kid) → pubkey. Never overwrites. */
export class AppendOnlyKeyStore {
  private keys = new Map<string, Uint8Array>(); // `${did}\0${kid}` → pub

  register(did: string, pubkey: Uint8Array): string {
    const kid = kidFromPublicKey(pubkey);
    const k = `${did}\0${kid}`;
    const existing = this.keys.get(k);
    if (existing && !bytesEqual(existing, pubkey)) {
      throw new Error("key collision: same kid different pubkey");
    }
    this.keys.set(k, pubkey);
    return kid;
  }

  get(did: string, kid: string): Uint8Array | null {
    return this.keys.get(`${did}\0${kid}`) ?? null;
  }

  /** Resolver compatible with verifyActSignature (never "unavailable" locally). */
  resolver =
    (did: string, kid: string): Uint8Array | null => this.get(did, kid);

  /** Wrap a remote fetcher: local hit → key; miss → call fetch; fetch fail → unavailable. */
  withRemote(
    fetchKey: (
      did: string,
      kid: string,
    ) => Promise<Uint8Array | null> | Uint8Array | null,
  ): (did: string, kid: string) => Uint8Array | null | "unavailable" {
    return (did, kid) => {
      const local = this.get(did, kid);
      if (local) return local;
      try {
        const r = fetchKey(did, kid);
        // Sync path only for MVP sync verify; async defer handled by validator queue
        if (r && typeof (r as Promise<unknown>).then === "function") {
          return "unavailable";
        }
        const key = r as Uint8Array | null;
        if (key) this.register(did, key);
        return key;
      } catch {
        return "unavailable";
      }
    };
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
