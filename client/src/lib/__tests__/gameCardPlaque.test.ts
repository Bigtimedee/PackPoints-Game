import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const gameCardSrc = readFileSync(new URL("../../components/GameCard.tsx", import.meta.url), "utf8");
const plaqueSrc = readFileSync(new URL("../../components/MaskPlaque.tsx", import.meta.url), "utf8");
const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");

describe("GameCard reveal", () => {
  it("does not mount the reveal image before revealUrl is set", () => {
    expect(gameCardSrc).toContain("revealUrl ? (");
    expect(gameCardSrc).toContain('data-testid="img-card-reveal"');
    const reveal = gameCardSrc.slice(
      gameCardSrc.indexOf("revealUrl ? ("),
      gameCardSrc.indexOf('data-testid="img-card-reveal"'),
    );
    expect(reveal).toContain("src={revealUrl}");
    expect(gameCardSrc).not.toContain("/api/images/card/");
    expect(gameCardSrc).toContain("duration-240");
    expect(gameCardSrc).not.toContain("duration-[240ms]");
    expect(gameCardSrc).not.toContain("rotate(${imageRotation}deg)");
    expect(plaqueSrc).toContain("duration-240");
  });

  it("a reveal image error does not call onImageError or replace the bake", () => {
    const handler = gameCardSrc.slice(
      gameCardSrc.indexOf("const handleRevealError"),
      gameCardSrc.indexOf("const handleError"),
    );
    expect(handler).toContain("setRevealFailed(true)");
    expect(handler).not.toContain("onImageError");
    expect(handler).not.toContain("setImageError");
    expect(gameCardSrc).toContain("onError={handleRevealError}");
    expect(gameCardSrc).toContain("Full card image didn't load.");
    const revealOnError = gameCardSrc.slice(
      gameCardSrc.indexOf('data-testid="img-card-reveal"') - 180,
      gameCardSrc.indexOf('data-testid="img-card-reveal"'),
    );
    expect(revealOnError).toContain("onError={handleRevealError}");
    expect(revealOnError).not.toContain("onImageError");
  });
});

describe("MaskPlaque chrome", () => {
  it("turns the seam brand gold while an answer is selected, then reverts", () => {
    expect(plaqueSrc).toContain('data-testid="plaque-seam"');
    expect(plaqueSrc).toContain('data-armed={armed ? "true" : "false"}');
    expect(plaqueSrc).toContain('armed ? "h-[3px] bg-plaque-seam-armed" : "h-px bg-plaque-seam"');
    expect(plaqueSrc).toContain('armed ? "var(--plaque-seam-armed)" : "var(--plaque-seam)"');
    expect(plaqueSrc).toContain("hidden ? \"opacity-0\" : \"opacity-100\"");
    expect(gameSrc).toContain("answerStaged={!!selectedAnswer && !isRevealed}");
    expect(daily5Src).toContain("answerStaged={!!selectedAnswer && !isRevealed}");
    expect(matchSrc).toContain("answerStaged={!!selectedChoice && !answerResult}");
    expect(gameCardSrc).toContain("armed={answerStaged}");
    expect(gameCardSrc).toContain("hidden={revealLoaded}");
  });

  it("is opaque, keeps the name-band test ids, and has no blur", () => {
    expect(plaqueSrc).toContain("bg-plaque-fill");
    expect(plaqueSrc).toContain('data-testid={isPrimary ? "mask-name-band" : undefined}');
    expect(plaqueSrc).toContain("mask-region-${index}");
    expect(plaqueSrc).toContain('aria-hidden="true"');
    expect(plaqueSrc).toContain("pointer-events-none");
    expect(plaqueSrc).toContain("WHO IS THIS PLAYER?");
    expect(plaqueSrc).toContain("CERT SEALED");
    expect(plaqueSrc).not.toContain("backdrop-blur");
    expect(plaqueSrc).not.toContain("backdropFilter");
    expect(plaqueSrc).not.toContain("MYSTERY CARD");
  });
});

describe("solo points stay off the card", () => {
  it("does not paint a per-question award on or under the card", () => {
    expect(gameSrc).not.toContain("typeof data.pointsEarned === \"number\"");
    expect(gameSrc).not.toContain("+{points} pts");
    expect(gameSrc).not.toContain("PointsQuiet");
    expect(gameSrc).not.toContain("animate-bounce");
    expect(gameSrc).not.toContain("backdrop-blur");
    const slot = gameSrc.slice(
      gameSrc.indexOf('data-testid="solo-card-slot"'),
      gameSrc.indexOf("{/* Zone 3: Answers */}"),
    );
    expect(slot).not.toContain("PointsQuiet");
    expect(slot).not.toContain("+{points}");
    expect(slot).not.toMatch(/\bpts\b/);
  });

  it("Daily 5 does not show replacement copy", () => {
    expect(daily5Src).toContain("allowClientImageReject={false}");
    expect(daily5Src).not.toContain("Finding a replacement");
    expect(daily5Src).not.toContain("MYSTERY CARD");
  });
});
