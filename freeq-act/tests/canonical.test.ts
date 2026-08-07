import { describe, it, expect } from "vitest";
import { canonicalize, canonicalizeAct, buildCanonicalObject } from "../src/protocol/canonical.js";

describe("JCS canonicalize", () => {
  it("sorts object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("nests sorted objects", () => {
    expect(canonicalize({ z: { b: 1, a: 2 }, a: [] })).toBe(
      '{"a":[],"z":{"a":2,"b":1}}',
    );
  });
});

describe("act canonical", () => {
  it("includes all present act-* plus act-from, excludes sig", () => {
    const obj = buildCanonicalObject(
      {
        "+freeq.at/act": "handoff",
        "+freeq.at/act-verb": "offer",
        "+freeq.at/act-id": "01JABC",
        "+freeq.at/act-title": "Cite 3 sources",
        "+freeq.at/sig": "ed25519:x:y",
      },
      "did:plc:scholar",
    );
    expect(obj).toEqual({
      act: "handoff",
      "act-verb": "offer",
      "act-id": "01JABC",
      "act-title": "Cite 3 sources",
      "act-from": "did:plc:scholar",
    });
    expect(obj).not.toHaveProperty("sig");
  });

  it("detects tag add/strip via different canonical", () => {
    const a = canonicalizeAct(
      { act: "handoff", "act-verb": "offer", "act-id": "1" },
      "did:plc:a",
    );
    const b = canonicalizeAct(
      { act: "handoff", "act-verb": "offer", "act-id": "1", "act-title": "x" },
      "did:plc:a",
    );
    expect(a).not.toBe(b);
  });
});
