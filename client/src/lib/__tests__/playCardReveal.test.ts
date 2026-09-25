import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { resolvePlayCardSrc } from "@shared/playCardImage";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");
const gameCardSrc = readFileSync(new URL("../../components/GameCard.tsx", import.meta.url), "utf8");
const playAgainSrc = readFileSync(new URL("../playAgain.ts", import.meta.url), "utf8");

const MASKED = `/api/play/m/solo/session/0/token?v=${CURRENT_MASK_VERSION}`;
const REVEAL = "/api/play/r/solo/session/0/123/token";

describe("resolvePlayCardSrc", () => {
  it("keeps the baked JPEG until a successful submit", () => {
    expect(resolvePlayCardSrc({ maskedUrl: MASKED, submitted: false })).toBe(MASKED);
    expect(MASKED).toContain(`v=${CURRENT_MASK_VERSION}`);
    expect(CURRENT_MASK_VERSION).toBe("v4.4");
  });

  it("swaps to the ACK reveal URL after successful submit", () => {
    expect(resolvePlayCardSrc({ maskedUrl: MASKED, revealUrl: REVEAL, submitted: true })).toBe(REVEAL);
    expect(REVEAL).not.toContain("masked-image");
    expect(REVEAL).not.toContain("/api/images/card/");
  });

  it("select-without-submit stays on the masked URL even if a reveal URL is sitting around", () => {
    const src = resolvePlayCardSrc({ maskedUrl: MASKED, revealUrl: REVEAL, submitted: false });
    expect(src).toBe(MASKED);
    expect(src).not.toContain("/api/play/r/");
    expect(src).not.toContain("/api/images/card/");
  });

  it("does not invent an unmasked URL when the ACK has not arrived", () => {
    expect(resolvePlayCardSrc({ maskedUrl: MASKED, submitted: true })).toBe(MASKED);
  });
});

