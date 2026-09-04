import { describe, expect, it } from "vitest";
import {
  IDENTIFY_MAX_BYTES,
  IDENTIFY_MIN_JPEG_QUALITY,
  IDENTIFY_MIN_MAX_EDGE,
  IDENTIFY_START_MAX_EDGE,
  isHeicLike,
  nextEncodeParams,
} from "../prepareIdentifyImage";

describe("isHeicLike", () => {
  it("detects heic/heif by mime and extension", () => {
    expect(isHeicLike(new File([], "card.HEIC", { type: "image/heic" }))).toBe(true);
    expect(isHeicLike(new File([], "card.heif", { type: "" }))).toBe(true);
    expect(isHeicLike(new File([], "card.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});

describe("nextEncodeParams", () => {
  it("stops when under budget", () => {
    const r = nextEncodeParams(2048, 0.85, IDENTIFY_MAX_BYTES - 1);
    expect(r.done).toBe(true);
    expect(r.maxEdge).toBe(2048);
  });

  it("steps longest edge down first", () => {
    const r = nextEncodeParams(IDENTIFY_START_MAX_EDGE, 0.85, IDENTIFY_MAX_BYTES + 1);
    expect(r.done).toBe(false);
    expect(r.maxEdge).toBe(Math.floor(IDENTIFY_START_MAX_EDGE * 0.75));
    expect(r.quality).toBe(0.85);
  });

  it("floors edge at MIN then reduces quality", () => {
    const atMin = nextEncodeParams(IDENTIFY_MIN_MAX_EDGE, 0.85, IDENTIFY_MAX_BYTES + 1);
    expect(atMin.maxEdge).toBe(IDENTIFY_MIN_MAX_EDGE);
    expect(atMin.quality).toBeLessThan(0.85);
    expect(atMin.done).toBe(false);

    const exhausted = nextEncodeParams(IDENTIFY_MIN_MAX_EDGE, IDENTIFY_MIN_JPEG_QUALITY, IDENTIFY_MAX_BYTES + 1);
    expect(exhausted.done).toBe(true);
  });
});
