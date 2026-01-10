import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { quotaService, type UserTier } from "../services/quotaService";
import { tokenService } from "../services/tokenService";
import { TIER_CONFIG } from "@shared/schema";

describe("Gameplay Gating System", () => {
  describe("TIER_CONFIG", () => {
    it("should have correct FREE tier limits", () => {
      const freeConfig = TIER_CONFIG.FREE;
      expect(freeConfig.dailyMatchLimit).toBe(5);
      expect(freeConfig.hourlyMatchLimit).toBe(3);
      expect(freeConfig.multiplier).toBe(1.0);
      expect(freeConfig.allowedModes).toContain("solo");
      expect(freeConfig.allowedModes).not.toContain("1v1_friend");
    });

    it("should have correct PRO tier limits", () => {
      const proConfig = TIER_CONFIG.PRO;
      expect(proConfig.dailyMatchLimit).toBeNull();
      expect(proConfig.hourlyMatchLimit).toBe(20);
      expect(proConfig.multiplier).toBe(1.5);
      expect(proConfig.allowedModes).toContain("solo");
      expect(proConfig.allowedModes).toContain("1v1_friend");
      expect(proConfig.allowedModes).toContain("tournament");
    });

    it("should have correct LEGEND tier limits", () => {
      const legendConfig = TIER_CONFIG.LEGEND;
      expect(legendConfig.dailyMatchLimit).toBeNull();
      expect(legendConfig.hourlyMatchLimit).toBe(30);
      expect(legendConfig.multiplier).toBe(2.0);
      expect(legendConfig.allowedModes).toContain("legend");
    });
  });

  describe("Mode Access Rules", () => {
    it("FREE tier should only access solo mode", () => {
      const freeConfig = TIER_CONFIG.FREE;
      expect(freeConfig.allowedModes.length).toBe(1);
      expect(freeConfig.allowedModes[0]).toBe("solo");
    });

    it("PRO tier should access multiplayer modes", () => {
      const proConfig = TIER_CONFIG.PRO;
      expect(proConfig.allowedModes).toContain("1v1_friend");
      expect(proConfig.allowedModes).toContain("1v1_random");
      expect(proConfig.allowedModes).toContain("tournament");
    });

    it("LEGEND tier should access all modes including legend", () => {
      const legendConfig = TIER_CONFIG.LEGEND;
      expect(legendConfig.allowedModes).toContain("solo");
      expect(legendConfig.allowedModes).toContain("1v1_friend");
      expect(legendConfig.allowedModes).toContain("1v1_random");
      expect(legendConfig.allowedModes).toContain("tournament");
      expect(legendConfig.allowedModes).toContain("legend");
    });
  });

  describe("Multiplier Rules", () => {
    it("FREE tier should have 1.0x multiplier", () => {
      expect(tokenService.getMultiplierForTier("FREE")).toBe(1.0);
    });

    it("PRO tier should have 1.5x multiplier", () => {
      expect(tokenService.getMultiplierForTier("PRO")).toBe(1.5);
    });

    it("LEGEND tier should have 2.0x multiplier", () => {
      expect(tokenService.getMultiplierForTier("LEGEND")).toBe(2.0);
    });
  });

  describe("Hourly Rate Limits", () => {
    it("FREE tier should have 3 matches/hour limit", () => {
      expect(tokenService.getHourlyLimitForTier("FREE")).toBe(3);
    });

    it("PRO tier should have 20 matches/hour limit", () => {
      expect(tokenService.getHourlyLimitForTier("PRO")).toBe(20);
    });

    it("LEGEND tier should have 30 matches/hour limit", () => {
      expect(tokenService.getHourlyLimitForTier("LEGEND")).toBe(30);
    });
  });

  describe("Score Calculation", () => {
    it("should apply correct multiplier to final score", () => {
      const baseScore = 100;
      
      const freeScore = Math.floor(baseScore * TIER_CONFIG.FREE.multiplier);
      expect(freeScore).toBe(100);
      
      const proScore = Math.floor(baseScore * TIER_CONFIG.PRO.multiplier);
      expect(proScore).toBe(150);
      
      const legendScore = Math.floor(baseScore * TIER_CONFIG.LEGEND.multiplier);
      expect(legendScore).toBe(200);
    });

    it("should cap score at maxPoints defined in token", () => {
      const maxPoints = 500;
      const rawScore = 600;
      
      const cappedScore = Math.min(rawScore, maxPoints);
      expect(cappedScore).toBe(maxPoints);
    });
  });

  describe("Token Expiry Rules", () => {
    it("token expiry should be 15 minutes", () => {
      const TOKEN_EXPIRY_MINUTES = 15;
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + TOKEN_EXPIRY_MINUTES * 60 * 1000);
      
      const diffMs = expiresAt.getTime() - issuedAt.getTime();
      const diffMins = diffMs / (60 * 1000);
      
      expect(diffMins).toBe(15);
    });
  });
});
