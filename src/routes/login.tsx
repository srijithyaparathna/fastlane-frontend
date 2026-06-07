import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFastLane } from "@/hooks/useFastLane";
import { Card, Button, Address } from "@/components/fastlane/Card";
import { Plug, PlugZap, LogIn, LogOut, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const { accounts, extAddresses, extensionConnected, connectWallet, loggedIn, login, logout } = useFastLane();
  const [connecting, setConnecting] = useState(false);
  const [loggingInAddress, setLoggingInAddress] = useState<string | null>(null);

  const extAccounts = useMemo(
    () => accounts.filter((a) => extAddresses.has(a.address)),
    [accounts, extAddresses],
  );

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await connectWallet();
    } finally {
      setConnecting(false);
    }
  };

  const handleLogin = async (address: string) => {
    if (loggingInAddress) return;
    setLoggingInAddress(address);
    toast("Open the Polkadot.js extension and enter your password to continue…");
    try {
      const ok = await login(address);
      if (ok) {
        toast.success("Logged in — you can now submit payloads");
        navigate({ to: "/submit" });
      }
    } finally {
      setLoggingInAddress(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Login</h1>
        <p className="text-sm text-muted-foreground">
          Log in with a Polkadot.js extension account to submit payloads. Each switch of account requires logging in again.
        </p>
      </div>

      {loggedIn && (
        <Card title="Logged In" subtitle="This account will be used to sign and submit payloads">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-success" />
              <div>
                <div className="text-sm font-semibold">{loggedIn.name ?? "Account"}</div>
                <Address value={loggedIn.address} />
              </div>
            </div>
            <Button variant="ghost" onClick={() => { logout(); toast("Logged out"); }}>
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </Button>
          </div>
        </Card>
      )}

      <Card
        title="Polkadot.js Extension"
        subtitle="Authorize this site, then choose which account to log in as"
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
        {extAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {extensionConnected
              ? "The extension is connected but has no accounts to share with this site. Open the extension, create or import an account, and authorize this site under Manage Website Access."
              : "Click Connect Polkadot.js Extension and approve the authorization request in your browser extension."}
          </p>
        ) : (
          <div className="space-y-2">
            {extAccounts.map((a) => {
              const active = loggedIn?.address === a.address;
              return (
                <div
                  key={a.address}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                    active ? "border-primary/50 bg-primary/10" : "border-border bg-background/40"
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold">{a.name ?? "Account"}</div>
                    <Address value={a.address} />
                  </div>
                  {active ? (
                    <span className="text-xs font-medium text-primary">Logged in</span>
                  ) : (
                    <Button
                      onClick={() => handleLogin(a.address)}
                      loading={loggingInAddress === a.address}
                      disabled={!!loggingInAddress}
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      {loggingInAddress === a.address ? "Check extension…" : "Log in"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11px] text-muted-foreground">
          Clicking <strong>Log in</strong> opens the Polkadot.js extension and asks you to sign a sign-in
          message with your account password — this verifies you control the account before you're
          allowed to submit payloads.
        </p>
      </Card>
    </div>
  );
}
