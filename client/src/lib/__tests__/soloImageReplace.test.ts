import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  SOLO_REPLACE_HARD_CAP_MS,
  gameCardReplaceOverlay,
  reduceSoloReplacePhase,
  soloAnswersLocked,
} from "../soloImageReplace";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const gameCardSrc = readFileSync(new URL("../../components/GameCard.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");

describe("solo replace lifecycle", () => {
  it("a successful replace leaves the spinner", () => {
    expect(reduceSoloReplacePhase("replacing", { type: "replace-succeeded" })).toBe("idle");
    expect(gameCardReplaceOverlay({
      allowClientImageReject: true,
      replacePhase: "idle",
    })).toBe("default");
    expect(soloAnswersLocked("idle")).toBe(false);
  });

  it("failure, an empty body, and the hard cap resolve to an honest error, not a spinner", () => {
    expect(SOLO_REPLACE_HARD_CAP_MS).toBeGreaterThanOrEqual(6000);
    expect(SOLO_REPLACE_HARD_CAP_MS).toBeLessThanOrEqual(8000);
    for (const event of ["replace-failed", "replace-empty", "replace-timeout"] as const) {
      const phase = reduceSoloReplacePhase("replacing", { type: event });
      expect(phase).toBe("failed");
      expect(gameCardReplaceOverlay({
        allowClientImageReject: true,
        replacePhase: phase,
      })).toBe("replace-failed");
      expect(soloAnswersLocked(phase)).toBe(true);
    }
    expect(gameCardReplaceOverlay({
      allowClientImageReject: true,
      replacePhase: "replacing",
    })).toBe("spinner");
    expect(gameSrc).toContain("timeoutMs: SOLO_REPLACE_HARD_CAP_MS");
    expect(gameSrc).toContain('type: "replace-timeout"');
    expect(gameCardSrc).toContain('data-testid="text-game-card-replace-failed"');
    expect(gameCardSrc).toContain("Retry this card or skip it.");
  });

  it("a reveal URL clears replacing and paints over the error", () => {
    expect(reduceSoloReplacePhase("replacing", { type: "reveal" })).toBe("revealed");
    expect(reduceSoloReplacePhase("failed", { type: "reveal" })).toBe("revealed");
    expect(soloAnswersLocked("revealed")).toBe(false);
    expect(gameCardReplaceOverlay({
      allowClientImageReject: true,
      replacePhase: "replacing",
      revealUrl: "/api/play/r/solo/session/4/exp/hmac",
    })).toBe("default");
    expect(gameCardSrc).toContain("if (revealUrl && imageError)");
    expect(gameCardSrc).toContain("setImageError(false)");
    const load = gameCardSrc.slice(
      gameCardSrc.indexOf("const handleImageLoad"),
      gameCardSrc.indexOf("const handleRevealError"),
    );
    expect(load.indexOf("if (revealUrl)")).toBeLessThan(load.indexOf("evaluateCardImageValidity"));
    expect(load).toContain("return;");
    expect(gameSrc).toContain('type: "reveal"');
  });

  it("disables answer choices and Submit while a replace is in flight", () => {
    expect(soloAnswersLocked("replacing")).toBe(true);
    expect(gameSrc).toContain("const answersLocked = soloAnswersLocked(replacePhase)");
    expect(gameSrc).toContain("|| answersLocked");
    const select = gameSrc.slice(
      gameSrc.indexOf("const handleSelectAnswer"),
      gameSrc.indexOf("const handleSubmit"),
    );
    expect(select).toContain("answersLocked");
    const submit = gameSrc.slice(
      gameSrc.indexOf("const handleSubmit"),
      gameSrc.indexOf("const handleNextQuestion"),
    );
    expect(submit).toContain("answersLocked");
  });

  it("Daily 5 never enters replacing or wires solo replace-card", () => {
    expect(reduceSoloReplacePhase("idle", { type: "image-rejected", allowReplace: false })).toBe("failed");
    expect(reduceSoloReplacePhase("idle", { type: "image-rejected", allowReplace: false })).not.toBe("replacing");
    expect(gameCardReplaceOverlay({
      allowClientImageReject: false,
      replacePhase: "replacing",
    })).toBe("honest");
    expect(gameCardReplaceOverlay({ allowClientImageReject: false })).not.toBe("spinner");
    expect(daily5Src).toContain("allowClientImageReject={false}");
    expect(daily5Src).not.toContain("onImageError");
    expect(daily5Src).not.toContain("replace-card");
    expect(daily5Src).not.toContain("Finding a replacement");
    expect(daily5Src).not.toContain("replacePhase");
  });
});
