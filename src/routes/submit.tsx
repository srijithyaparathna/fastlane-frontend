import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, CopyButton } from "@/components/fastlane/Card";
import { randomHash } from "@/lib/fastlane";

export const Route = createFileRoute("/submit")({ component: SubmitPage });

function SubmitPage() {
  const { api, selected, accounts, getSigner } = useFastLane();
  const [nonce, setNonce] = useState("0");
  const [expiry, setExpiry] = useState("9999");
  const [domain, setDomain] = useState("1");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [payloadId, setPayloadId] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !selected) return;
    (async () => {
      try {
        const p = (api.query as any).fastlane;
        if (p?.nonces) {
          const n = await p.nonces(selected);
          setNonce(n?.toString?.() ?? "0");
        }
      } catch {}
    })();
  }, [api, selected]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || !selected) {
      toast.error("Connect wallet first");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      toast.error("Payload hash must be 32-byte hex (0x…)");
      return;
    }
    setBusy(true);
    setPayloadId(null);
    try {
      const signer = await getSigner(selected);
      const tx = (api.tx as any).fastlane.submit(Number(nonce), Number(expiry), Number(domain), hash);
      await new Promise<void>((resolve, reject) => {
        const cb = (r: any) => {
          if (r.status.isInBlock) {
            let pid: string | undefined;
            r.events.forEach(({ event }: any) => {
              if (event.section === "fastlane" && event.method === "Submitted") pid = event.data[0]?.toString();
              if (event.section === "system" && event.method === "ExtrinsicFailed") reject(new Error("Extrinsic failed"));
            });
            if (pid) setPayloadId(pid);
            toast.success(`Submitted in block ${r.status.asInBlock.toHex().slice(0, 10)}…`);
            resolve();
          }
        };
        const send = signer.type === "keypair"
          ? tx.signAndSend(signer.pair, cb)
          : tx.signAndSend(selected, { signer: signer.injector.signer }, cb);
        send.catch(reject);
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Submit Payload</h1>
        <p className="text-sm text-muted-foreground">Sign and broadcast a fastlane.submit() extrinsic.</p>
      </div>

      <Card title="Payload Details" subtitle={selected ? `Signing as ${selected.slice(0, 10)}…` : "Connect wallet to sign"}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Nonce (auto)"><Input value={nonce} readOnly /></Field>
            <Field label="Expiry"><Input value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
            <Field label="Domain"><Input value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
          </div>
          <Field label="Payload Hash" hint="Enter 32 bytes hex (0x…)">
            <div className="flex gap-2">
              <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" />
              <Button type="button" variant="ghost" onClick={() => setHash(randomHash())}>Generate Random</Button>
            </div>
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={busy} disabled={!selected || accounts.length === 0}>Submit Payload</Button>
          </div>
        </form>

        {payloadId && (
          <div className="mt-5 rounded-lg border border-success/40 bg-success/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-success">Payload Submitted</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="break-all font-mono text-sm text-foreground">{payloadId}</code>
              <CopyButton text={payloadId} label="Copy" />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
