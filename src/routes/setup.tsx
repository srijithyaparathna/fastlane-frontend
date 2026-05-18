import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, Address, Select } from "@/components/fastlane/Card";
import { CheckCircle, Circle, KeyRound, AlertTriangle, Plug, PlugZap } from "lucide-react";

export const Route = createFileRoute("/setup")({ component: SetupPage });

const DEV_KEYS = [
  { name: "Alice",   suri: "//Alice",   pub: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d" },
  { name: "Bob",     suri: "//Bob",     pub: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48" },
  { name: "Charlie", suri: "//Charlie", pub: "0x90b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe22" },
  { name: "Dave",    suri: "//Dave",    pub: "0x306721211d5404bd9da88e0204360a1a9ab8b87c484ad1d7a5e9d50c56e1cf4b" },
  { name: "Eve",     suri: "//Eve",     pub: "0xe659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4e" },
  { name: "Ferdie",  suri: "//Ferdie",  pub: "0x1cbd2d43530a44705ad088af313e18f80b53ef16b36177cd4b77b846f2a5f07c" },
];

function SetupPage() {
  const { api, accounts, selected, setSelected, getSigner, connectWallet, extensionConnected } = useFastLane();
  const [connectingExt, setConnectingExt] = useState(false);

  const handleConnectExtension = async () => {
    if (connectingExt) return;
    setConnectingExt(true);
    try {
      await connectWallet();
    } finally {
      setConnectingExt(false);
    }
  };
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [bonds, setBonds] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState<string>("—");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [thrInput, setThrInput] = useState<string>("");
  const [busyA, setBusyA] = useState(false);
  const [busyT, setBusyT] = useState(false);
  const [busyKeys, setBusyKeys] = useState(false);
  const [keyStatus, setKeyStatus] = useState<Record<string, "idle" | "ok" | "err">>({});

  useEffect(() => {
    if (!api) return;
    let active = true;
    const load = async () => {
      try {
        const p = (api.query as any).fastlane;
        const [a, t] = await Promise.all([
          p?.authorities ? p.authorities() : Promise.resolve([]),
          p?.threshold ? p.threshold() : Promise.resolve(null),
        ]);
        if (!active) return;
        const list = ((a?.toJSON?.() ?? []) as any[]).map(String);
        setAuthorities(list);
        setThreshold(t?.toString?.() ?? "—");
        if (p?.authorityBonds) {
          const entries = await Promise.all(list.map(async (addr) => {
            const b = await p.authorityBonds(addr);
            return [addr, b?.toString?.() ?? "0"] as const;
          }));
          setBonds(Object.fromEntries(entries));
        }
      } catch (e) { console.error(e); }
    };
    load();
    const id = setInterval(load, 6000);
    return () => { active = false; clearInterval(id); };
  }, [api]);

  const togglePick = (addr: string) => {
    setPicked((s) => {
      const next = new Set(s);
      next.has(addr) ? next.delete(addr) : next.add(addr);
      return next;
    });
  };

  const sendTx = (tx: any, signer: Awaited<ReturnType<typeof getSigner>>) =>
    new Promise<void>((resolve, reject) => {
      const cb = (r: any) => {
        if (!r.status.isInBlock) return;
        const failed = r.events.find(({ event }: any) =>
          event.section === "system" && event.method === "ExtrinsicFailed"
        );
        if (failed) {
          reject(new Error("Transaction failed on-chain (BadOrigin or module error)"));
        } else {
          resolve();
        }
      };
      const send = signer.type === "keypair"
        ? tx.signAndSend(signer.pair, cb)
        : tx.signAndSend(selected, { signer: signer.injector.signer }, cb);
      send.catch(reject);
    });

  const setAuth = async () => {
    if (!api || !selected || picked.size === 0) return;
    setBusyA(true);
    try {
      const signer = await getSigner(selected);
      const inner = (api.tx as any).fastlane.setAuthorities(Array.from(picked));
      const tx = (api.tx as any).sudo.sudo(inner);
      await sendTx(tx, signer);
      toast.success(`Authorities updated (${picked.size} account${picked.size === 1 ? "" : "s"})`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed — make sure you are signing as the sudo key (Alice)");
    } finally { setBusyA(false); }
  };

  const setThr = async () => {
    if (!api || !selected || !thrInput) return;
    setBusyT(true);
    try {
      const signer = await getSigner(selected);
      const tx = (api.tx as any).sudo.sudo((api.tx as any).fastlane.setThreshold(Number(thrInput)));
      await sendTx(tx, signer);
      toast.success(`Threshold set to ${thrInput}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed — make sure you are signing as the sudo key (Alice)");
    } finally { setBusyT(false); }
  };

  // Keys to insert = all DEV_KEYS that have a matching extension account address,
  // OR all DEV_KEYS if no extension accounts are connected yet.
  const keysToInsert = (() => {
    const extAddresses = new Set(accounts.map((a) => a.address));
    const matched = DEV_KEYS.filter((k) => {
      const acc = accounts.find((a) => a.name === k.name);
      return acc && extAddresses.has(acc.address);
    });
    // If extension is connected and matched at least one, only insert matched ones
    // Otherwise insert all (fallback for dev-only mode)
    return matched.length > 0 ? matched : DEV_KEYS;
  })();

  const insertKeys = async (keys = keysToInsert) => {
    if (!api) return;
    setBusyKeys(true);
    setKeyStatus({});
    let ok = 0;
    for (const k of keys) {
      try {
        await (api.rpc as any).author.insertKey("fast", k.suri, k.pub);
        setKeyStatus((s) => ({ ...s, [k.name]: "ok" }));
        ok++;
      } catch {
        setKeyStatus((s) => ({ ...s, [k.name]: "err" }));
      }
    }
    setBusyKeys(false);
    toast.success(`${ok} key${ok === 1 ? "" : "s"} inserted into node keystore`);
  };

  const insertSingle = async (k: typeof DEV_KEYS[number]) => {
    if (!api) return;
    setKeyStatus((s) => ({ ...s, [k.name]: "idle" }));
    try {
      await (api.rpc as any).author.insertKey("fast", k.suri, k.pub);
      setKeyStatus((s) => ({ ...s, [k.name]: "ok" }));
      toast.success(`${k.name} key inserted`);
    } catch (e: any) {
      setKeyStatus((s) => ({ ...s, [k.name]: "err" }));
      toast.error(e?.message ?? `Failed to insert ${k.name}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="text-sm text-muted-foreground">Authorities, threshold, and bonds for the FastLane pallet.</p>
      </div>

      {/* Signing account */}
      <Card
        title="Signing Account"
        subtitle="Must be the sudo key (Alice) for set_authorities and set_threshold"
        action={
          <Button
            onClick={handleConnectExtension}
            loading={connectingExt}
            disabled={extensionConnected && !connectingExt}
          >
            {extensionConnected ? (
              <>
                <PlugZap className="h-3.5 w-3.5" />
                Extension Connected
              </>
            ) : (
              <>
                <Plug className="h-3.5 w-3.5" />
                Connect Polkadot.js Extension
              </>
            )}
          </Button>
        }
      >
        <Field label="Account">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name ?? "Account"} — {a.address.slice(0, 16)}…
              </option>
            ))}
          </Select>
        </Field>
        {selected && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all">{selected}</p>
        )}
        {!extensionConnected && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Click <strong>Connect Polkadot.js Extension</strong> to authorize this site and load your browser-wallet accounts. Dev accounts (Alice, Bob, …) are always available.
          </p>
        )}
      </Card>

      {/* Insert node keys */}
      <Card
        title="Insert Node Keys"
        subtitle="author_insertKey — inserts dev keys into the node keystore so the OCW can auto-sign attestations"
        action={
          <Button onClick={() => insertKeys()} loading={busyKeys} disabled={!api}>
            <KeyRound className="h-3.5 w-3.5" />
            {keysToInsert.length < DEV_KEYS.length
              ? `Insert ${keysToInsert.length} Extension Key${keysToInsert.length === 1 ? "" : "s"}`
              : "Insert All Keys"}
          </Button>
        }
      >
        {/* Explanation banner */}
        <div className="mb-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info">
          <strong>How it works:</strong> The Polkadot.js extension is for <em>signing transactions</em> from the browser.
          The node keystore is separate — it holds keys the <em>off-chain worker (OCW)</em> uses to auto-sign attestations on-chain.
          Both must have the same accounts for the full flow to work.
        </div>

        <div className="space-y-1.5">
          {DEV_KEYS.map((k) => {
            const st = keyStatus[k.name];
            const match = accounts.find((a) => a.name === k.name);
            // Check if extension also has this account (same address)
            const inExtension = match && accounts.some(
              (a) => a.address === match.address && a.name === k.name
            );
            return (
              <div
                key={k.name}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  st === "ok"
                    ? "border-success/40 bg-success/10"
                    : st === "err"
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-border bg-background/40"
                }`}
              >
                {st === "ok"
                  ? <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                  : st === "err"
                  ? <Circle className="h-4 w-4 shrink-0 text-destructive" />
                  : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}

                <div className="w-20 shrink-0">
                  <div className="font-semibold">{k.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{k.suri}</div>
                </div>

                {match && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] text-muted-foreground">Address</span>
                      {inExtension && (
                        <span className="rounded-full bg-success/15 px-1.5 text-[9px] font-semibold text-success">
                          ✓ in extension
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] truncate text-foreground/70">{match.address}</div>
                  </div>
                )}

                {st === "ok" ? (
                  <span className="shrink-0 rounded-full border border-success/40 px-2 py-0.5 text-[10px] font-semibold text-success">
                    Inserted ✓
                  </span>
                ) : st === "err" ? (
                  <button
                    onClick={() => insertSingle(k)}
                    className="shrink-0 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] font-semibold text-destructive hover:bg-destructive/10"
                  >
                    Retry ↺
                  </button>
                ) : (
                  <button
                    onClick={() => insertSingle(k)}
                    className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    Insert
                  </button>
                )}
              </div>
            );
          })}

          {/* Extension accounts that DON'T match any standard dev key */}
          {(() => {
            const devAddresses = new Set(
              DEV_KEYS.map((k) => accounts.find((a) => a.name === k.name)?.address).filter(Boolean)
            );
            const mismatchedExtAccounts = accounts.filter(
              (a) => !devAddresses.has(a.address) && a.name
            );
            if (mismatchedExtAccounts.length === 0) return null;
            return (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-warning">
                  Extension accounts with non-standard addresses — cannot be auto-inserted:
                </p>
                {mismatchedExtAccounts.map((a) => (
                  <div key={a.address} className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                    <div className="w-20 shrink-0">
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-[10px] text-warning/70">not a dev account</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted-foreground mb-0.5">Address (does not match standard seed)</div>
                      <div className="font-mono text-[10px] truncate text-foreground/70">{a.address}</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold text-warning">
                      Cannot Insert
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  These accounts were imported with a different seed. Re-import using the raw seeds from the table above, or only use Alice + Bob as authorities.
                </p>
              </div>
            );
          })()}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Requires node started with <code className="rounded bg-background/60 px-1">--rpc-methods=Unsafe</code>.
          Equivalent to the <code className="rounded bg-background/60 px-1">curl author_insertKey</code> commands.
        </p>
      </Card>

      {/* Current state */}
      <Card title="Current Authorities" subtitle={`Threshold: ${threshold} • Authorities: ${authorities.length}`}>
        <div className="space-y-1.5">
          {authorities.length === 0 && <p className="text-sm text-muted-foreground">No authorities set yet.</p>}
          {authorities.map((a, i) => (
            <div key={a} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">#{i}</span>
                <Address value={a} />
              </div>
              <span className="font-mono text-xs text-muted-foreground">bond: {bonds[a] ?? "—"}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Set Authorities */}
        <Card title="Set Authorities" subtitle="sudo → fastlane.setAuthorities(newAuthorities)">
          <p className="mb-2 text-xs text-muted-foreground">
            Check all accounts to include as authorities. This <strong>replaces</strong> the entire list.
          </p>
          <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border bg-background/40 p-2">
            {accounts.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No accounts loaded.</p>
            )}
            {accounts.map((a) => (
              <label key={a.address} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
                <input type="checkbox" checked={picked.has(a.address)} onChange={() => togglePick(a.address)} />
                <span className="font-medium">{a.name ?? "Account"}</span>
                <Address value={a.address} copyable={false} />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{picked.size} selected</span>
            <Button onClick={setAuth} loading={busyA} disabled={picked.size === 0 || !selected}>
              Set Authorities
            </Button>
          </div>
        </Card>

        {/* Set Threshold */}
        <Card title="Set Threshold" subtitle="sudo → fastlane.setThreshold(value)">
          <Field label="Threshold value" hint="How many signatures are needed to reach PreConsensed">
            <Input
              type="number"
              min={1}
              value={thrInput}
              onChange={(e) => setThrInput(e.target.value)}
              placeholder="e.g. 2"
            />
          </Field>
          <div className="mt-3 flex justify-end">
            <Button onClick={setThr} loading={busyT} disabled={!thrInput || !selected}>
              Set Threshold
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
