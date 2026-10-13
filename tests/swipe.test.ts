import { describe, expect, it } from "vitest";
import { swipeOutcome } from "@/lib/swipe";

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
