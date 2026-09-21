/**
 * Registration-gate account form must stay quiet.
 * Create free account / Sign in reuse ANON_GATE_COPY. No signup-bonus banner.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const signupSrc = readFileSync(new URL("../../components/signup-modal.tsx", import.meta.url), "utf8");
const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");

/** Claim-FOMO that bled into the shared signup modal after the gate shipped. */
const SIGNUP_MODAL_BANNED = [
  "Save Your Points!",
  "+250 bonus PackPTS",
  "250 bonus PackPTS",
  "250 free PackPTS",
  "Create Account & Claim Points",
  "Log In & Claim Points",
  "claim your points",
  "on signup!",
];

describe("signup modal register/claim copy", () => {
  it("reuses the locked gate headlines and the escrow chip", () => {
    expect(signupSrc).toContain("ANON_GATE_COPY.softTitle");
    expect(signupSrc).toContain("ANON_GATE_COPY.hardTitle");
    expect(signupSrc).toContain("ANON_GATE_COPY.softBody");
    expect(signupSrc).toContain("ANON_GATE_COPY.hardBody");
    expect(signupSrc).toContain("ANON_GATE_COPY.softCta");
    expect(signupSrc).toContain("ANON_GATE_COPY.hardCta");
    expect(signupSrc).toContain("ANON_GATE_COPY.signInCta");
    expect(signupSrc).toContain("<EscrowHeldChip points={pendingPoints} />");
  });

  it("does not ship claim FOMO or a green bonus banner", () => {
    for (const phrase of SIGNUP_MODAL_BANNED) {
      expect(signupSrc.includes(phrase)).toBe(false);
    }
    expect(signupSrc).not.toMatch(/text-green-|bg-green-/);
    expect(signupSrc).not.toMatch(/bonus PackPTS/i);
  });

  it("does not keep a Save Your Points claim button on Game Complete", () => {
    expect(gameSrc).not.toMatch(/Save Your/);
    expect(gameSrc).toContain("ANON_GATE_COPY.softCta");
    expect(gameSrc).toContain('data-testid="button-save-points"');
  });
});
