/**
 * Act bot — connects IRC, validates act events, serves REST, optional auto-claim.
 */

import { ActionValidator, mintOffer, mintTransition } from "../protocol/validator.js";
import { ActStore } from "../store/persist.js";
import { listenActApi } from "../rest/server.js";
import { IrcActTransport } from "./transport.js";
import type { SignedActEvent } from "../protocol/types.js";

export interface ActBotOptions {
  name?: string;
  dataDir?: string;
  did?: string;
  ircUrl?: string;
  nick?: string;
  channels?: string[];
  password?: string;
  apiPort?: number;
  /** Caps this bot advertises for open claims. */
  caps?: string[];
  /** Auto-claim open handoffs matching caps. */
  autoClaim?: boolean;
  /** Local-only (no IRC). */
  local?: boolean;
  origin?: string;
}

export class ActBot {
  readonly store: ActStore;
  readonly validator: ActionValidator;
  transport: IrcActTransport | null = null;
  private opts: ActBotOptions;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ActBotOptions = {}) {
    this.opts = opts;
    this.store = new ActStore(opts.dataDir);
    this.store.loadOrCreate(opts.did);
    this.validator = new ActionValidator({
      keys: this.store.keys,
      selfDid: this.store.did,
      selfOrigin: opts.origin,
    });
    // Hydrate views
    for (const v of this.store.views) {
      // direct inject — trust local disk as rebuild of prior validated log
      (this.validator as unknown as { views: Map<string, typeof v> }).views.set(
        v.id,
        v,
      );
    }
  }

  get did(): string {
    return this.store.did;
  }

  async start(): Promise<void> {
    const port = this.opts.apiPort ?? 8787;
    listenActApi({
      validator: this.validator,
      kp: this.store.kp,
      did: this.store.did,
      origin: this.opts.origin,
      publish: (event) => this.publish(event),
    }, port);

    this.persistTimer = setInterval(() => {
      this.store.save(this.validator.allViews());
      this.validator.sweepExpired();
    }, 15_000);

    if (this.opts.local) {
      console.error(`[act] local mode — DID ${this.did} — REST :${port}`);
      return;
    }

    const url = this.opts.ircUrl ?? "wss://irc.freeq.at/irc";
    const nick = this.opts.nick ?? this.opts.name ?? "act-bot";
    this.transport = new IrcActTransport({
      url,
      nick,
      did: this.store.did,
      kp: this.store.kp,
      channels: this.opts.channels ?? ["#act"],
      password: this.opts.password,
      originLabel: this.opts.origin,
    });

    this.transport.on("act", (event) => this.onAct(event));
    this.transport.on("ready", () => {
      console.error(
        `[act] IRC ready as ${nick} did=${this.did} channels=${(this.opts.channels ?? ["#act"]).join(",")}`,
      );
    });
    this.transport.on("close", (code, reason) => {
      console.error(`[act] IRC closed ${code} ${reason}`);
    });

    await this.transport.connect();
  }

  private onAct(event: SignedActEvent): void {
    // Ensure we know the sender key if they embedded pubkey somehow — otherwise
    // rely on prior MSGSIG / local register. For peer MVP, accept keys registered
    // out-of-band via REST or same process.
    const result = this.validator.apply(event);
    if (!result.ok) {
      console.error(
        `[act] ${result.code} act-id=${event.id} verb=${event.verb}: ${result.reason}`,
      );
      return;
    }
    console.error(
      `[act] ok ${event.verb} ${event.id} → ${result.view.state} (assignee=${result.view.assignee ?? "-"})`,
    );
    this.store.save(this.validator.allViews());

    if (
      this.opts.autoClaim &&
      result.view.state === "open" &&
      event.verb === "offer" &&
      this.capsMatch(result.view.caps)
    ) {
      const claim = mintTransition(
        this.store.kp,
        this.store.did,
        result.view,
        "claim",
        { caps: this.opts.caps },
      );
      const cr = this.validator.apply(claim);
      if (cr.ok) {
        this.publish(claim);
        console.error(`[act] auto-claimed ${claim.id}`);
      }
    }
  }

  private capsMatch(needed?: string[]): boolean {
    if (!needed?.length) return true;
    const have = new Set(this.opts.caps ?? []);
    return needed.some((c) => have.has(c));
  }

  publish(event: SignedActEvent): void {
    if (!event.target) {
      console.warn("[act] not publishing — no target");
      return;
    }
    if (!this.transport?.isReady) {
      console.warn("[act] IRC not ready — event applied locally only");
      return;
    }
    this.transport.publish(event);
  }

  offer(opts: {
    title: string;
    to?: string;
    caps?: string[];
    target?: string;
    deadline?: number;
  }): SignedActEvent {
    const event = mintOffer(this.store.kp, this.store.did, {
      title: opts.title,
      to: opts.to,
      caps: opts.caps ?? this.opts.caps,
      target: opts.target ?? this.opts.channels?.[0] ?? "#act",
      deadline: opts.deadline,
      origin: this.opts.origin,
    });
    const result = this.validator.apply(event);
    if (!result.ok) throw new Error(result.reason);
    this.publish(event);
    this.store.save(this.validator.allViews());
    return event;
  }

  stop(): void {
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.store.save(this.validator.allViews());
    this.transport?.close();
  }
}
