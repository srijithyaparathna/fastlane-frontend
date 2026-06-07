import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import type { ApiPromise } from "@polkadot/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { getApi } from "@/lib/fastlane";
import { toast } from "sonner";

export type ConnState = "connecting" | "connected" | "disconnected";
export type WalletAccount = { address: string; name?: string; source: "dev" | "extension" };
export type FLEvent = {
  id: string;
  block: number;
  index: number;
  method: string;
  description: string;
  payloadId?: string;
  data: string[];
  ts: number;
};

const DEV_SEEDS = [
  { name: "Alice",   uri: "//Alice" },
  { name: "Bob",     uri: "//Bob" },
  { name: "Charlie", uri: "//Charlie" },
  { name: "Dave",    uri: "//Dave" },
  { name: "Eve",     uri: "//Eve" },
  { name: "Ferdie",  uri: "//Ferdie" },
];

const EVENT_DESC: Record<string, string> = {
  Submitted:          "A new payload was registered on-chain",
  PreConsensed:       "Threshold signatures collected — fast-lane approved",
  Finalised:          "Confirmed in a canonical block by finalize",
  Finalized:          "Confirmed in a canonical block by finalize",
  Expired:            "Payload expired without reaching consensus",
  AuthoritiesUpdated: "Authority set was replaced by governance",
  ThresholdUpdated:   "Signature threshold was updated by governance",
  BondPosted:         "An authority posted its bond",
  AttestationAdded:   "An authority signed the payload",
};

const MAX_EVENTS = 100;
const HISTORY_BLOCKS = 100;
const BATCH_SIZE = 10;

type Ctx = {
  api: ApiPromise | null;
  state: ConnState;
  block: number | null;
  chain: string;
  accounts: WalletAccount[];
  selected: string;
  extensionConnected: boolean;
  /** Addresses the Polkadot.js extension can sign for (may overlap dev account addresses) */
  extAddresses: Set<string>;
  /** The extension account the user has explicitly logged in as (required to submit payloads) */
  loggedIn: WalletAccount | null;
  /** Opens the Polkadot.js extension and asks the user to sign a sign-in message with their password */
  login: (address: string) => Promise<boolean>;
  logout: () => void;
  setSelected: (a: string) => void;
  connectWallet: () => Promise<void>;
  getSigner: (address: string) => Promise<
    | { type: "keypair"; pair: KeyringPair }
    | { type: "extension"; injector: any }
  >;
  events: FLEvent[];
  clearEvents: () => void;
};

const LOGIN_STORAGE_KEY = "fastlane.loggedInAddress";

const FastLaneCtx = createContext<Ctx | null>(null);

