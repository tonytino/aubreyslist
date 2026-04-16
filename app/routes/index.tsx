import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

// Example server function — runs only on the server, callable from loaders or
// components.  Use server functions for data that is tightly coupled to this
// route and does not need to be exposed as a standalone API endpoint.
// See docs/agents/api.md for the full decision rule.
const getWelcome = createServerFn().handler(async () => {
  return { message: "Hello from a server function", timestamp: Date.now() };
});

export const Route = createFileRoute("/")({
  loader: () => getWelcome(),
  component: Home,
});

function Home() {
  const { message, timestamp } = Route.useLoaderData();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">App Template</h1>
      <p className="text-muted-foreground text-lg">{message}</p>
      <p className="text-muted-foreground text-sm">
        Loaded at {new Date(timestamp).toLocaleTimeString()}
      </p>
    </main>
  );
}
