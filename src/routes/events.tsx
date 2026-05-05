import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useEffect, useState } from "react";
import { useFastLaneEvents } from "@/hooks/useFastLaneEvents";
import { Card, Button, CopyButton } from "@/components/fastlane/Card";
import { truncate } from "@/lib/fastlane";
import { CheckCircle2, Clock, Trophy, Skull, Key, Users, Settings, Coins } from "lucide-react";

export const Route = createFileRoute("/events")({ component: EventsPage });

const FILTERS = ["All", "Submitted", "PreConsensed", "Finalised", "Expired"] as const;
type Filter = (typeof FILTERS)[number];

type EventMeta = { border: string; icon: any; color: string; bg: string };

function getEventMeta(method: string): EventMeta {
  const m = method.toLowerCase();
  if (m.includes("preconsensed") || m.includes("preconsensus"))
    return { border: "border-l-info", icon: CheckCircle2, color: "text-info", bg: "bg-info/10" };
  if (m.includes("finalis") || m.includes("finaliz"))
    return { border: "border-l-success", icon: Trophy, color: "text-success", bg: "bg-success/10" };
  if (m.includes("expired"))
    return { border: "border-l-destructive", icon: Skull, color: "text-destructive", bg: "bg-destructive/10" };
  if (m.includes("authorit"))
    return { border: "border-l-primary", icon: Users, color: "text-primary", bg: "bg-primary/10" };
  if (m.includes("threshold"))
    return { border: "border-l-primary", icon: Settings, color: "text-primary", bg: "bg-primary/10" };
  if (m.includes("bond"))
    return { border: "border-l-warning", icon: Coins, color: "text-warning", bg: "bg-warning/10" };
  if (m.includes("attest"))
    return { border: "border-l-info", icon: Key, color: "text-info", bg: "bg-info/10" };
  // Submitted + default
  return { border: "border-l-warning", icon: Clock, color: "text-warning", bg: "bg-warning/10" };
}

function EventsPage() {
  const { events, clear } = useFastLaneEvents();
  const [filter, setFilter] = useState<Filter>("All");
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    if (filter === "All") return events;
    const f = filter.toLowerCase().slice(0, 6);
    return events.filter((e) => e.method.toLowerCase().includes(f));
  }, [events, filter]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [shown.length]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Events Log</h1>
          <p className="text-sm text-muted-foreground">
            Fastlane events — last 100 blocks + real-time. {events.length > 0 && <span className="text-primary font-medium">{events.length} events loaded.</span>}
          </p>
        </div>
        <Button variant="ghost" onClick={clear}>Clear log</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {f}
            {f !== "All" && (
              <span className="ml-1 text-[10px] opacity-60">
                {events.filter((e) => e.method.toLowerCase().includes(f.toLowerCase().slice(0, 6))).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        <div ref={listRef} className="max-h-[600px] space-y-1.5 overflow-auto pr-1">
          {shown.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-10 text-center text-xs text-muted-foreground">
              {events.length === 0 ? "Scanning recent blocks for fastlane events…" : "No events match this filter."}
            </div>
          )}
          {shown.map((e) => {
            const meta = getEventMeta(e.method);
            const Icon = meta.icon;
            return (
              <div
                key={e.id}
                className={`flex items-start gap-3 rounded-lg border border-l-4 border-border ${meta.bg} ${meta.border} px-3 py-2.5`}
              >
                <div className={`mt-0.5 shrink-0 rounded-md p-1 ${meta.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-xs font-semibold">fastlane.{e.method}</span>
                    <span className={`rounded-full border px-1.5 py-0 text-[10px] font-mono ${meta.color} border-current opacity-60`}>
                      {e.block}-{String(e.index).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{e.description}</p>
                  {e.payloadId && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">{truncate(e.payloadId, 10, 8)}</span>
                      <CopyButton text={e.payloadId} />
                    </div>
                  )}
                </div>

                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