export function FastLaneProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<ApiPromise | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [block, setBlock] = useState<number | null>(null);
  const [chain, setChain] = useState("");
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [selected, setSelected] = useState("");
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [extAddresses, setExtAddresses] = useState<Set<string>>(new Set());
  const [loggedInAddress, setLoggedInAddress] = useState<string | null>(null);
  const [events, setEvents] = useState<FLEvent[]>([]);
  const keypairsRef = useRef<Map<string, KeyringPair>>(new Map());
  const extAddressesRef = useRef<Set<string>>(new Set());
  const extensionInitiated = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());

  // Record which addresses the extension can sign for, so getSigner can prefer it
  const markExtAddresses = useCallback((addrs: string[]) => {
    const next = new Set(extAddressesRef.current);
    addrs.forEach((a) => next.add(a));
    extAddressesRef.current = next;
    setExtAddresses(next);
  }, []);

  // Restore a previous login from this browser session
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOGIN_STORAGE_KEY);
      if (stored) setLoggedInAddress(stored);
    } catch {}
  }, []);

  // Once the extension reports its accounts, drop a stale login that no longer matches
  useEffect(() => {
    if (!extensionConnected || extAddresses.size === 0 || !loggedInAddress) return;
    if (!extAddresses.has(loggedInAddress)) {
      setLoggedInAddress(null);
      try { window.localStorage.removeItem(LOGIN_STORAGE_KEY); } catch {}
    }
  }, [extensionConnected, extAddresses, loggedInAddress]);

  const login = useCallback(async (address: string): Promise<boolean> => {
    if (!extAddressesRef.current.has(address)) {
      toast.error("That account isn't available in the Polkadot.js extension");
      return false;
    }
    try {
      const { web3FromAddress } = await import("@polkadot/extension-dapp");
      const { stringToHex } = await import("@polkadot/util");
      const injector = await web3FromAddress(address);
      if (!injector.signer?.signRaw) {
        throw new Error("This extension account can't sign messages");
      }
      // Opens the Polkadot.js extension popup and requires the user's password to approve.
      const message = `Sign in to FastLane Dashboard\naddress: ${address}\nat: ${new Date().toISOString()}`;
      await injector.signer.signRaw({ address, type: "bytes", data: stringToHex(message) });
    } catch (e: any) {
      toast.error(e?.message ?? "Login was cancelled in the extension");
      return false;
    }
    setLoggedInAddress(address);
    try { window.localStorage.setItem(LOGIN_STORAGE_KEY, address); } catch {}
    return true;
  }, []);

  const logout = useCallback(() => {
    setLoggedInAddress(null);
    try { window.localStorage.removeItem(LOGIN_STORAGE_KEY); } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      // 1. Load dev accounts from keyring
      let devAccounts: WalletAccount[] = [];
      try {
        const { Keyring } = await import("@polkadot/keyring");
        const { cryptoWaitReady } = await import("@polkadot/util-crypto");
        await cryptoWaitReady();
        const keyring = new Keyring({ type: "sr25519" });
        devAccounts = DEV_SEEDS.map(({ name, uri }) => {
          const pair = keyring.addFromUri(uri);
          keypairsRef.current.set(pair.address, pair);
          return { address: pair.address, name, source: "dev" as const };
        });
        setAccounts(devAccounts);
        setSelected(devAccounts[0].address);
      } catch (e) {
        console.error("Failed to load dev accounts", e);
      }

      // 2. Enable extension silently, then subscribe to account changes
      try {
        const { web3Enable, web3AccountsSubscribe } = await import("@polkadot/extension-dapp");
        const extensions = await web3Enable("FastLane Dashboard");
        if (extensions.length === 0) return;

        let previousAddresses: Set<string> = new Set(devAccounts.map((a) => a.address));
        let firstRun = true;

        // Fires immediately with current accounts, then again on every change
        await web3AccountsSubscribe((injectedAccounts) => {
          const extList: WalletAccount[] = injectedAccounts.map((a) => ({
            address: a.address,
            name: a.meta.name,
            source: "extension" as const,
          }));

          setAccounts((prev) => {
            const existing = new Set(prev.map((a) => a.address));
            const extras = extList.filter((a) => !existing.has(a.address));
            return extras.length > 0 ? [...prev, ...extras] : prev;
          });

          // Show toast only when new accounts appear (not on first silent load)
          const newAddresses = new Set(extList.map((a) => a.address));
          const added = extList.filter((a) => !previousAddresses.has(a.address));
          previousAddresses = new Set([...previousAddresses, ...newAddresses]);

          if (!firstRun && added.length > 0) {
            toast.success(
              `Extension connected — ${added.map((a) => a.name ?? a.address.slice(0, 8)).join(", ")} added`
            );
          }
          if (extList.length > 0) {
            markExtAddresses(extList.map((a) => a.address));
            setExtensionConnected(true);
            extensionInitiated.current = true;
          }
          firstRun = false;
        });
      } catch {
        // Extension not available — dev accounts still work
      }
    })();
  }, []);

  const parseBlock = useCallback(async (a: ApiPromise, blockNum: number, ts: number): Promise<FLEvent[]> => {
    try {
      const hash = await a.rpc.chain.getBlockHash(blockNum);
      const apiAt = await a.at(hash);
      const records = await apiAt.query.system.events();
      const out: FLEvent[] = [];
      (records as any).forEach((r: any, i: number) => {
        const { event } = r;
        if (event.section !== "fastlane") return;
        const id = `${blockNum}-${i}-${event.method}`;
        if (seenIds.current.has(id)) return;
        seenIds.current.add(id);
        out.push({
          id,
          block: blockNum,
          index: i,
          method: event.method,
          description: EVENT_DESC[event.method] ?? `fastlane.${event.method}`,
          payloadId: event.data?.[0]?.toString?.(),
          data: Array.from(event.data ?? []).map((d: any) => d.toString()),
          ts,
        });
      });
      return out;
    } catch {
      return [];
    }
  }, []);

  const addEvents = useCallback((fresh: FLEvent[]) => {
    if (fresh.length === 0) return;
    setEvents((cur) => {
      const merged = [...fresh, ...cur];
      merged.sort((a, b) => b.block - a.block || b.index - a.index);
      return merged.slice(0, MAX_EVENTS);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        const a = await getApi();
        if (cancelled) return;
        setApi(a);
        const c = await a.rpc.system.chain();
        setChain(c.toString());
        a.on("connected", () => setState("connected"));
        a.on("disconnected", () => setState("disconnected"));
        a.on("ready", () => setState("connected"));
        setState(a.isConnected ? "connected" : "disconnected");

        // Live subscription — captures every new block's fastlane events
        unsub = await a.rpc.chain.subscribeNewHeads(async (h) => {
          const num = h.number.toNumber();
          setBlock(num);
          setState("connected");
          if (!cancelled) {
            const fresh = await parseBlock(a, num, Date.now());
            addEvents(fresh);
          }
        });

        // Historical scan — last HISTORY_BLOCKS blocks in parallel batches
        const head = await a.rpc.chain.getHeader();
        const tip = head.number.toNumber();
        const blockNums: number[] = [];
        for (let n = tip - 1; n > Math.max(0, tip - HISTORY_BLOCKS); n--) {
          blockNums.push(n);
        }
        // Process in batches of BATCH_SIZE to avoid flooding the RPC
        for (let i = 0; i < blockNums.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = blockNums.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((n) => parseBlock(a, n, Date.now() - (tip - n) * 6000))
          );
          const fresh = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
          addEvents(fresh);
        }
      } catch (e) {
        console.error(e);
        setState("disconnected");
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [parseBlock, addEvents]);

  const connectWallet = async () => {
    // Allow re-triggering even if auto-connect already ran, to pick up newly authorized accounts
    extensionInitiated.current = true;
    try {
      const { web3Enable, web3Accounts } = await import("@polkadot/extension-dapp");
      const ext = await web3Enable("FastLane Dashboard");
      if (ext.length === 0) {
        toast.error("No Polkadot.js extension found. Install it from the Chrome Web Store.");
        return;
      }
      const all = await web3Accounts();
      const extList: WalletAccount[] = all.map((a) => ({ address: a.address, name: a.meta.name, source: "extension" as const }));
      setAccounts((prev) => {
        const existing = new Set(prev.map((a) => a.address));
        const extras = extList.filter((a) => !existing.has(a.address));
        return extras.length > 0 ? [...prev, ...extras] : prev;
      });
      markExtAddresses(extList.map((a) => a.address));
      setExtensionConnected(true);
      toast.success(`Extension connected — ${extList.length} account(s) available`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to connect extension");
    }
  };

  const getSigner = async (address: string): Promise<
    | { type: "keypair"; pair: KeyringPair }
    | { type: "extension"; injector: any }
  > => {
    // Prefer the extension whenever it can sign for this address — even if a dev
    // keypair with the same address exists — so signing goes through the password prompt.
    if (extAddressesRef.current.has(address)) {
      const { web3FromAddress } = await import("@polkadot/extension-dapp");
      const injector = await web3FromAddress(address);
      return { type: "extension", injector };
    }
    const pair = keypairsRef.current.get(address);
    if (pair) return { type: "keypair", pair };
    const { web3FromAddress } = await import("@polkadot/extension-dapp");
    const injector = await web3FromAddress(address);
    return { type: "extension", injector };
  };

  const clearEvents = useCallback(() => {
    seenIds.current.clear();
    setEvents([]);
  }, []);

  const loggedIn = loggedInAddress
    ? accounts.find((a) => a.address === loggedInAddress) ?? { address: loggedInAddress, source: "extension" as const }
    : null;

  return (
    <FastLaneCtx.Provider value={{
      api, state, block, chain, accounts, selected, extensionConnected, extAddresses,
      loggedIn, login, logout,
      setSelected, connectWallet, getSigner, events, clearEvents,
    }}>
      {children}
    </FastLaneCtx.Provider>
  );
}

export function useFastLane() {
  const ctx = useContext(FastLaneCtx);
  if (!ctx) throw new Error("useFastLane must be used inside FastLaneProvider");
  return ctx;
}
