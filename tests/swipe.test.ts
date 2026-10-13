import { describe, expect, it } from "vitest";
import { navSwipeTarget, swipeOutcome } from "@/lib/swipe";

describe("swipeOutcome", () => {
  const size = 300;
  it("a slow drag past a third closes; short of it settles back", () => {
    expect(swipeOutcome({ offset: 110, size, velocity: 0 })).toBe("dismiss");
    expect(swipeOutcome({ offset: 90, size, velocity: 0 })).toBe("stay");
  });
  it("a flick closes even when short", () => {
    expect(swipeOutcome({ offset: 30, size, velocity: 0.8 })).toBe("dismiss");
    expect(swipeOutcome({ offset: 10, size, velocity: 2 })).toBe("stay");
  });
  it("speed carries a medium drag over the line", () => {
    expect(swipeOutcome({ offset: 70, size, velocity: 0.3 })).toBe("dismiss");
    expect(swipeOutcome({ offset: 70, size, velocity: 0.1 })).toBe("stay");
  });
  it("moving back at release always stays", () => {
    expect(swipeOutcome({ offset: 250, size, velocity: -0.4 })).toBe("stay");
  });
  it("nothing dragged, nothing happens", () => {
    expect(swipeOutcome({ offset: 0, size, velocity: 3 })).toBe("stay");
  });
});

describe("navSwipeTarget (phone rooms under the chat)", () => {
  const span = 338;
  it("closed: a third of the way or a flick opens the rooms", () => {
    expect(navSwipeTarget({ open: false, x: 120, span, velocity: 0 })).toBe(true);
    expect(navSwipeTarget({ open: false, x: 60, span, velocity: 0 })).toBe(false);
    expect(navSwipeTarget({ open: false, x: 40, span, velocity: 0.9 })).toBe(true);
  });
  it("open: dragging the chat back a third, or flicking it left, closes them", () => {
    expect(navSwipeTarget({ open: true, x: span - 120, span, velocity: 0 })).toBe(false);
    expect(navSwipeTarget({ open: true, x: span - 60, span, velocity: 0 })).toBe(true);
    expect(navSwipeTarget({ open: true, x: span - 40, span, velocity: -0.9 })).toBe(false);
  });
  it("turning back before letting go keeps where it started", () => {
    expect(navSwipeTarget({ open: false, x: 250, span, velocity: -0.5 })).toBe(false);
    expect(navSwipeTarget({ open: true, x: 60, span, velocity: 0.5 })).toBe(true);
  });
});
