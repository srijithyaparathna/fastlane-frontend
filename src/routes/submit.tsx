import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, CopyButton, Address } from "@/components/fastlane/Card";
import { randomHash } from "@/lib/fastlane";
import { LogIn, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/submit")({ component: SubmitPage });

function SubmitPage() {
  const { api, loggedIn, getSigner } = useFastLane();
  const [nonce, setNonce] = useState("0");
  const [expiry, setExpiry] = useState("9999");
  const [domain, setDomain] = useState("1");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [payloadId, setPayloadId] = useState<string | null>(null);

  const signerAddress = loggedIn?.address ?? "";

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
    if (!loggedIn) {
      toast.error("Log in with the Polkadot.js extension first");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      toast.error("Payload hash must be 32-byte hex (0x…)");
      return;
    }
    setBusy(true);
    setPayloadId(null);
    try {
      const signer = await getSigner(loggedIn.address);
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
        tx.signAndSend(loggedIn.address, { signer: signer.injector.signer }, cb).catch(reject);
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!loggedIn) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Submit Payload</h1>
          <p className="text-sm text-muted-foreground">Sign and broadcast a fastlane.submit() extrinsic.</p>
        </div>
        <Card title="Login required" subtitle="You must log in with a Polkadot.js extension account to submit payloads">
          <p className="mb-4 text-sm text-muted-foreground">
            Submitting a payload signs an extrinsic on-chain, so this app requires you to log in with an
            account from your Polkadot.js browser extension first. You'll be asked for your extension
            password at the moment of signing.
          </p>
          <Link to="/login">
            <Button>
              <LogIn className="h-3.5 w-3.5" />
              Go to Login
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Submit Payload</h1>
        <p className="text-sm text-muted-foreground">Sign and broadcast a fastlane.submit() extrinsic.</p>
      </div>

      <Card title="Signed in as" subtitle="Switch accounts from the Login page">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-success" />
            <div>
              <div className="text-sm font-semibold">{loggedIn.name ?? "Account"}</div>
              <Address value={loggedIn.address} />
            </div>
          </div>
          <Link to="/login" className="text-xs font-medium text-primary hover:underline">
            Switch account
          </Link>
        </div>
      </Card>

      <Card title="Payload Details" subtitle={`Signing as ${loggedIn.address.slice(0, 10)}…`}>
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
            <Button type="submit" loading={busy}>Submit Payload</Button>
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
