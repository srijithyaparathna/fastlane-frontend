import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, Address, Select } from "@/components/fastlane/Card";
import { CheckCircle, Circle, KeyRound } from "lucide-react";

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
  const { api, accounts, selected, setSelected, getSigner } = useFastLane();
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

  const insertKeys = async () => {
    if (!api) return;
    setBusyKeys(true);
    setKeyStatus({});
    for (const k of DEV_KEYS) {
      try {
        await (api.rpc as any).author.insertKey("fast", k.suri, k.pub);
        setKeyStatus((s) => ({ ...s, [k.name]: "ok" }));
      } catch {
        setKeyStatus((s) => ({ ...s, [k.name]: "err" }));
      }
    }
    setBusyKeys(false);
    toast.success("All dev keys inserted into node keystore");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="text-sm text-muted-foreground">Authorities, threshold, and bonds for the FastLane pallet.</p>
      </div>

      {/* Signing account */}
      <Card title="Signing Account" subtitle="Must be the sudo key (Alice) for set_authorities and set_threshold">
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
      </Card>

      {/* Insert node keys */}
      <Card
        title="Insert Node Keys"
        subtitle="author_insertKey — loads dev keys into the node keystore for the OCW to sign"
        action={
          <Button onClick={insertKeys} loading={busyKeys} disabled={!api}>
            <KeyRound className="h-3.5 w-3.5" /> Insert All Keys
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DEV_KEYS.map((k) => {
            const st = keyStatus[k.name];
            return (
              <div key={k.name} className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
                {st === "ok"
                  ? <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success" />
                  : st === "err"
                  ? <Circle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  : <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="font-medium">{k.name}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">{k.suri}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          This replaces the curl commands. Keys are stored in the node's local keystore and used by the off-chain worker to auto-sign attestations.
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
