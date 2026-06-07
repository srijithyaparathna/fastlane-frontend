import { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Settings, Send, Search, ScrollText, Coins, Zap, Wallet, Copy, LogIn, ShieldCheck } from "lucide-react";
import { useFastLane } from "@/hooks/useFastLane";
import { NODE_WS, truncate, copy } from "@/lib/fastlane";
import { toast } from "sonner";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/setup", label: "Setup", icon: Settings },
  { to: "/login", label: "Login", icon: LogIn },
  { to: "/submit", label: "Submit Payload", icon: Send },
  { to: "/tracker", label: "Payload Tracker", icon: Search },
  { to: "/events", label: "Events Log", icon: ScrollText },
  { to: "/bonds", label: "Bond Manager", icon: Coins },
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { state, block, accounts, selected, setSelected, connectWallet, extensionConnected, loggedIn } = useFastLane();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card/40 md:flex md:flex-col">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-info">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <div className="text-base font-bold leading-tight">FastLane</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Operator Console</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((n) => {
            const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3 text-[10px] text-muted-foreground">
          <div className="truncate">{NODE_WS}</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/30 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  state === "connected"
                    ? "bg-success shadow-[0_0_10px] shadow-success/60"
                    : state === "connecting"
                      ? "bg-warning animate-pulse"
                      : "bg-destructive"
                }`}
              />
              <span className="text-xs font-semibold capitalize">
                {state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : "Disconnected"}
              </span>
            </div>
            <div className="hidden items-center gap-2 text-xs sm:flex">
              <span className="text-muted-foreground">Block</span>
              <span className="font-mono font-semibold text-primary">#{block ?? "—"}</span>
            </div>
            <div className="hidden text-[11px] text-muted-foreground lg:block">{NODE_WS}</div>
          </div>

          <div className="flex items-center gap-2">
            {/* Logged-in indicator — links to Login page to switch accounts */}
            {loggedIn ? (
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/15"
                title="Logged in — click to switch accounts"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {loggedIn.name ?? truncate(loggedIn.address)}
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Log in with the Polkadot.js extension to submit payloads"
              >
                <LogIn className="h-3.5 w-3.5" />
                Login
              </Link>
            )}
            {/* Always show account selector when dev accounts are loaded */}
            {accounts.length > 0 && (
              <>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="rounded-md border border-border bg-input/60 px-2 py-1.5 text-xs"
                >
                  {accounts.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name ?? "Account"} — {truncate(a.address)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    if (await copy(selected)) toast.success("Address copied");
                  }}
                  className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                  title="Copy address"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {/* Extension connect button — shown until extension is connected */}
            {!extensionConnected && (
              <button
                onClick={connectWallet}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Add accounts from Polkadot.js browser extension"
              >
                <Wallet className="h-3.5 w-3.5" />
                + Extension
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
