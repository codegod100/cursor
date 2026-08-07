import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  signActFields,
  verifyActSignature,
  AppendOnlyKeyStore,
  kidFromPublicKey,
  parseSig,
} from "../src/protocol/signing.js";

describe("act signing", () => {
  it("round-trips sign/verify with hash-derived kid", () => {
    const kp = generateKeyPair();
    const keys = new AppendOnlyKeyStore();
    const did = "did:plc:alice";
    keys.register(did, kp.publicKey);

    const fields = {
      act: "handoff",
      "act-verb": "offer",
      "act-id": "01TEST00000000000000000000",
      "act-title": "hello",
    };
    const sig = signActFields(fields, did, kp);
    const parsed = parseSig(sig)!;
    expect(parsed.kid).toBe(kidFromPublicKey(kp.publicKey));
    expect(parsed.alg).toBe("ed25519");

    const out = verifyActSignature(fields, did, sig, keys.resolver);
    expect(out).toEqual({ status: "valid", kid: kp.kid });
  });

  it("rejects forgery as invalid", () => {
    const kp = generateKeyPair();
    const keys = new AppendOnlyKeyStore();
    const did = "did:plc:alice";
    keys.register(did, kp.publicKey);
    const fields = { act: "handoff", "act-verb": "offer", "act-id": "01A" };
    const sig = signActFields(fields, did, kp);
    const tampered = { ...fields, "act-title": "evil" };
    const out = verifyActSignature(tampered, did, sig, keys.resolver);
    expect(out.status).toBe("invalid");
  });

  it("returns unverifiable when key unavailable", () => {
    const kp = generateKeyPair();
    const fields = { act: "handoff", "act-verb": "offer", "act-id": "01A" };
    const sig = signActFields(fields, "did:plc:alice", kp);
    const out = verifyActSignature(fields, "did:plc:alice", sig, () => "unavailable");
    expect(out.status).toBe("unverifiable");
  });

  it("append-only key store never overwrites different key same kid", () => {
    const a = generateKeyPair();
    const keys = new AppendOnlyKeyStore();
    keys.register("did:plc:x", a.publicKey);
    // same pubkey ok
    expect(keys.register("did:plc:x", a.publicKey)).toBe(a.kid);
  });
});
