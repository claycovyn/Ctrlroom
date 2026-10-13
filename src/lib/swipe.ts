/**
 * Whether a drag-to-dismiss gesture (src/components/useSwipeDismiss.ts) should close the thing or let it settle back.
 * Like iOS: a flick closes even when it's short, a slow drag closes past about a third of the way.
 */
export interface SwipeSample {
  /** How far it was dragged towards dismissing, px (never negative). */
  offset: number;
  /** The element's size along the drag, px. */
  size: number;
  /** Speed at release towards dismissing, px/ms (negative = moving back). */
  velocity: number;
}

export const FLICK_VELOCITY = 0.5;
export const DISMISS_FRACTION = 1 / 3;

export function swipeOutcome({ offset, size, velocity }: SwipeSample): "dismiss" | "stay" {
  // A twitch just past the touch slop is never a dismiss, however fast.
  if (offset < 16) return "stay";
  // Moving back towards open at release: it stays, however far it got.
  if (velocity < -0.1) return "stay";
  if (velocity >= FLICK_VELOCITY) return "dismiss";
  // Where it would come to rest with that speed (a short projection, like UIKit's deceleration).
  const projected = offset + Math.max(0, velocity) * 120;
  return projected >= size * DISMISS_FRACTION ? "dismiss" : "stay";
}

/**
 * The phone navigation (src/components/chat/ChatStage.tsx): where the chat settles after a drag. `x` is how far it's
 * slid right (0 = covering the rooms, `span` = open), `velocity` px/ms to the right. True = the rooms show.
 */
export function navSwipeTarget({ open, x, span, velocity }: { open: boolean; x: number; span: number; velocity: number }): boolean {
  if (!open) return swipeOutcome({ offset: x, size: span, velocity }) === "dismiss";
  return swipeOutcome({ offset: span - x, size: span, velocity: -velocity }) !== "dismiss";
}
