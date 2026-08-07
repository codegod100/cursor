/**
 * Persist materialized views + append-only key registry to disk (rebuildable).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ActionView } from "../protocol/types.js";
import {
  AppendOnlyKeyStore,
  generateKeyPair,
  keyPairFromSeed,
  exportSeedHex,
  type ActKeyPair,
  b64url,
  b64urlDecode,
} from "../protocol/signing.js";

export interface ActStoreData {
  did: string;
  seedHex: string;
  keys: { did: string; kid: string; pubkeyB64: string }[];
  views: ActionView[];
}

export function defaultDataDir(name = "freeq-act"): string {
  return join(homedir(), ".freeq", "act", name);
}

export class ActStore {
  readonly dir: string;
  readonly keys = new AppendOnlyKeyStore();
  kp!: ActKeyPair;
  did!: string;
  views: ActionView[] = [];

  constructor(dir?: string) {
    this.dir = dir ?? defaultDataDir();
  }

  loadOrCreate(preferredDid?: string): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, "state.json");
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf8")) as ActStoreData;
      this.did = data.did;
      this.kp = keyPairFromSeed(data.seedHex);
      this.keyList = [];
      for (const k of data.keys ?? []) {
        this.keys.register(k.did, b64urlDecode(k.pubkeyB64));
        this.keyList.push(k);
      }
      this.views = data.views ?? [];
      // Ensure our own key is registered
      this.registerKey(this.did, this.kp.publicKey);
      return;
    }
    this.kp = generateKeyPair();
    // did:key from ed25519 — local MVP identity (not multicodec-complete)
    this.did =
      preferredDid ?? `did:key:z6Mk${b64url(this.kp.publicKey).slice(0, 44)}`;
    this.keyList = [];
    this.registerKey(this.did, this.kp.publicKey);
    this.views = [];
    this.save();
  }

  save(views?: ActionView[]): void {
    if (views) this.views = views;
    const path = join(this.dir, "state.json");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Reconstruct key list from store by re-reading registered via save snapshot
    const data: ActStoreData = {
      did: this.did,
      seedHex: exportSeedHex(this.kp),
      keys: this.snapshotKeys(),
      views: this.views,
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /** Export known keys — keep a parallel list on register. */
  private keyList: { did: string; kid: string; pubkeyB64: string }[] = [];

  registerKey(did: string, pubkey: Uint8Array): string {
    const kid = this.keys.register(did, pubkey);
    if (!this.keyList.some((k) => k.did === did && k.kid === kid)) {
      this.keyList.push({ did, kid, pubkeyB64: b64url(pubkey) });
    }
    return kid;
  }

  private snapshotKeys() {
    if (this.keyList.length) return this.keyList;
    // At least self
    return [
      {
        did: this.did,
        kid: this.kp.kid,
        pubkeyB64: b64url(this.kp.publicKey),
      },
    ];
  }
}
