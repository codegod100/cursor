/**
 * Minimal freeq-compatible IRC-over-WebSocket transport for act TAGMSG.
 * Speaks message-tags; registers durable MSGSIG when possible.
 */

import WebSocket from "ws";
import { EventEmitter } from "node:events";
import {
  formatTagmsg,
  parseIrcLine,
  signedEventFromTags,
  buildWireTags,
  fieldsToShortMap,
} from "../protocol/tags.js";
import type { SignedActEvent } from "../protocol/types.js";
import { b64url, type ActKeyPair } from "../protocol/signing.js";
import { ACT_CAP } from "../protocol/types.js";

export interface IrcTransportOptions {
  url: string;
  nick: string;
  did: string;
  kp: ActKeyPair;
  channels?: string[];
  /** SASL PLAIN password (optional — guest mode if omitted). */
  password?: string;
  originLabel?: string;
}

export interface ActTransportEvents {
  ready: [];
  act: [SignedActEvent];
  raw: [string];
  close: [code: number, reason: string];
  error: [Error];
}

export class IrcActTransport extends EventEmitter {
  private ws: WebSocket | null = null;
  private opts: IrcTransportOptions;
  private registered = false;
  private nick: string;

  constructor(opts: IrcTransportOptions) {
    super();
    this.opts = opts;
    this.nick = opts.nick;
  }

  on<K extends keyof ActTransportEvents>(
    event: K,
    listener: (...args: ActTransportEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  async connect(): Promise<void> {
    const { url, nick, password } = this.opts;
    this.ws = new WebSocket(url, {
      headers: { Origin: "https://freeq.at" },
    });

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      const t = setTimeout(() => reject(new Error("IRC connect timeout")), 20000);
      ws.once("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.once("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    this.ws.on("message", (data) => {
      const text = data.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line) this.handleLine(line);
      }
    });
    this.ws.on("close", (code, reason) => {
      this.emit("close", code, reason.toString());
    });

    // CAP negotiation
    this.sendRaw("CAP LS 302");
    this.sendRaw(`NICK ${nick}`);
    this.sendRaw(`USER ${nick} 0 * :freeq-act bot`);
    if (password) {
      // Will AUTHENTICATE after CAP ACK sasl — for MVP send PASS if provided
      this.sendRaw(`PASS ${password}`);
    }
  }

  private capsNegotiated = false;

  private handleLine(line: string): void {
    this.emit("raw", line);
    if (line.startsWith("PING ")) {
      this.sendRaw(`PONG ${line.slice(5)}`);
      return;
    }

    const msg = parseIrcLine(line);
    if (!msg) return;

    if (msg.command === "CAP") {
      const sub = msg.params[1]?.toUpperCase();
      if (sub === "LS" || sub === "ACK" || sub === "NAK") {
        if (!this.capsNegotiated && (sub === "LS" || msg.params.includes("LS"))) {
          // Request useful caps; freeq.at/act may not exist server-side yet
          this.sendRaw(
            `CAP REQ :message-tags server-time account-tag batch labeled-response ${ACT_CAP}`,
          );
        }
        if (sub === "ACK" || sub === "NAK") {
          this.capsNegotiated = true;
          this.sendRaw("CAP END");
        }
      }
    }

    // Welcome
    if (msg.command === "001") {
      this.nick = msg.params[0] ?? this.nick;
      // Register durable signing key (append-only on servers that support it)
      this.sendRaw(`MSGSIG ${b64url(this.opts.kp.publicKey)}`);
      for (const ch of this.opts.channels ?? []) {
        this.sendRaw(`JOIN ${ch}`);
      }
      this.registered = true;
      this.emit("ready");
    }

    if (msg.command === "TAGMSG" || msg.command === "PRIVMSG") {
      const target = msg.params[0];
      if (!target) return;
      // Inject act-from from account-tag / prefix if missing
      const tags = { ...msg.tags };
      const account =
        tags.account ??
        tags["+freeq.at/did"] ??
        tags["freeq.at/did"];
      if (!tags["+freeq.at/act-from"] && !tags["freeq.at/act-from"] && account) {
        tags["+freeq.at/act-from"] = account.startsWith("did:")
          ? account
          : `did:plc:${account}`;
      }
      // Only care about act messages
      if (!tags["+freeq.at/act"] && !tags["freeq.at/act"]) return;

      // Prefer DID from act-from tag
      const event = signedEventFromTags(tags, {
        target,
        origin: this.opts.originLabel ?? hostFromPrefix(msg.prefix),
        receivedAt: Date.now(),
      });
      if (event) this.emit("act", event);
    }
  }

  sendRaw(line: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("IRC not connected");
    }
    this.ws.send(line.endsWith("\r\n") ? line : `${line}\r\n`);
  }

  /** Publish a signed act event as TAGMSG. */
  publish(event: SignedActEvent): void {
    const target = event.target;
    if (!target) throw new Error("event.target required to publish");
    const short = event.rawTags
      ? Object.fromEntries(
          Object.entries(event.rawTags)
            .map(([k, v]) => {
              const name = k.replace(/^\+/, "").replace(/^freeq\.at\//, "");
              return [name, v] as const;
            })
            .filter(([k]) => k === "act" || k.startsWith("act-") || k === "sig"),
        )
      : {
          ...fieldsToShortMap(event),
          sig: event.sig,
        };
    const { sig, ...fields } = short;
    const tags = buildWireTags(fields, sig ?? event.sig, true);
    this.sendRaw(formatTagmsg(target, tags));
  }

  join(channel: string): void {
    this.sendRaw(`JOIN ${channel}`);
  }

  privmsg(target: string, text: string): void {
    this.sendRaw(`PRIVMSG ${target} :${text}`);
  }

  close(): void {
    this.sendRaw("QUIT :freeq-act shutting down");
    this.ws?.close();
  }

  get isReady(): boolean {
    return this.registered;
  }
}

function hostFromPrefix(prefix?: string): string | undefined {
  if (!prefix) return undefined;
  const bang = prefix.lastIndexOf("@");
  return bang >= 0 ? prefix.slice(bang + 1) : undefined;
}
