import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">404</p>
      <h1 className="text-2xl font-semibold">Nothing here</h1>
      <p className="text-sm text-muted">This room or community doesn’t exist, or you’re not a member.</p>
      <Link href="/app" className="btn-outline mt-2">
        Home
      </Link>
    </main>
  );
}
