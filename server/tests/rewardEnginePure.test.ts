/**
 * rewardEnginePure.test.ts — Prompt 10 (pure-function subset)
 *
 * Tests computeBasePts, getVintageMultiplier, getRarityMultiplier, and
 * computeFinalPts without a database connection. vi.mock neutralizes the
 * db import inside rewardEngine.ts so these pass in any environment.
 */
import { vi, describe, it, expect } from 'vitest';

// Must hoist before any import that pulls in rewardEngine or db
vi.mock('../db', () => ({ db: {}, pool: {} }));

import {
  computeBasePts,
  getVintageMultiplier,
  getRarityMultiplier,
  computeFinalPts,
} from '../services/rewardEngine';
import type { RewardPolicy } from '@shared/schema';

// ── Shared mock policy ────────────────────────────────────────────────────────

const POLICY: RewardPolicy = {
  id: 'test-policy',
  effectiveFrom: new Date(),
  enabled: true,
  minPts: 100,
  maxPts: 200,
  gamma: 2.0,
  maxAwardCap: 250,
  vintageMultipliers: { pre1980: 1.15, '1980_1999': 1.05, '2000_2019': 1.0, '2020_plus': 0.9 },
  rarityMultipliers: { base: 1.0, insert: 1.1, parallel: 1.2, sp: 1.3 },
  dailyPointsCap: 5000,
  perMatchPointsCap: 1000,
  createdAt: new Date(),
};

// ── computeBasePts ────────────────────────────────────────────────────────────
// Formula: Math.round(minPts + (maxPts - minPts) * (1 - fame^gamma))

describe('computeBasePts', () => {
  it('fame=0 (completely obscure) yields maxPts', () => {
    // 100 + 100 * (1 - 0^2) = 200
    expect(computeBasePts(0.0, POLICY)).toBe(200);
  });

  it('fame=1 (maximally famous) yields minPts', () => {
    // 100 + 100 * (1 - 1^2) = 100
    expect(computeBasePts(1.0, POLICY)).toBe(100);
  });

  it('fame=0.5 applies gamma=2 curve correctly', () => {
    // 100 + 100 * (1 - 0.25) = 175
    expect(computeBasePts(0.5, POLICY)).toBe(175);
  });

  it('fame=0.1 (obscure) yields near-maxPts', () => {
    // 100 + 100 * (1 - 0.01) = 199
    expect(computeBasePts(0.1, POLICY)).toBe(199);
  });

  it('fame=0.9 (famous) yields near-minPts', () => {
    // 100 + 100 * (1 - 0.81) = 119
    expect(computeBasePts(0.9, POLICY)).toBe(119);
  });

  it('negative fame clamped to 0 (fully obscure)', () => {
    expect(computeBasePts(-0.5, POLICY)).toBe(200);
  });

  it('fame > 1 clamped to 1 (fully famous)', () => {
    expect(computeBasePts(1.5, POLICY)).toBe(100);
  });

  it('result is always an integer', () => {
    expect(computeBasePts(0.33, POLICY) % 1).toBe(0);
  });

  it('famous player earns fewer points than obscure player (inverse curve)', () => {
    expect(computeBasePts(0.1, POLICY)).toBeGreaterThan(computeBasePts(0.9, POLICY));
  });
});

// ── getVintageMultiplier ──────────────────────────────────────────────────────

describe('getVintageMultiplier', () => {
  it('undefined year → 1.0 (no bonus)', () => {
    expect(getVintageMultiplier(undefined, POLICY)).toBe(1.0);
  });

  it('1952 → pre-1980 premium (1.15)', () => {
    expect(getVintageMultiplier(1952, POLICY)).toBe(1.15);
  });

  it('1979 → pre-1980 upper boundary (1.15)', () => {
    expect(getVintageMultiplier(1979, POLICY)).toBe(1.15);
  });

  it('1980 → 1980-1999 lower boundary (1.05)', () => {
    expect(getVintageMultiplier(1980, POLICY)).toBe(1.05);
  });

  it('1999 → 1980-1999 upper boundary (1.05)', () => {
    expect(getVintageMultiplier(1999, POLICY)).toBe(1.05);
  });

  it('2000 → 2000-2019 lower boundary (1.0)', () => {
    expect(getVintageMultiplier(2000, POLICY)).toBe(1.0);
  });

  it('2019 → 2000-2019 upper boundary (1.0)', () => {
    expect(getVintageMultiplier(2019, POLICY)).toBe(1.0);
  });

  it('2020 → modern-era reduction (0.9)', () => {
    expect(getVintageMultiplier(2020, POLICY)).toBe(0.9);
  });

  it('2024 → modern-era reduction (0.9)', () => {
    expect(getVintageMultiplier(2024, POLICY)).toBe(0.9);
  });
});

// ── getRarityMultiplier ───────────────────────────────────────────────────────

describe('getRarityMultiplier', () => {
  it('undefined rarityType → 1.0 (no bonus)', () => {
    expect(getRarityMultiplier(undefined, POLICY)).toBe(1.0);
  });

  it('"base" → 1.0', () => {
    expect(getRarityMultiplier('base', POLICY)).toBe(1.0);
  });

  it('"insert" → 1.1', () => {
    expect(getRarityMultiplier('insert', POLICY)).toBe(1.1);
  });

  it('"parallel" → 1.2', () => {
    expect(getRarityMultiplier('parallel', POLICY)).toBe(1.2);
  });

  it('"sp" → 1.3 (rarest premium)', () => {
    expect(getRarityMultiplier('sp', POLICY)).toBe(1.3);
  });

  it('unknown string falls back to base (1.0)', () => {
    expect(getRarityMultiplier('legendary', POLICY)).toBe(1.0);
  });
});

// ── computeFinalPts ───────────────────────────────────────────────────────────

describe('computeFinalPts', () => {
  it('unit multipliers pass basePts through unchanged', () => {
    expect(computeFinalPts(150, 1.0, 1.0, POLICY)).toBe(150);
  });

  it('applies vintage × rarity multiplicatively before rounding', () => {
    // 150 * 1.05 * 1.1 = 173.25 → Math.round = 173
    expect(computeFinalPts(150, 1.05, 1.1, POLICY)).toBe(173);
  });

  it('maxAwardCap clamps a high-value combination', () => {
    // 200 * 1.15 * 1.3 = 299 → clamped to 250
    expect(computeFinalPts(200, 1.15, 1.3, POLICY)).toBe(250);
  });

  it('minPts floor prevents result from going below minimum', () => {
    // Artificially low basePts: 30 → floored to minPts(100)
    expect(computeFinalPts(30, 1.0, 1.0, POLICY)).toBe(100);
  });

  it('result within [minPts, maxAwardCap] passes through unchanged', () => {
    const result = computeFinalPts(150, 1.0, 1.0, POLICY);
    expect(result).toBeGreaterThanOrEqual(POLICY.minPts);
    expect(result).toBeLessThanOrEqual(POLICY.maxAwardCap);
  });

  it('result is always an integer', () => {
    expect(computeFinalPts(155, 1.05, 1.1, POLICY) % 1).toBe(0);
  });
});
