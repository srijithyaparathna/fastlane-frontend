import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, CopyButton, Select } from "@/components/fastlane/Card";
import { randomHash } from "@/lib/fastlane";
import { Plug, PlugZap } from "lucide-react";

export const Route = createFileRoute("/submit")({ component: SubmitPage });

function SubmitPage() {
  const { api, accounts, getSigner, connectWallet, extensionConnected, extAddresses } = useFastLane();
  const extAccounts = useMemo(
    () => accounts.filter((a) => extAddresses.has(a.address)),
    [accounts, extAddresses],
  );
  const [signerAddress, setSignerAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [nonce, setNonce] = useState("0");
  const [expiry, setExpiry] = useState("9999");
  const [domain, setDomain] = useState("1");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [payloadId, setPayloadId] = useState<string | null>(null);

  // Keep the selected signer pointed at a valid extension account
  useEffect(() => {
    if (extAccounts.length === 0) {
      setSignerAddress("");
      return;
    }
    if (!extAccounts.some((a) => a.address === signerAddress)) {
      setSignerAddress(extAccounts[0].address);
    }
  }, [extAccounts, signerAddress]);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await connectWallet();
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!api || !signerAddress) return;
    (async () => {
      try {
        const p = (api.query as any).fastlane;
        if (p?.nonces) {
          const n = await p.nonces(signerAddress);
          setNonce(n?.toString?.() ?? "0");
        }
      } catch {}
    })();
  }, [api, signerAddress]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api) {
      toast.error("Still connecting to the chain — try again in a moment");
      return;
    }
    if (!extensionConnected || !signerAddress) {
      toast.error("Connect the Polkadot.js extension and select an account to sign with");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      toast.error("Payload hash must be 32-byte hex (0x…)");
      return;
    }
    setBusy(true);
    setPayloadId(null);
    try {
      const signer = await getSigner(signerAddress);
      // Payloads must always be signed through the Polkadot.js extension (password-protected),
      // never with an in-app dev keypair.
      if (signer.type !== "extension") {
        throw new Error("Payloads must be signed with a Polkadot.js extension account");
      }
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
        tx.signAndSend(signerAddress, { signer: signer.injector.signer }, cb).catch(reject);
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = extensionConnected && !!signerAddress;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Submit Payload</h1>
        <p className="text-sm text-muted-foreground">Sign and broadcast a fastlane.submit() extrinsic.</p>
      </div>

      {/* Signing account — extension only */}
      <Card
        title="Signing Account"
        subtitle="Payloads must be signed through the Polkadot.js extension"
        action={
          <Button onClick={handleConnect} loading={connecting}>
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
        {extAccounts.length > 0 ? (
          <Field label="Extension account">
            <Select value={signerAddress} onChange={(e) => setSignerAddress(e.target.value)}>
              {extAccounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name ?? "Account"} — {a.address.slice(0, 16)}…
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">
            No extension accounts available. Click <strong>Connect Polkadot.js Extension</strong> and
            authorize this site. You will be prompted for your extension password when signing.
          </p>
        )}
        {signerAddress && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all">{signerAddress}</p>
        )}
      </Card>

      <Card title="Payload Details" subtitle={signerAddress ? `Signing as ${signerAddress.slice(0, 10)}…` : "Connect the extension to sign"}>
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
            <Button type="submit" loading={busy} disabled={!canSubmit}>Submit Payload</Button>
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
