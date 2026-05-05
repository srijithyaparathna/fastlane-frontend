import { Outlet, Link, createRootRoute, HeadContent, Scripts, ClientOnly } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { FastLaneProvider } from "@/hooks/useFastLane";
import { AppLayout } from "@/components/fastlane/Layout";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FastLane Dashboard" },
      { name: "description", content: "Operator console for the FastLane Substrate pallet." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <ClientOnly fallback={<div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Loading FastLane…</div>}>
      <FastLaneProvider>
        <AppLayout>
          <Outlet />
        </AppLayout>
        <Toaster />
      </FastLaneProvider>
    </ClientOnly>
  );
}
