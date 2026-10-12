/** Mirrors public.level_for / level_floor in 0002_community_hub.sql. */
export const LEVEL_FLOORS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015];

export function levelFor(points: number): number {
  let level = 1;
  LEVEL_FLOORS.forEach((floor, i) => {
    if (points >= floor) level = i + 1;
  });
  return level;
}

/** 0–1 progress from the current level's floor to the next level. */
export function levelProgress(points: number): { level: number; next: number | null; progress: number; toGo: number } {
  const level = levelFor(points);
  if (level >= 9) return { level, next: null, progress: 1, toGo: 0 };
  const floor = LEVEL_FLOORS[level - 1];
  const next = LEVEL_FLOORS[level];
  return { level, next, progress: (points - floor) / (next - floor), toGo: next - points };
}
