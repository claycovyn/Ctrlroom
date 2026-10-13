import { describe, expect, it } from "vitest";
import {
  CANT_SHRINK,
  clampCrop,
  CROP_TARGETS,
  coverScale,
  cropRect,
  fitToLimit,
  MAX_ZOOM,
  NOT_AN_IMAGE,
  outputSize,
  panCrop,
  pickProblem,
  START_CROP,
  TOO_BIG_TO_OPEN,
  UNSUPPORTED_FORMAT,
  zoomCrop,
} from "@/lib/imageResize";

const photo = CROP_TARGETS.photo;
const cover = CROP_TARGETS.cover;
const land = { width: 4000, height: 3000 };
const tall = { width: 1000, height: 3000 };
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("targets", () => {
  it("are 512×512 for photos and icons and 1600×400 for covers", () => {
    expect(CROP_TARGETS.photo).toEqual({ width: 512, height: 512 });
    expect(CROP_TARGETS.icon).toEqual({ width: 512, height: 512 });
    expect(CROP_TARGETS.cover).toEqual({ width: 1600, height: 400 });
  });
});

describe("coverScale and cropRect", () => {
  it("at zoom 1 a landscape photo's full height fills a square frame, centred", () => {
    close(coverScale(land, photo), 1 / 3000);
    const r = cropRect(START_CROP, land, photo);
    close(r.sw, 3000);
    close(r.sh, 3000);
    close(r.sx, 500);
    close(r.sy, 0);
  });

  it("a cover frame takes the full width of a tall image", () => {
    const r = cropRect(START_CROP, tall, cover);
    close(r.sw, 1000);
    close(r.sh, 250);
    close(r.sy, (3000 - 250) / 2);
  });

  it("zoom 2 takes half as many pixels", () => {
    const r = cropRect({ zoom: 2, x: 0, y: 0 }, land, photo);
    close(r.sw, 1500);
    close(r.sx, 1250);
    close(r.sy, 750);
  });

  it("panning moves the crop the other way and stays inside the image", () => {
    const right = cropRect({ zoom: 1, x: -10, y: 0 }, land, photo); // image pushed left as far as it goes
    close(right.sx, 1000);
    const left = cropRect({ zoom: 1, x: 10, y: 0 }, land, photo);
    close(left.sx, 0);
  });
});

describe("clampCrop", () => {
  it("keeps zoom between 1 and the max", () => {
    expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, land, photo).zoom).toBe(1);
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, land, photo).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: NaN, x: NaN, y: NaN }, land, photo)).toEqual(START_CROP);
  });

  it("never leaves empty edges: a landscape image in a square only moves sideways at zoom 1", () => {
    const c = clampCrop({ zoom: 1, x: 5, y: 5 }, land, photo);
    close(c.x, (4000 / 3000 - 1) / 2);
    close(c.y, 0);
  });

  it("the image always covers the frame, whatever you do", () => {
    for (const image of [land, tall, { width: 300, height: 300 }]) {
      for (const target of [photo, cover]) {
        for (const c of [
          { zoom: 1, x: 3, y: -3 },
          { zoom: 2.5, x: -0.4, y: 0.9 },
          { zoom: 4, x: 100, y: 100 },
        ]) {
          const r = cropRect(c, image, target);
          expect(r.sx).toBeGreaterThanOrEqual(-1e-9);
          expect(r.sy).toBeGreaterThanOrEqual(-1e-9);
          expect(r.sx + r.sw).toBeLessThanOrEqual(image.width + 1e-6);
          expect(r.sy + r.sh).toBeLessThanOrEqual(image.height + 1e-6);
          close(r.sw / r.sh, target.width / target.height);
        }
      }
    }
  });
});

describe("panCrop and zoomCrop", () => {
  it("pan adds and clamps", () => {
    const c = panCrop(START_CROP, 0.1, 0, land, photo);
    close(c.x, 0.1);
    close(panCrop(c, 5, 0, land, photo).x, (4000 / 3000 - 1) / 2);
  });

  it("zooming at a point keeps that point still", () => {
    const at = { x: 0.3, y: -0.2 };
    const before = { zoom: 2, x: 0.1, y: 0.05 };
    const after = zoomCrop(before, 3, land, photo, at);
    // the image point under `at`, in base units, is (at - offset) / zoom
    close((at.x - before.x) / before.zoom, (at.x - after.x) / after.zoom);
    close((at.y - before.y) / before.zoom, (at.y - after.y) / after.zoom);
  });

  it("zooming out to 1 recentres what can't stay covered", () => {
    const c = zoomCrop({ zoom: 3, x: 0, y: 0.8 }, 1, land, photo);
    expect(c.zoom).toBe(1);
    close(c.y, 0);
  });
});

