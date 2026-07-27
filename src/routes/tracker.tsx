import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, Address } from "@/components/fastlane/Card";
import {
  statusInfo, truncate, accountName,
  fetchAggregate, fetchInclusions, aggregateSigners, inclusionMsgHash,
  type Aggregate, type InclusionCommitment,
} from "@/lib/fastlane";
import { u8aToHex } from "@polkadot/util";

export const Route = createFileRoute("/tracker")({ component: TrackerPage });

function TrackerPage() {
  const { api, selected, getSigner } = useFastLane();
  const [pid, setPid] = useState("");
  const [data, setData] = useState<any>(null);
  const [atts, setAtts] = useState<string[]>([]);
  const [threshold, setThreshold] = useState<number>(0);
  const [statusStr, setStatusStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [finalizing, setFinalizing] = useState(false);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [aggSigners, setAggSigners] = useState<string[]>([]);
  const [inclusions, setInclusions] = useState<InclusionCommitment[]>([]);
  const [deadline, setDeadline] = useState("");
  const [committing, setCommitting] = useState(false);

  const lookup = async (id?: string) => {
    const target = (id ?? pid).trim();
    if (!api || !target) return;
    setPid(target);
    setBusy(true);
    try {
      const p = (api.query as any).fastlane;
      const [info, attsR, statusR, thR] = await Promise.all([
        p?.payloads ? p.payloads(target) : Promise.resolve(null),
        p?.attestations ? p.attestations(target) : Promise.resolve(null),
        p?.statuses ? p.statuses(target) : (p?.payloadStatus ? p.payloadStatus(target) : Promise.resolve(null)),
        p?.threshold ? p.threshold() : Promise.resolve(null),
      ]);
      const obj = info?.toJSON?.() ?? null;
      setData(obj);
      // Attestations is a Vec<SignatureRecord{authority,signature,checksHash}> —
      // pull out each attester's address (records may also be bare strings).
      const arr = (attsR?.toJSON?.() ?? []) as any[];
      setAtts(Array.isArray(arr) ? arr.map((r) => (typeof r === "string" ? r : String(r?.authority ?? ""))).filter(Boolean) : []);
      setStatusStr(statusR?.toString?.() ?? (obj?.status ? String(obj.status) : "Submitted"));
      setThreshold(Number(thR?.toString?.() ?? 0));
      setRecent((r) => [target, ...r.filter((x) => x !== target)].slice(0, 5));

      // §14: compact aggregate (survives finalisation) + inclusion commitments.
      const [agg, incs] = await Promise.all([
        fetchAggregate(api, target),
        fetchInclusions(api, target),
      ]);
      setAggregate(agg);
      setAggSigners(agg ? await aggregateSigners(api, agg) : []);
      setInclusions(incs);
    } catch (e: any) {
      toast.error(e?.message ?? "Lookup failed");
    } finally { setBusy(false); }
  };

  // Post a signed inclusion commitment. Only dev keypairs (the authorities) can
  // produce the raw sr25519 signature the pallet verifies; extension accounts
  // wrap the payload and would fail on-chain verification.
  const commitInclusion = async () => {
    if (!api || !selected || !pid) return;
    const dl = Number(deadline);
    if (!Number.isFinite(dl) || dl <= 0) { toast.error("Enter a deadline block number"); return; }
    setCommitting(true);
    try {
      const signer = await getSigner(selected);
      if (signer.type !== "keypair") {
        toast.error("Inclusion commitments must be signed by an authority's dev key");
        return;
      }
      const sig = signer.pair.sign(inclusionMsgHash(api, pid, dl));
      const tx = (api.tx as any).fastlane.commitInclusion(pid, dl, u8aToHex(sig));
      await tx.signAndSend(signer.pair, (r: any) => {
        if (r.dispatchError) {
          let msg = r.dispatchError.toString();
          if (r.dispatchError.isModule) {
            const d = api.registry.findMetaError(r.dispatchError.asModule);
            msg = `${d.section}.${d.name}`;
          }
          toast.error(msg);
        } else if (r.status.isInBlock) {
          toast.success("Inclusion commitment submitted");
          lookup(pid);
        }
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setCommitting(false); }
  };

  const finalize = async () => {
    if (!api || !selected || !pid) return;
    setFinalizing(true);
    try {
      const signer = await getSigner(selected);
      const tx = (api.tx as any).fastlane.finalize(pid);
      const cb = (r: any) => {
        if (r.status.isInBlock) {
          toast.success("Finalize submitted in block");
          lookup(pid);
        }
      };
      const send = signer.type === "keypair"
        ? tx.signAndSend(signer.pair, cb)
        : tx.signAndSend(selected, { signer: signer.injector.signer }, cb);
      await send;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setFinalizing(false); }
  };

  const s = statusInfo(statusStr);
  const isPre = s.label === "PreConsensed";
  // Finalisation prunes the per-signature Attestations map (pallet §14 storage
  // reduction), so fall back to the signers recovered from the aggregate bitmap
  // — otherwise a finalised payload reads as "0 / N, waiting for signatures".
  const shown = atts.length > 0 ? atts : aggSigners;
  const progressPct = threshold ? Math.min(100, (shown.length / threshold) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payload Tracker</h1>
        <p className="text-sm text-muted-foreground">Inspect a payload, follow its attestations, and finalize when ready.</p>
      </div>

      <Card title="Lookup" subtitle="Search by payload id">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="Payload ID"><Input value={pid} onChange={(e) => setPid(e.target.value)} placeholder="0x…" /></Field>
          </div>
          <div className="flex items-end">
            <Button onClick={() => lookup()} loading={busy} disabled={!pid}>Track Payload</Button>
          </div>
        </div>
        {recent.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Recent:</span>
            {recent.map((r) => (
              <button key={r} onClick={() => lookup(r)} className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-accent">
                {truncate(r, 8, 6)}
              </button>
            ))}
          </div>
        )}
      </Card>

      {data && (
        <>
          <Card title="Payload Details" action={
            <span title={s.hint} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${s.classes}`}>
              <span>{s.emoji}</span> {s.display}
            </span>
          }>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Detail label="Payload ID"><Address value={pid} /></Detail>
              <Detail label="Creator">{data.creator ? <Address value={String(data.creator)} /> : "—"}</Detail>
              <Detail label="Created At" mono>{data.createdAt ?? data.created_at ?? "—"}</Detail>
              <Detail label="Expiry" mono>{data.expiry ?? "—"}</Detail>
              <Detail label="Domain" mono>{data.domain ?? "—"}</Detail>
              <Detail label="Payload Hash" mono><span className="break-all">{data.hash ?? data.payloadHash ?? "—"}</span></Detail>
            </div>
            {/* Spec §12: the reversibility caveat has to be visible on the payload
                itself, not only in the docs. */}
            <p className="mt-3 text-xs text-muted-foreground">{s.hint}</p>
            {isPre && (
              <div className="mt-4 flex justify-end">
                <Button variant="success" onClick={finalize} loading={finalizing} disabled={!selected}>Finalize Payload</Button>
              </div>
            )}
          </Card>

          <Card title="Attestations" subtitle={`${shown.length} / ${threshold || "?"} signatures`}>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-background/60">
              <div className="h-full bg-success transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="max-h-60 space-y-1 overflow-auto rounded-md border border-border bg-background/40 p-2">
              {shown.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Waiting for signatures…</p>}
              {shown.map((a, i) => {
                const name = accountName(a);
                return (
                  <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
                    <span className="text-muted-foreground">#{i}</span>
                    {name && <span className="min-w-[52px] font-semibold">{name}</span>}
                    <Address value={a} />
                  </div>
                );
              })}
            </div>
          </Card>

          {aggregate && (
            <Card title="Signature Aggregate" subtitle={`${aggregate.count} signatures collapsed for storage (§14)`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Detail label="Signatures" mono>{aggregate.count}</Detail>
                <Detail label="Signer Bitmap" mono>{aggregate.signerBitmap}</Detail>
                <Detail label="Digest"><span className="break-all font-mono text-xs">{aggregate.digest}</span></Detail>
              </div>
              {aggSigners.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {aggSigners.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
                      {accountName(a) && <span className="font-semibold">{accountName(a)}</span>}
                      <span className="font-mono text-muted-foreground">{truncate(a, 6, 4)}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card title="Inclusion Commitments" subtitle="Authorities' signed promises to finalise by a deadline block">
            {isPre && (
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="Deadline (block number)">
                    <Input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="e.g. 500" />
                  </Field>
                </div>
                <Button onClick={commitInclusion} loading={committing} disabled={!selected || !deadline}>
                  Commit Inclusion
                </Button>
              </div>
            )}
            <div className="max-h-60 space-y-1 overflow-auto rounded-md border border-border bg-background/40 p-2">
              {inclusions.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No inclusion commitments yet.</p>}
              {inclusions.map((c, i) => {
                const name = accountName(c.authority);
                return (
                  <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
                    <span className="text-muted-foreground">#{i}</span>
                    {name && <span className="min-w-[52px] font-semibold">{name}</span>}
                    <Address value={c.authority} />
                    <span className="ml-auto font-mono text-muted-foreground">by #{c.deadline}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Detail({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}
