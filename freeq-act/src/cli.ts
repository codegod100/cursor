#!/usr/bin/env node
/**
 * CLI: freeq-act bot | serve | offer | demo
 */

import { parseArgs } from "node:util";
import { ActBot } from "./irc/bot.js";
import { ActionValidator, mintOffer, mintTransition } from "./protocol/validator.js";
import {
  AppendOnlyKeyStore,
  generateKeyPair,
} from "./protocol/signing.js";
import { listenActApi } from "./rest/server.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string", default: "act-bot" },
    server: { type: "string", default: "wss://irc.freeq.at/irc" },
    channel: { type: "string", default: "#act" },
    nick: { type: "string" },
    did: { type: "string" },
    password: { type: "string" },
    port: { type: "string", default: "8787" },
    caps: { type: "string", default: "freeq.at/demo" },
    "auto-claim": { type: "boolean", default: false },
    local: { type: "boolean", default: false },
    title: { type: "string" },
    to: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

const cmd = positionals[0] ?? "help";

if (values.help || cmd === "help") {
  console.log(`freeq-act — RFC v0.4 freeq.at/act bot

Usage:
  freeq-act bot [--local] [--server wss://…] [--channel #act] [--port 8787]
                [--caps freeq.at/demo] [--auto-claim] [--nick N]
  freeq-act serve --local [--port 8787]   # REST only
  freeq-act demo                          # in-process handoff lifecycle test
  freeq-act offer --title "…" [--to did:…] [--channel #act]

Env:
  FREEQ_ACT_URL, FREEQ_ACT_NICK, FREEQ_ACT_PASSWORD, FREEQ_ACT_DID, FREEQ_ACT_PORT
`);
  process.exit(0);
}

const caps = String(values.caps)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function runBot(local: boolean) {
  const bot = new ActBot({
    name: values.name,
    ircUrl: process.env.FREEQ_ACT_URL ?? values.server,
    nick: process.env.FREEQ_ACT_NICK ?? values.nick ?? values.name,
    did: process.env.FREEQ_ACT_DID ?? values.did,
    password: process.env.FREEQ_ACT_PASSWORD ?? values.password,
    channels: [values.channel!],
    apiPort: Number(process.env.FREEQ_ACT_PORT ?? values.port),
    caps,
    autoClaim: values["auto-claim"],
    local,
    origin: "local",
  });
  await bot.start();
  const shutdown = () => {
    bot.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (cmd === "bot") {
  await runBot(Boolean(values.local));
} else if (cmd === "serve") {
  await runBot(true);
} else if (cmd === "demo") {
  await runDemo();
} else if (cmd === "offer") {
  if (!values.title) {
    console.error("--title required");
    process.exit(1);
  }
  const bot = new ActBot({
    name: values.name,
    local: true,
    apiPort: Number(values.port),
    caps,
    channels: [values.channel!],
  });
  await bot.start();
  const ev = bot.offer({
    title: values.title,
    to: values.to,
    target: values.channel,
    caps,
  });
  console.log(JSON.stringify(ev, null, 2));
  bot.stop();
  process.exit(0);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

async function runDemo() {
  const offerer = generateKeyPair();
  const worker = generateKeyPair();
  const keys = new AppendOnlyKeyStore();
  const offererDid = "did:plc:offerer";
  const workerDid = "did:plc:worker";
  keys.register(offererDid, offerer.publicKey);
  keys.register(workerDid, worker.publicKey);

  const v = new ActionValidator({ keys, selfOrigin: "origin.example" });

  const offer = mintOffer(offerer, offererDid, {
    title: "Summarize today's S2S logs",
    caps: ["freeq.at/log-analysis"],
    target: "#swarm",
    origin: "origin.example",
    deadline: Math.floor(Date.now() / 1000) + 3600,
  });
  console.log("1. offer", v.apply(offer));

  const claim = mintTransition(worker, workerDid, v.getView(offer.id)!, "claim", {
    caps: ["freeq.at/log-analysis"],
  });
  console.log("2. claim", v.apply(claim));

  const progress = mintTransition(
    worker,
    workerDid,
    v.getView(offer.id)!,
    "progress",
  );
  console.log("3. progress", v.apply(progress));

  const complete = mintTransition(
    worker,
    workerDid,
    v.getView(offer.id)!,
    "complete",
  );
  console.log("4. complete", v.apply(complete));

  console.log("\nFinal view:", JSON.stringify(v.getView(offer.id), null, 2));

  // Directed accept path
  const offer2 = mintOffer(offerer, offererDid, {
    title: "Cite 3 sources",
    to: workerDid,
    target: "#ops",
    origin: "origin.example",
  });
  v.apply(offer2);
  const accept = mintTransition(worker, workerDid, v.getView(offer2.id)!, "accept");
  console.log("\nDirected accept:", v.apply(accept));

  // Bad signature rejected
  const bad = { ...offer, sig: "ed25519:dead:aaaa" };
  console.log("\nForgery:", v.apply(bad as typeof offer));

  // REST smoke
  listenActApi(
    { validator: v, kp: offerer, did: offererDid, origin: "origin.example" },
    8799,
  );
  const res = await fetch("http://127.0.0.1:8799/api/v1/actions");
  console.log("\nREST GET /api/v1/actions", await res.json());
  process.exit(0);
}
