export function NotConfigured() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Almost there</h1>
        <p className="text-muted">
          Ctrl Room needs a Supabase project. Copy <code className="font-mono">.env.example</code> to{" "}
          <code className="font-mono">.env.local</code>, fill in <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, run the migration in{" "}
          <code className="font-mono">supabase/migrations</code>, then restart.
        </p>
      </div>
    </main>
  );
}
