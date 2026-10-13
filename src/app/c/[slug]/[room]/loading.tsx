/**
 * Shown the moment you switch rooms while the room loads (and what a link prefetches ahead of time), so a tap always
 * answers at once. Same frame as RoomView: header, messages, composer.
 */
export default function RoomLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-busy="true" aria-label="Loading the room">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="h-4 w-4 rounded bg-raised md:hidden" />
        <span className="h-4 w-32 animate-pulse rounded bg-raised" />
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-4 pt-6">
        {[72, 48, 88, 60].map((w, i) => (
          <div key={i} className="flex gap-3">
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-raised" />
            <div className="flex-1 space-y-2 pt-1">
              <span className="block h-3 w-24 animate-pulse rounded bg-raised" />
              <span className="block h-3 animate-pulse rounded bg-raised" style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="cr-composer px-4 pb-4 pt-5">
        <div className="h-11 rounded-lg border border-line bg-panel" />
      </div>
    </div>
  );
}