describe("outputSize", () => {
  it("downsizes to the target", () => {
    expect(outputSize(cropRect(START_CROP, land, photo), photo)).toEqual({ width: 512, height: 512 });
    expect(outputSize(cropRect(START_CROP, { width: 6000, height: 4000 }, cover), cover)).toEqual({ width: 1600, height: 400 });
  });

  it("never upscales a small crop", () => {
    expect(outputSize({ sx: 0, sy: 0, sw: 300, sh: 300 }, photo)).toEqual({ width: 300, height: 300 });
    expect(outputSize({ sx: 0, sy: 0, sw: 800, sh: 200 }, cover)).toEqual({ width: 800, height: 200 });
    expect(outputSize({ sx: 0, sy: 0, sw: 1, sh: 1 }, photo)).toEqual({ width: 1, height: 1 });
  });
});

describe("fitToLimit", () => {
  const fake = (bytesPerPixel: number) => {
    const calls: string[] = [];
    const encode = async (s: { width: number; height: number }, q: number) => {
      calls.push(`${s.width}x${s.height}@${q}`);
      return { size: Math.round(s.width * s.height * bytesPerPixel * q) };
    };
    return { calls, encode };
  };

  it("keeps the best quality that fits under 95% of the limit", async () => {
    const { calls, encode } = fake(0.5); // 512×512 at 0.92 ≈ 120 KB
    const r = await fitToLimit({ width: 512, height: 512 }, 1024 * 1024, encode);
    expect(r.quality).toBe(0.92);
    expect(r).toMatchObject({ width: 512, height: 512 });
    expect(calls).toEqual(["512x512@0.92"]);
  });

  it("steps quality down before shrinking", async () => {
    const { calls, encode } = fake(5); // 0.92 → 1.2 MB; 0.7 → 917 KB, under 0.95 MB
    const r = await fitToLimit({ width: 512, height: 512 }, 1024 * 1024, encode);
    expect(r.quality).toBe(0.7);
    expect(calls).toEqual(["512x512@0.92", "512x512@0.85", "512x512@0.78", "512x512@0.7"]);
    expect(r.blob.size).toBeLessThanOrEqual(0.95 * 1024 * 1024);
  });

  it("then shrinks the size when even 0.6 is too big", async () => {
    const { calls, encode } = fake(20);
    const r = await fitToLimit({ width: 1600, height: 400 }, 2 * 1024 * 1024, encode);
    expect(r.width).toBeLessThan(1600);
    expect(r.width / r.height).toBeCloseTo(4, 1);
    expect(r.blob.size).toBeLessThanOrEqual(0.95 * 2 * 1024 * 1024);
    expect(calls.slice(0, 6)).toEqual(["1600x400@0.92", "1600x400@0.85", "1600x400@0.78", "1600x400@0.7", "1600x400@0.6", "1280x320@0.92"]);
  });

  it("gives up with a plain message instead of looping", async () => {
    const encode = async () => ({ size: 10 * 1024 * 1024 });
    await expect(fitToLimit({ width: 512, height: 512 }, 1024 * 1024, encode)).rejects.toThrow(CANT_SHRINK);
  });

  it("ignores empty results", async () => {
    let n = 0;
    const encode = async () => ({ size: n++ === 0 ? 0 : 100 });
    const r = await fitToLimit({ width: 10, height: 10 }, 1000, encode);
    expect(r.quality).toBe(0.85);
  });
});

describe("pickProblem", () => {
  it("lets any image type through, and files with no type", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif", "image/avif", ""]) {
      expect(pickProblem({ type, size: 5_000_000 })).toBeNull();
    }
  });
  it("turns away non-images, SVG, empty and huge files", () => {
    expect(pickProblem({ type: "application/pdf", size: 10 })).toBe(NOT_AN_IMAGE);
    expect(pickProblem({ type: "video/mp4", size: 10 })).toBe(NOT_AN_IMAGE);
    expect(pickProblem({ type: "image/svg+xml", size: 10 })).toBe(UNSUPPORTED_FORMAT);
    expect(pickProblem({ type: "image/png", size: 0 })).toBe("That file is empty.");
    expect(pickProblem({ type: "image/jpeg", size: 60 * 1024 * 1024 })).toBe(TOO_BIG_TO_OPEN);
  });
});