describe("play surfaces: mask until successful submit, then full card", () => {
  it("solo reveal is ACK-only — handleSubmit does not flip isRevealed before mutate", () => {
    const handleSubmit = gameSrc.slice(
      gameSrc.indexOf("const handleSubmit"),
      gameSrc.indexOf("const handleNextQuestion"),
    );
    expect(handleSubmit).toContain("submitAnswerMutation.mutate");
    expect(handleSubmit).not.toContain("setIsRevealed(true)");

    const submitMutation = gameSrc.slice(
      gameSrc.indexOf("const submitAnswerMutation"),
      gameSrc.indexOf("const nextQuestionMutation"),
    );
    expect(submitMutation).toContain("setIsRevealed(true)");
    expect(submitMutation.indexOf("onSuccess")).toBeLessThan(submitMutation.indexOf("setIsRevealed(true)"));
    expect(submitMutation.indexOf("setIsRevealed(true)")).toBeLessThan(submitMutation.indexOf("onError"));
    expect(submitMutation).toContain("setIsRevealed(false)");
  });

  it("solo keeps the masked frame mounted and passes revealUrl only after ACK", () => {
    expect(gameSrc).toContain("imageUrl={currentQuestion.card.imageUrl}");
    expect(gameSrc).toContain("revealUrl={isRevealed ? currentQuestion.card.revealUrl : undefined}");
    expect(gameSrc).toContain("maskPlan={currentQuestion.card.maskPlan}");
    expect(gameSrc).toContain("gameCardMountKey(session.id, session.currentQuestionIndex, currentQuestion.card.imageUrl)");
    expect(gameSrc).toContain('playScope="solo"');
    expect(gameSrc).not.toContain('isRevealed ? "revealed" : "masked"');
    expect(gameSrc).not.toContain("/api/images/card/");
    expect(gameSrc).toContain("handleSelectAnswer");
    const select = gameSrc.slice(
      gameSrc.indexOf("const handleSelectAnswer"),
      gameSrc.indexOf("const handleSubmit"),
    );
    expect(select).toContain("setSelectedAnswer");
    expect(select).not.toContain("setIsRevealed");
  });

  it("solo next card / new session start masked", () => {
    const start = gameSrc.slice(
      gameSrc.indexOf("const startGameMutation"),
      gameSrc.indexOf("const submitAnswerMutation"),
    );
    expect(start).toContain("setIsRevealed(false)");
    const next = gameSrc.slice(
      gameSrc.indexOf("const nextQuestionMutation"),
      gameSrc.indexOf("const replaceCardMutation"),
    );
    expect(next).toContain("setIsRevealed(false)");
  });

  it("Daily 5 sets isRevealed only in answer onSuccess", () => {
    const answerMutation = daily5Src.slice(
      daily5Src.indexOf("const answerMutation"),
      daily5Src.indexOf("const finishMutation"),
    );
    expect(answerMutation).toContain("setIsRevealed(true)");
    expect(answerMutation.indexOf("onSuccess")).toBeLessThan(answerMutation.indexOf("setIsRevealed(true)"));

    const submit = daily5Src.slice(
      daily5Src.indexOf("const handleSubmitAnswer"),
      daily5Src.indexOf("const handleNext"),
    );
    expect(submit).not.toContain("setIsRevealed(true)");
    expect(submit).toContain("answerMutation.mutate");
  });

  it("Daily 5 next card starts masked and keeps #85 honest GameCard props", () => {
    expect(daily5Src).toContain("imageUrl={currentCard.imageUrl}");
    expect(daily5Src).toContain("revealUrl={isRevealed ? answerResult?.revealUrl ?? undefined : undefined}");
    expect(daily5Src).toContain('plaqueEyebrow="DAILY 5"');
    expect(daily5Src).toContain("aspect-[2.5/3.5]");
    expect(daily5Src).toContain("allowClientImageReject={false}");
    expect(daily5Src).toContain("gameCardMountKey(challengeId || \"daily5\", currentCard.position, currentCard.imageUrl)");
    expect(daily5Src).toContain('playScope="d5"');
    expect(daily5Src).not.toContain('isRevealed ? "revealed" : "masked"');
    expect(daily5Src).not.toContain("Finding a replacement");
    expect(daily5Src).not.toContain("onImageError");
    const nextIdx = daily5Src.indexOf("const handleNext");
    const next = daily5Src.slice(nextIdx, nextIdx + 600);
    expect(next).toContain("setIsRevealed(false)");
  });

  it("1v1 reveals only after answer_result and keeps the masked URL in the mount key", () => {
    expect(matchSrc).toContain("isRevealed={answerResult !== null}");
    expect(matchSrc).toContain("revealUrl={answerResult?.revealUrl ?? undefined}");
    expect(matchSrc).toContain("maskPlan={currentQuestion.card.maskPlan}");
    expect(matchSrc).toContain("setAnswerResult(null)");
    expect(matchSrc).toContain("currentQuestion.card.imageUrl");
    expect(matchSrc).toContain("gameCardMountKey(");
    expect(matchSrc).toContain('playScope="match"');
    expect(matchSrc).not.toContain('answerResult ? "revealed" : "masked"');
    expect(matchSrc).not.toContain("MYSTERY CARD");
    expect(matchSrc).toContain("setKey={matchState.gameSetId}");
    expect(matchSrc).not.toContain("cardNumber=");
    expect(matchSrc).not.toContain("team={currentQuestion");
  });

  it("solo reveal stays in the card slot — no dialog, zoom, or scrim", () => {
    const slot = gameSrc.slice(
      gameSrc.indexOf('data-testid="solo-card-slot"'),
      gameSrc.indexOf("{/* Zone 3: Answers */}"),
    );
    expect(slot).toContain("GameCard");
    expect(slot).toContain("revealUrl={isRevealed ? currentQuestion.card.revealUrl : undefined}");
    expect(slot).not.toContain("PointsQuiet");
    expect(slot).not.toContain("animate-bounce");
    expect(slot).not.toContain("Dialog");
    expect(slot).not.toContain("fixed");
    expect(slot).not.toContain("inset-0");
    expect(slot).not.toContain("scale-");
    expect(slot).not.toContain("zoom-");
    expect(gameSrc).not.toContain("badge-point-value");
    expect(gameSrc).not.toContain("Worth ");

    const answerBtn = gameSrc.slice(
      gameSrc.indexOf("function AnswerButton"),
      gameSrc.indexOf("export default function Game"),
    );
    expect(answerBtn).toContain("disabled:opacity-100");
    expect(answerBtn).toContain("disabled={disabled || isRevealed}");
  });

  it("Daily 5 and 1v1 revealed rows are not a scrim and do not show a static pts badge", () => {
    const d5Btn = daily5Src.slice(
      daily5Src.indexOf("function AnswerButton"),
      daily5Src.indexOf("export default function Daily5Page"),
    );
    expect(d5Btn).toContain("disabled:opacity-100");
    expect(daily5Src).not.toContain("Worth ");
    expect(daily5Src).not.toContain("badge-point-value");

    expect(matchSrc).toContain("disabled:opacity-100");
    expect(matchSrc).not.toContain("{currentQuestion.pointValue} pts");
    expect(matchSrc).not.toContain("Worth ");
  });

  it("GameCard does not open a click-to-enlarge lightbox", () => {
    expect(gameCardSrc).toContain('className="relative aspect-');
    expect(gameCardSrc).not.toContain("createPortal");
    expect(gameCardSrc).not.toContain("fixed inset");
    const img = gameCardSrc.slice(gameCardSrc.indexOf("<img"), gameCardSrc.indexOf("data-testid=\"img-card\""));
    expect(img).toContain("pointer-events-none");
    expect(img).not.toContain("onClick");
    expect(gameCardSrc).toContain("{!imageError && (");
  });

  it("GameCard stays dumb — it does not fetch originals from isRevealed", () => {
    expect(gameCardSrc).not.toContain("resolvePlayCardSrc");
    expect(gameCardSrc).not.toContain("/api/images/card/");
    expect(gameCardSrc).toContain("<MaskPlaque");
    expect(gameCardSrc).toContain("revealUrl ?");
    expect(gameCardSrc).toContain("isPlayCardImageReady(imageUrl)");
    expect(gameCardSrc).toContain("isRevealed && cardNumber");
    expect(gameCardSrc).not.toContain("backdrop-blur");
    expect(gameCardSrc).not.toContain("drop-shadow-lg");
    expect(gameCardSrc).not.toContain("MYSTERY CARD");
  });

  it("does not weaken #87 Play Again helpers", () => {
    expect(playAgainSrc).toContain("DAILY5_NEXT_PLAY");
    expect(playAgainSrc).toContain("Play Solo");
    expect(playAgainSrc).toContain("MATCH_FALLBACK_PLAY");
    expect(gameSrc).toContain("handlePlayAgain");
    expect(gameSrc).toContain('data-testid="button-play-again"');
  });
});
