# freeq-act

MVP implementation of **[RFC v0.4: `freeq.at/act`](../HANDOFF-RFC.md)** — stateful, signed, addressed actions for IRCv3, with `handoff` as the first kind.

This is a **client/bot + local validator + REST view**, not a freeq-server patch. It speaks the wire format over TAGMSG, validates transitions locally (including three-way signature checks), materializes a queryable view, and exposes the RFC REST shape. Use it to coordinate agents today; server-side CAP / claim serialization can adopt the same modules later.

## What works (MVP)

| Piece | Status |
|---|---|
| `act-*` wire tags + TAGMSG publish/parse | ✅ |
| JCS canonical over all present `act-*` + `act-from` | ✅ |
| ed25519 sig `ed25519:<kid>:<sig>` with hash-derived kid | ✅ |
| Append-only `(DID, kid)` key store | ✅ |
| Three-way verify: valid / invalid-reject / unverifiable-defer | ✅ |
| `handoff` transition table + authz | ✅ |
| Directed + open/claimable (no `act-to`) | ✅ |
| Materialized view + REST `/api/v1/actions` | ✅ |
| Deadline skew grace (±120s) | ✅ |
| Orphan annotation + expiry sweep (local) | ✅ |
| IRC WebSocket transport (freeq-compatible) | ✅ |
| Auto-claim worker mode | ✅ |

## Gaps vs full RFC

- **Server CAP / minting-server claim serializer** — not in freeq-server yet; this process serializes locally for actions it validates.
- **Origin-server key lookup over HTTP** (`/api/v1/signing-keys/{did}`) — stubbed via defer + local register; wire up when talking to a live origin.
- **DID-document key anchoring** — follow-on per RFC.
- **CHATHISTORY replay hydration** — reconnect reloads disk view; does not yet scrape channel history for missed TAGMSG.
- **`approval` / `grant` kinds** — substrate accepts offer/request-shaped events; full policy tables not shipped (handoff-first discipline).
- **Encrypted-content mode** — not implemented.

## Install

```bash
cd freeq-act
npm install
npm test
npm run build
```

## Quick demo (no IRC)

In-process open handoff lifecycle + REST smoke:

```bash
npx tsx src/cli.ts demo
```

Local REST-only bot (persists under `~/.freeq/act/<name>/`):

```bash
npx tsx src/cli.ts serve --local --port 8787
# or
npx tsx src/cli.ts bot --local --port 8787
```

```bash
# offer
curl -s localhost:8787/api/v1/actions -H 'content-type: application/json' \
  -d '{"title":"Summarize S2S logs","caps":["freeq.at/log-analysis"],"target":"#swarm"}'

# list
curl -s 'localhost:8787/api/v1/actions?state=open'

# claim / complete (use act-id from offer)
curl -s -X POST localhost:8787/api/v1/actions/<act-id>/claim \
  -H 'content-type: application/json' -d '{"caps":["freeq.at/log-analysis"]}'
curl -s -X POST localhost:8787/api/v1/actions/<act-id>/complete
```

## IRC bot

```bash
export FREEQ_ACT_URL=wss://irc.freeq.at/irc   # optional
export FREEQ_ACT_NICK=act-worker
# export FREEQ_ACT_PASSWORD=…                 # if SASL/PASS required

npx tsx src/cli.ts bot \
  --channel '#act' \
  --caps freeq.at/log-analysis,freeq.at/web-search \
  --auto-claim \
  --port 8787
```

The bot:

1. Negotiates `message-tags` (and requests `freeq.at/act` CAP if the server knows it).
2. Registers its durable ed25519 pubkey via `MSGSIG`.
3. Publishes/consumes `@+freeq.at/act=…` TAGMSG lines.
4. Serves the materialized view on `:8787`.

Offer from another process / curl against a connected bot, or:

```bash
npx tsx src/cli.ts offer --local --title "Cite 3 sources" --to did:plc:scholar
```

## Wire example

Directed handoff offer (channel-visible):

```
@+freeq.at/act=handoff;+freeq.at/act-verb=offer;+freeq.at/act-id=01J…;
 +freeq.at/act-from=did:plc:offerer;+freeq.at/act-to=did:plc:scholar;
 +freeq.at/act-title=Cite\s3\ssources;+freeq.at/sig=ed25519:kid:… TAGMSG #ops
```

Open/claimable (no `act-to`):

```
@+freeq.at/act=handoff;+freeq.at/act-verb=offer;+freeq.at/act-id=01J…;
 +freeq.at/act-from=did:plc:offerer;+freeq.at/act-title=Summarize\slogs;
 +freeq.at/act-caps=freeq.at/log-analysis;+freeq.at/sig=ed25519:kid:… TAGMSG #swarm
```

## Library

```ts
import {
  ActionValidator,
  mintOffer,
  mintTransition,
  AppendOnlyKeyStore,
  generateKeyPair,
} from "@freeq/act";
```

## Layout

```
src/
  protocol/     # canonical, signing, tags, validator, handoff policy
  store/        # durable DID key + view persistence
  rest/         # GET/POST /api/v1/actions
  irc/          # WebSocket TAGMSG transport + ActBot
  cli.ts
tests/
```

## Env

| Variable | Meaning |
|---|---|
| `FREEQ_ACT_URL` | IRC WebSocket URL (default `wss://irc.freeq.at/irc`) |
| `FREEQ_ACT_NICK` | Nick |
| `FREEQ_ACT_PASSWORD` | Optional PASS/SASL secret |
| `FREEQ_ACT_DID` | Force DID (otherwise `did:key:…` from local seed) |
| `FREEQ_ACT_PORT` | REST port (default `8787`) |
