import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useFastLane } from "@/hooks/useFastLane";
import { Stat, Card, Button } from "@/components/fastlane/Card";
import { Send, ScrollText } from "lucide-react";

export const Route = createFileRoute("/")({ component: DashboardPage });

function DashboardPage() {
  const { api } = useFastLane();
  const [authorities, setAuthorities] = useState<number>(0);
  const [threshold, setThreshold] = useState<string>("—");
  const [pending, setPending] = useState<string>("—");
  const [finalised, setFinalised] = useState<string>("—");

  useEffect(() => {
    if (!api) return;
    let active = true;
    const load = async () => {
      try {
        const p = (api.query as any).fastlane;
        if (!p) return;
        const [a, t, pc, fc] = await Promise.all([
          p.authorities ? p.authorities() : Promise.resolve([]),
          p.threshold ? p.threshold() : Promise.resolve(null),
          p.pendingCount ? p.pendingCount() : Promise.resolve(null),
          p.finalisedCount ? p.finalisedCount() : (p.finalizedCount ? p.finalizedCount() : Promise.resolve(null)),
        ]);
        if (!active) return;
        const list = (a?.toJSON?.() ?? []) as any[];
        setAuthorities(Array.isArray(list) ? list.length : 0);
        setThreshold(t?.toString?.() ?? "—");
        setPending(pc?.toString?.() ?? "—");
        setFinalised(fc?.toString?.() ?? "—");
      } catch (e) {
        console.error(e);
      }
    };
    load();
    const id = setInterval(load, 6000);
    return () => { active = false; clearInterval(id); };
  }, [api]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live overview of the FastLane pallet on the connected node.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total Authorities" value={authorities} accent="primary" />
        <Stat label="Current Threshold" value={threshold} accent="info" />
        <Stat label="Pending Payloads" value={pending} accent="warning" />
        <Stat label="Finalised Total" value={finalised} accent="success" />
      </div>

      <Card title="Quick Actions">
        <div className="flex flex-wrap gap-3">
          <Link to="/submit"><Button><Send className="h-4 w-4" /> Submit Payload</Button></Link>
          <Link to="/events"><Button variant="ghost"><ScrollText className="h-4 w-4" /> View Events</Button></Link>
        </div>
      </Card>
    </div>
  );
}
