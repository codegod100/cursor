import { describe, it, expect } from "vitest";
import {
  formatTagmsg,
  parseIrcLine,
  signedEventFromTags,
  parseTagString,
} from "../src/protocol/tags.js";

describe("wire tags", () => {
  it("formats and parses TAGMSG", () => {
    const line = formatTagmsg("#ops", {
      "+freeq.at/act": "handoff",
      "+freeq.at/act-verb": "offer",
      "+freeq.at/act-id": "01JABC",
      "+freeq.at/act-from": "did:plc:x",
      "+freeq.at/sig": "ed25519:kid:sig",
    });
    expect(line.startsWith("@")).toBe(true);
    expect(line.endsWith("TAGMSG #ops")).toBe(true);
    const parsed = parseIrcLine(`:nick!u@h ${line}`);
    // prefix form — our formatTagmsg doesn't include prefix; simulate receive
    const recv = parseIrcLine(
      `@+freeq.at/act=handoff;+freeq.at/act-verb=offer;+freeq.at/act-id=01JABC;+freeq.at/act-from=did:plc:x;+freeq.at/sig=ed25519:kid:sig :nick!u@h TAGMSG #ops`,
    );
    expect(recv?.command).toBe("TAGMSG");
    expect(recv?.params[0]).toBe("#ops");
    const ev = signedEventFromTags(recv!.tags, { target: "#ops" });
    expect(ev?.kind).toBe("handoff");
    expect(ev?.verb).toBe("offer");
    expect(ev?.from).toBe("did:plc:x");
  });

  it("escapes spaces in tag values", () => {
    const tags = parseTagString("@+freeq.at/act-title=Cite\\s3\\ssources");
    expect(tags["+freeq.at/act-title"]).toBe("Cite 3 sources");
  });
});
