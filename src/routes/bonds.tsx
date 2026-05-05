import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Field, Input, Button, Select, Address } from "@/components/fastlane/Card";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/bonds")({ component: BondsPage });

function BondsPage() {
  const { api, accounts, selected, setSelected, getSigner } = useFastLane();
  const [amount, setAmount] = useState("100000000");
  const [busy, setBusy] = useState(false);
  const [bonds, setBonds] = useState<{ name?: string; address: string; bond: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!api || accounts.length === 0) return;
    setLoading(true);
    try {
      const p = (api.query as any).fastlane;
      if (!p?.authorityBonds) {
        setBonds(accounts.map((a) => ({ ...a, bond: "—" })));
        return;
      }
      const rows = await Promise.all(accounts.map(async (a) => {
        const b = await p.authorityBonds(a.address);
        return { name: a.name, address: a.address, bond: b?.toString?.() ?? "0" };
      }));
      setBonds(rows);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load bonds");
    } finally { setLoading(false); }
  }, [api, accounts]);

  useEffect(() => { refresh(); }, [refresh]);

  const post = async () => {
    if (!api || !selected) {
      toast.error("Connect wallet first");
      return;
    }
    setBusy(true);
    try {
      const signer = await getSigner(selected);
      const tx = (api.tx as any).fastlane.postBond(amount);
      const cb = (r: any) => {
        if (r.status.isInBlock) {
          toast.success(`Bond posted • tx ${r.txHash.toHex().slice(0, 10)}…`);
          refresh();
        }
      };
      await (signer.type === "keypair"
        ? tx.signAndSend(signer.pair, cb)
        : tx.signAndSend(selected, { signer: signer.injector.signer }, cb));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  };

  const tokenLabel = `${(Number(amount) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 })} Token`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bond Manager</h1>
        <p className="text-sm text-muted-foreground">Post bonds and inspect each authority's stake.</p>
      </div>

      <Card title="Post Bond" subtitle="fastlane.postBond(amount)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {accounts.length === 0 && <option value="">— Connect wallet —</option>}
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>{a.name ?? "Account"} — {a.address.slice(0, 10)}…</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" hint={tokenLabel}>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={post} loading={busy} disabled={!selected}>Post Bond</Button>
        </div>
      </Card>

      <Card
        title="Bond Status"
        action={<Button variant="ghost" onClick={refresh} loading={loading}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Bond</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {bonds.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">No accounts loaded.</td></tr>
              )}
              {bonds.map((b) => {
                const has = b.bond !== "0" && b.bond !== "—";
                return (
                  <tr key={b.address} className="border-b border-border/60">
                    <td className="px-3 py-2 text-xs">{b.name ?? "—"}</td>
                    <td className="px-3 py-2"><Address value={b.address} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{b.bond}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${has ? "border-success/40 bg-success/10 text-success" : "border-border text-muted-foreground"}`}>
                        {has ? "Bonded" : "None"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
