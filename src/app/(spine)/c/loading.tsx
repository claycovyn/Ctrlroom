/**
 * Shown the moment you tap a community on the Spine while it loads, so the content swaps at once and the Spine stays.
 * Same frame as the community: the channel list, and the room beside it from 768px.
 */
export default function CommunityLoading() {
  return (
    <div className="cr-shell cr-safe-top flex overflow-hidden" aria-busy="true" aria-label="Loading the community">
      <div className="flex w-full shrink-0 flex-col border-r border-line bg-panel md:w-60">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <span className="h-4 w-28 animate-pulse rounded bg-raised" />
        </div>
        <div className="space-y-3 px-4 pt-5">
          {[60, 80, 50, 70, 40].map((w, i) => (
            <span key={i} className="block h-3 animate-pulse rounded bg-raised" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <span className="h-4 w-32 animate-pulse rounded bg-raised" />
        </div>
        <div className="space-y-5 px-4 pt-6">
          {[72, 48, 88].map((w, i) => (
            <div key={i} className="flex gap-3">
              <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-raised" />
              <div className="flex-1 space-y-2 pt-1">
                <span className="block h-3 w-24 animate-pulse rounded bg-raised" />
                <span className="block h-3 animate-pulse rounded bg-raised" style={{ width: `${w}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
