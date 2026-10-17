/** Shown beside the Spine while the Feed, a profile or DMs load after a tap, so the content swaps at once. */
export default function SpineLoading() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[600px] md:border-x md:border-line" aria-busy="true" aria-label="Loading">
      <div className="h-14 border-b border-line" />
      <div className="space-y-6 px-4 pt-5">
        {[80, 55, 70].map((w, i) => (
          <div key={i} className="flex gap-3">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-raised" />
            <div className="flex-1 space-y-2 pt-1">
              <span className="block h-3 w-28 animate-pulse rounded bg-raised" />
              <span className="block h-3 animate-pulse rounded bg-raised" style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
