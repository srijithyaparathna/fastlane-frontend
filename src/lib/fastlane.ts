import { ApiPromise, WsProvider } from "@polkadot/api";

export const NODE_WS = "ws://localhost:19944";

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

export type StatusKind = "Submitted" | "PreConsensed" | "Finalised" | "Expired";

export function statusInfo(s: string): { label: StatusKind; classes: string; emoji: string } {
  const v = (s || "").toLowerCase();
  if (v.includes("preconsensed") || v.includes("preconsensus"))
    return { label: "PreConsensed", classes: "bg-info/15 text-info border-info/40", emoji: "✅" };
  if (v.includes("finalis") || v.includes("finaliz"))
    return { label: "Finalised", classes: "bg-success/15 text-success border-success/40", emoji: "🏆" };
  if (v.includes("expired"))
    return { label: "Expired", classes: "bg-destructive/15 text-destructive border-destructive/40", emoji: "💀" };
  return { label: "Submitted", classes: "bg-warning/15 text-warning border-warning/40", emoji: "⏳" };
}
