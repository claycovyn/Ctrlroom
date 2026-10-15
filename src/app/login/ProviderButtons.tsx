import { PROVIDER_LABEL, startHref, type ProviderView } from "@/lib/signinProviders";

// Above the email form on sign-in and sign-up: the result of the last attempt, then Continue with OpenCtrl, Continue
// with Google and one "or with email" divider. Renders nothing when no provider is set up and there's nothing to say.
export function ProviderButtons({ view, next }: { view: ProviderView; next: string }) {
  if (!view.notices.length && !view.buttons.length) return null;
  return (
    <div className="mb-5 space-y-4">
      {view.notices.map((n) => (
        <p key={n.text} role={n.role} className={`text-sm ${n.role === "status" ? "text-fg" : "text-alert"}`}>
          {n.text}
        </p>
      ))}
      {view.buttons.length > 0 && (
        <div className="space-y-3">
          {view.buttons.map((p, i) => (
            <a key={p} href={startHref(p, next)} className={`${i === 0 ? "btn-primary" : "btn-outline"} h-11 w-full rounded-full text-[15px] font-semibold`}>
              {PROVIDER_LABEL[p]}
            </a>
          ))}
        </div>
      )}
      {view.divider && (
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or with email
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
    </div>
  );
}
