import { ApiPromise, WsProvider } from "@polkadot/api";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { u8aConcat, hexToU8a, stringToU8a } from "@polkadot/util";

export const NODE_WS = "wss://pre-consensus-attestation-pallet-fastlane.projectfreedom.io/ws";

// FastLane REST API (Swagger-documented) served on the same host under /api.
export const API_BASE = "https://pre-consensus-attestation-pallet-fastlane.projectfreedom.io/api";

export type NodeStatus = {
  name: string;
  address: string;
  online: boolean;
  ocwOnline: boolean;
  syncing: boolean | null;
  peers: number | null;
  reason: string;
};

// Well-known dev-account addresses → friendly names, so authorities render as
// "Alice" etc. even when the /nodes API is unavailable.
export const KNOWN_ACCOUNTS: Record<string, string> = {
  "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY": "Alice",
  "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty": "Bob",
  "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y": "Charlie",
  "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy": "Dave",
  "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw": "Eve",
  "5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL": "Ferdie",
};

export function accountName(address: string): string | undefined {
  return KNOWN_ACCOUNTS[address];
}

let apiPromise: Promise<ApiPromise> | null = null;
let provider: WsProvider | null = null;

export function getApi(): Promise<ApiPromise> {
  if (apiPromise) return apiPromise;
  provider = new WsProvider(NODE_WS, 2500);
  apiPromise = ApiPromise.create({ provider, throwOnConnect: false });
  return apiPromise;
}

export function truncate(addr: string, head = 6, tail = 4) {
  if (!addr) return "";
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function randomHash(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- §14 Phase-2 helpers: signature aggregation + inclusion commitments ---

/** Canonical inclusion-commitment message hashed & signed by an authority:
 *  blake2_256(payloadId ++ "INCLUDE" ++ deadline.encode()). Matches the pallet's
 *  `inclusion_message_hash`. */
export function inclusionMsgHash(api: ApiPromise, payloadId: string, deadline: number): Uint8Array {
  const deadlineEncoded = api.registry.createType("BlockNumber", deadline).toU8a();
  const msg = u8aConcat(hexToU8a(payloadId), stringToU8a("INCLUDE"), deadlineEncoded);
  return blake2AsU8a(msg, 256);
}

export type Aggregate = { signerBitmap: string; digest: string; count: number };

/** Compact aggregate written when a payload reaches threshold; survives finalise. */
export async function fetchAggregate(api: ApiPromise, payloadId: string): Promise<Aggregate | null> {
  const p = (api.query as any).fastlane;
  if (!p?.aggregatedAttestations) return null;
  const opt = await p.aggregatedAttestations(payloadId);
  if (opt.isNone) return null;
  const a = opt.unwrap();
  return { signerBitmap: a.signerBitmap.toString(), digest: a.digest.toString(), count: a.count.toNumber() };
}

/** Authority addresses whose bitmap bit is set, resolved against the live set. */
export async function aggregateSigners(api: ApiPromise, agg: Aggregate): Promise<string[]> {
  const authorities = await (api.query as any).fastlane.authorities();
  const bitmap = BigInt(agg.signerBitmap);
  return authorities
    .map((a: any) => a.toString())
    .filter((_: string, i: number) => (bitmap >> BigInt(i)) & 1n);
}

export type InclusionCommitment = { authority: string; committedAt: string; deadline: string; signature: string };

export async function fetchInclusions(api: ApiPromise, payloadId: string): Promise<InclusionCommitment[]> {
  const p = (api.query as any).fastlane;
  if (!p?.inclusionCommitments) return [];
  const records = await p.inclusionCommitments(payloadId);
  const arr = (records.toJSON?.() ?? []) as any[];
  return arr.map((r) => ({
    authority: String(r.authority ?? ""),
    committedAt: String(r.committedAt ?? r.committed_at ?? ""),
    deadline: String(r.deadline ?? ""),
    signature: String(r.signature ?? ""),
  }));
}

export type StatusKind = "Submitted" | "PreConsensed" | "Finalised" | "Expired";

export type StatusInfo = {
  /** Canonical pallet status. Use this for logic — never the display string. */
  label: StatusKind;
  /** What the user reads. Deliberately differs from `label`. */
  display: string;
  /** One-line explanation of the guarantee this state actually carries. */
  hint: string;
  classes: string;
  emoji: string;
};

/**
 * The pallet's `Finalised` is a pallet state flag, NOT Substrate/GRANDPA chain
 * finality — spec §1: "This pallet does NOT replace block consensus or
 * finality." Rendering the word "Finalised" beside an explorer's "finalized"
 * conflates two different guarantees, so the display names are decoupled from
 * the on-chain status names here.
 *
 * `PreConsensed` reads as reversible on purpose, to surface §12's warning
 * ("Do NOT treat PreConsensed as irreversible") where users actually look.
 */
export function statusInfo(s: string): StatusInfo {
  const v = (s || "").toLowerCase();
  if (v.includes("preconsensed") || v.includes("preconsensus"))
    return {
      label: "PreConsensed",
      display: "Approved — reversible",
      hint: "Threshold signatures collected. Fast-lane approved, but not yet settled — do not treat as irreversible.",
      classes: "bg-info/15 text-info border-info/40",
      emoji: "✅",
    };
  if (v.includes("finalis") || v.includes("finaliz"))
    return {
      label: "Finalised",
      display: "Settled",
      hint: "Pallet state transition applied. This is FastLane settlement, not chain finality — GRANDPA finality is tracked separately by the node.",
      classes: "bg-success/15 text-success border-success/40",
      emoji: "🏆",
    };
  if (v.includes("expired"))
    return {
      label: "Expired",
      display: "Expired",
      hint: "Threshold was not reached before the expiry block. No further processing allowed.",
      classes: "bg-destructive/15 text-destructive border-destructive/40",
      emoji: "💀",
    };
  return {
    label: "Submitted",
    display: "Submitted",
    hint: "Payload registered on-chain, awaiting authority attestations.",
    classes: "bg-warning/15 text-warning border-warning/40",
    emoji: "⏳",
  };
}
