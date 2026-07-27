import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, Address, Select } from "@/components/fastlane/Card";
import { Plug, PlugZap } from "lucide-react";
import { accountName } from "@/lib/fastlane";

// How many of the most-recent payloads to inspect when judging OCW liveness.
// An online worker attests essentially every new payload; an offline one
// attests none. A window smooths over the occasional miss when a payload
// finalises (at threshold) before a given worker's attestation lands.
const RECENT_WINDOW = 10;

type Liveness = { recent: number; window: number; everAttested: number };

export const Route = createFileRoute("/setup")({ component: SetupPage });

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

  // Auto-open Polkadot.js extension on mount
  useEffect(() => {
    if (!extensionConnected && !connectingExt) {
      handleConnectExtension();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [bonds, setBonds] = useState<Record<string, string>>({});
  const [liveness, setLiveness] = useState<Record<string, Liveness>>({});
  const [recentPayloads, setRecentPayloads] = useState<number>(0);
  const [threshold, setThreshold] = useState<string>("—");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [thrInput, setThrInput] = useState<string>("");
  const [busyA, setBusyA] = useState(false);
  const [busyT, setBusyT] = useState(false);

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
        // Derive offchain-worker liveness directly from chain storage — no
        // backend. There is no per-attestation event, so we measure, over the
        // most recent payloads, how many each authority attested. A live OCW
        // attests ~all of them; a dead one (registered authority but no node
        // running) attests none.
        //
        // Two sources are needed, because `prune_finalised_storage` DELETES the
        // Attestations map the moment a payload finalises. Reading Attestations
        // alone makes every authority look idle within seconds of a healthy
        // payload completing — the recent window is almost entirely finalised
        // payloads, all of which have had their per-signature records dropped.
        // AggregatedAttestations survives finalisation, so it is the source of
        // truth for anything already settled; Attestations still gives the
        // live in-flight signal before the aggregate is written.
        if (p?.attestations?.entries && p?.payloads?.entries) {
          const [attEntries, payEntries, aggEntries] = await Promise.all([
            p.attestations.entries(),
            p.payloads.entries(),
            p.aggregatedAttestations?.entries?.() ?? Promise.resolve([]),
          ]);
          if (!active) return;

          // attesters per payloadId
          const attByPayload = new Map<string, string[]>();
          const everAttested: Record<string, number> = {};
          for (const [key, records] of attEntries) {
            const pid = key.args[0].toString();
            const auths = (records as any[]).map((r) => r.authority.toString());
            attByPayload.set(pid, auths);
            for (const auth of auths) everAttested[auth] = (everAttested[auth] ?? 0) + 1;
          }

          // Recover signers of finalised payloads from the aggregate bitmap
          // (bit i set <=> list[i] signed). Only fills gaps — a live
          // Attestations record for the same payload always wins.
          for (const [key, val] of aggEntries as any[]) {
            const pid = key.args[0].toString();
            if (attByPayload.has(pid)) continue;
            const agg = val?.unwrapOr?.(null) ?? val;
            if (!agg?.signerBitmap) continue;
            const bitmap = BigInt(agg.signerBitmap.toString());
            const signers = list.filter((_, i) => (bitmap >> BigInt(i)) & 1n);
            attByPayload.set(pid, signers);
            for (const auth of signers) everAttested[auth] = (everAttested[auth] ?? 0) + 1;
          }

          // most-recent N payloads by createdAt
          const payloads = payEntries
            .map(([key, val]: [any, any]) => {
              const j = val.toJSON?.() ?? {};
              return { pid: key.args[0].toString(), createdAt: Number(j.createdAt ?? 0) };
            })
            .sort((a: any, b: any) => b.createdAt - a.createdAt);
          const window = payloads.slice(0, RECENT_WINDOW);

          const next: Record<string, Liveness> = {};
          for (const auth of Object.keys(everAttested)) {
            next[auth] = { recent: 0, window: window.length, everAttested: everAttested[auth] };
          }
          for (const { pid } of window) {
            for (const auth of attByPayload.get(pid) ?? []) {
              if (!next[auth]) next[auth] = { recent: 0, window: window.length, everAttested: everAttested[auth] ?? 0 };
              next[auth].recent += 1;
            }
          }
          if (active) {
            setLiveness(next);
            setRecentPayloads(window.length);
          }
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

  // Decode a DispatchError into a readable "pallet.ErrorName" (e.g.
  // fastlane.ThresholdTooLow) instead of a raw index blob.
  const decodeErr = (dispatchError: any): string => {
    try {
      if (dispatchError?.isModule) {
        const d = (api as any).registry.findMetaError(dispatchError.asModule);
        return `${d.section}.${d.name}`;
      }
    } catch { /* fall through */ }
    return dispatchError?.toString?.() ?? "dispatch error";
  };

  const sendTx = (tx: any, signer: Awaited<ReturnType<typeof getSigner>>) =>
    new Promise<void>((resolve, reject) => {
      const cb = (r: any) => {
        if (!r.status.isInBlock) return;
        for (const { event } of r.events) {
          // Direct extrinsic failure (e.g. BadOrigin when not signing as sudo).
          if ((api as any).events.system.ExtrinsicFailed.is(event)) {
            return reject(new Error(decodeErr(event.data[0])));
          }
          // sudo wrapper succeeds even when the inner call errors — the real
          // result lives in sudo.Sudid. Surface that inner error.
          const sudid = (api as any).events.sudo?.Sudid;
          if (sudid?.is(event)) {
            const result = event.data[0];
            if (result?.isErr) return reject(new Error(decodeErr(result.asErr)));
          }
        }
        resolve();
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

  // set_threshold requires: authorities/2 < value <= authorities  (strictly
  // more than half, never exceeding the authority count). Mirror that here so
  // the UI can validate before submitting and explain rejections.
  const authCount = authorities.length;
  const thrMin = authCount > 0 ? Math.floor(authCount / 2) + 1 : 1;
  const thrMax = authCount;
  const thrNum = Number(thrInput);
  const thrValid = thrInput !== "" && Number.isInteger(thrNum) && thrNum >= thrMin && thrNum <= thrMax;

  const setThr = async () => {
    if (!api || !selected || !thrInput) return;
    if (!thrValid) {
      toast.error(`Threshold must be ${thrMin}–${thrMax} for ${authCount} authorities (strictly more than half).`);
      return;
    }
    setBusyT(true);
    try {
      const signer = await getSigner(selected);
      const tx = (api.tx as any).sudo.sudo((api.tx as any).fastlane.setThreshold(Number(thrInput)));
      await sendTx(tx, signer);
      toast.success(`Threshold set to ${thrInput}`);
    } catch (e: any) {
      const msg: string = e?.message ?? "Failed";
      toast.error(
        msg.includes("ThresholdTooLow") ? `Too low — must be more than half the authorities (min ${thrMin}).`
        : msg.includes("ThresholdTooHigh") ? `Too high — cannot exceed the authority count (max ${thrMax}).`
        : msg.includes("BadOrigin") ? "Rejected — you must sign as the sudo key (Alice)."
        : msg
      );
    } finally { setBusyT(false); }
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
          >
            {extensionConnected ? (
              <>
                <PlugZap className="h-3.5 w-3.5" />
                Reconnect Extension
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

      {/* Current state */}
      <Card
        title="Current Authorities"
        subtitle={`Threshold: ${threshold} • Authorities: ${authorities.length} • OCWs online: ${authorities.filter((a) => (liveness[a]?.recent ?? 0) > 0).length}/${authorities.length}`}
      >
        <p className="mb-2 text-[11px] text-muted-foreground">
          Offchain-worker liveness derived from chain: share of the last {recentPayloads || RECENT_WINDOW} payloads each authority attested.
        </p>
        <div className="space-y-1.5">
          {authorities.length === 0 && <p className="text-sm text-muted-foreground">No authorities set yet.</p>}
          {authorities.map((a, i) => {
            const lv = liveness[a];
            const recent = lv?.recent ?? 0;
            const win = lv?.window ?? recentPayloads;
            // Chain-derived OCW state: green if it attested any recent payload,
            // amber if it has attested historically but nothing recent (node
            // likely stopped), red if it has never attested (no node running).
            let ocw: { cls: string; label: string; title: string };
            if (recent > 0) {
              ocw = { cls: "border-success/40 bg-success/15 text-success", label: `● online · ${recent}/${win}`, title: `Attested ${recent} of the last ${win} payloads` };
            } else if ((lv?.everAttested ?? 0) > 0) {
              ocw = { cls: "border-warning/40 bg-warning/15 text-warning", label: "◐ idle", title: `Has attested before (${lv?.everAttested}) but none of the last ${win} — node may be down` };
            } else {
              ocw = { cls: "border-destructive/40 bg-destructive/15 text-destructive", label: "○ offline", title: "Never attested — no offchain worker running for this authority" };
            }
            const name = accountName(a);
            return (
              <div key={a} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">#{i}</span>
                  {name && <span className="min-w-[52px] text-sm font-semibold">{name}</span>}
                  <Address value={a} />
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ocw.cls}`}
                    title={ocw.title}
                  >
                    {ocw.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground" title="Total payloads this authority has ever attested">
                    {(lv?.everAttested ?? 0) > 0 ? `attested ${lv?.everAttested}` : "—"}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">bond: {bonds[a] ?? "—"}</span>
                </div>
              </div>
            );
          })}
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
          <Field
            label="Threshold value"
            hint={`Signatures needed to reach PreConsensed. Valid: ${thrMin}–${thrMax} for ${authCount} authorities (must be more than half).`}
          >
            <Input
              type="number"
              min={thrMin}
              max={thrMax}
              value={thrInput}
              onChange={(e) => setThrInput(e.target.value)}
              placeholder={`e.g. ${thrMin}`}
            />
          </Field>
          {thrInput !== "" && !thrValid && (
            <p className="mt-1.5 text-[11px] text-destructive">
              Must be between {thrMin} and {thrMax} (strictly more than half of {authCount} authorities).
            </p>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Current: {threshold}</span>
            <Button onClick={setThr} loading={busyT} disabled={!thrValid || !selected}>
              Set Threshold
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
