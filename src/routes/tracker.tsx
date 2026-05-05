import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, Address } from "@/components/fastlane/Card";
import { statusInfo, truncate } from "@/lib/fastlane";

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
      const arr = (attsR?.toJSON?.() ?? []) as any[];
      setAtts(Array.isArray(arr) ? arr.map(String) : []);
      setStatusStr(statusR?.toString?.() ?? (obj?.status ? String(obj.status) : "Submitted"));
      setThreshold(Number(thR?.toString?.() ?? 0));
      setRecent((r) => [target, ...r.filter((x) => x !== target)].slice(0, 5));
    } catch (e: any) {
      toast.error(e?.message ?? "Lookup failed");
    } finally { setBusy(false); }
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
  const progressPct = threshold ? Math.min(100, (atts.length / threshold) * 100) : 0;

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
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${s.classes}`}>
              <span>{s.emoji}</span> {s.label}
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
            {isPre && (
              <div className="mt-4 flex justify-end">
                <Button variant="success" onClick={finalize} loading={finalizing} disabled={!selected}>Finalize Payload</Button>
              </div>
            )}
          </Card>

          <Card title="Attestations" subtitle={`${atts.length} / ${threshold || "?"} signatures`}>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-background/60">
              <div className="h-full bg-success transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="max-h-60 space-y-1 overflow-auto rounded-md border border-border bg-background/40 p-2">
              {atts.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Waiting for signatures…</p>}
              {atts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
                  <span className="text-muted-foreground">#{i}</span>
                  <Address value={a} />
                </div>
              ))}
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
