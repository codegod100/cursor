import { describe, it, expect } from "vitest";
import {
  ActionValidator,
  mintOffer,
  mintTransition,
} from "../src/protocol/validator.js";
import { AppendOnlyKeyStore, generateKeyPair } from "../src/protocol/signing.js";

function setup() {
  const offerer = generateKeyPair();
  const bob = generateKeyPair();
  const carol = generateKeyPair();
  const keys = new AppendOnlyKeyStore();
  keys.register("did:plc:offerer", offerer.publicKey);
  keys.register("did:plc:bob", bob.publicKey);
  keys.register("did:plc:carol", carol.publicKey);
  const v = new ActionValidator({ keys, selfOrigin: "origin.test" });
  return { offerer, bob, carol, keys, v };
}

describe("handoff lifecycle", () => {
  it("directed offer → accept → complete", () => {
    const { offerer, bob, v } = setup();
    const offer = mintOffer(offerer, "did:plc:offerer", {
      title: "Cite 3 sources",
      to: "did:plc:bob",
      target: "#ops",
      origin: "origin.test",
    });
    expect(v.apply(offer).ok).toBe(true);
    expect(v.getView(offer.id)!.state).toBe("offered");

    const accept = mintTransition(
      bob,
      "did:plc:bob",
      v.getView(offer.id)!,
      "accept",
    );
    expect(v.apply(accept).ok).toBe(true);
    expect(v.getView(offer.id)!.state).toBe("assigned");
    expect(v.getView(offer.id)!.assignee).toBe("did:plc:bob");

    const complete = mintTransition(
      bob,
      "did:plc:bob",
      v.getView(offer.id)!,
      "complete",
    );
    expect(v.apply(complete).ok).toBe(true);
    expect(v.getView(offer.id)!.state).toBe("completed");
  });

  it("open offer → first claim wins", () => {
    const { offerer, bob, carol, v } = setup();
    const offer = mintOffer(offerer, "did:plc:offerer", {
      title: "Summarize logs",
      caps: ["freeq.at/log-analysis"],
      target: "#swarm",
      origin: "origin.test",
    });
    expect(v.apply(offer).ok).toBe(true);
    expect(v.getView(offer.id)!.state).toBe("open");

    const c1 = mintTransition(bob, "did:plc:bob", v.getView(offer.id)!, "claim", {
      caps: ["freeq.at/log-analysis"],
    });
    expect(v.apply(c1).ok).toBe(true);
    expect(v.getView(offer.id)!.assignee).toBe("did:plc:bob");

    const c2 = mintTransition(
      carol,
      "did:plc:carol",
      v.getView(offer.id)!,
      "claim",
      { caps: ["freeq.at/log-analysis"] },
    );
    const r = v.apply(c2);
    expect(r.ok).toBe(false);
  });

  it("offerer may cancel; non-offerer may not", () => {
    const { offerer, bob, v } = setup();
    const offer = mintOffer(offerer, "did:plc:offerer", {
      title: "x",
      to: "did:plc:bob",
      target: "#ops",
      origin: "origin.test",
    });
    v.apply(offer);
    const bad = mintTransition(bob, "did:plc:bob", v.getView(offer.id)!, "cancel");
    expect(v.apply(bad).ok).toBe(false);
    const ok = mintTransition(
      offerer,
      "did:plc:offerer",
      v.getView(offer.id)!,
      "cancel",
    );
    expect(v.apply(ok).ok).toBe(true);
    expect(v.getView(offer.id)!.state).toBe("cancelled");
  });

  it("defers unverifiable, applies after key arrives", () => {
    const offerer = generateKeyPair();
    const keys = new AppendOnlyKeyStore();
    // deliberately do NOT register offerer yet
    let available = false;
    const v = new ActionValidator({
      keys,
      fetchKey: (did, kid) => {
        if (!available) return "unavailable";
        return keys.get(did, kid);
      },
    });
    const offer = mintOffer(offerer, "did:plc:late", {
      title: "deferred",
      target: "#ops",
      origin: "remote",
    });
    const r1 = v.apply(offer);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("defer");

    keys.register("did:plc:late", offerer.publicKey);
    available = true;
    const results = v.retryDeferred();
    expect(results[0]?.ok).toBe(true);
    expect(v.getView(offer.id)?.state).toBe("open");
  });

  it("rejects open direct actions", () => {
    const { offerer, v } = setup();
    const offer = mintOffer(offerer, "did:plc:offerer", {
      title: "pointless",
      target: "did:plc:bob", // DM target, no act-to
      origin: "origin.test",
    });
    const r = v.apply(offer);
    expect(r.ok).toBe(false);
  });

  it("enforces deadline with grace", () => {
    const { offerer, bob, v } = setup();
    const past = Math.floor(Date.now() / 1000) - 1000;
    const offer = mintOffer(offerer, "did:plc:offerer", {
      title: "late",
      to: "did:plc:bob",
      target: "#ops",
      origin: "origin.test",
      deadline: past,
    });
    // offer itself past deadline → reject
    expect(v.apply(offer).ok).toBe(false);
  });
});
