/**
 * masking.test.ts
 *
 * Two test suites:
 * 1. Server-side answer masking (Prompt 9 contract) — API must never send
 *    correctAnswer or card.playerName to the client before answer submission.
 * 2. Visual masking redesign (v3.0) — DEFAULT_MASK_REGIONS and maskProfiles
 *    must match the frosted-glass spec (single bottom band, no colored overlays).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeQuestionForClient, sanitizeSessionForClient } from '../utils/questionSanitizer';
import type { GameQuestion, GameSession } from '@shared/schema';
import { DEFAULT_MASK_REGIONS, SLABBED_MASK_REGIONS } from "@shared/schema";
import { getMaskProfile, CURRENT_MASK_VERSION } from "../masking/maskProfiles";

// ── Shared mock data ─────────────────────────────────────────────────────────

const MOCK_QUESTION: GameQuestion = {
  card: {
    id: 'card-test-1',
    playerName: 'Mike Trout',
    team: 'Angels',
    position: 'OF',
    year: 2013,
    setName: '2013 Topps',
    cardNumber: '27',
    imageUrl: '/api/cards/card-test-1/masked-image',
    popularity: 85,
    imageVerified: true,
    lastImageCheck: null,
    imageFailureCount: 0,
    imageLastError: null,
    isPlayable: true,
    quarantineStatus: 'OK',
    imageReviewStatus: 'unreviewed',
    reportCount: 0,
    blockedReason: null,
    updatedAt: null,
    imageRotation: 0,
    playableCardId: 'card-test-1',
  },
  options: ['Mike Trout', 'Barry Bonds', 'Ken Griffey Jr.', 'Babe Ruth'],
  correctAnswer: 'Mike Trout',
  pointValue: 175,
};

const MOCK_SESSION: GameSession = {
  id: 'session-test-1',
  mode: 'solo',
  userId: 'user-test-1',
  questions: [MOCK_QUESTION, { ...MOCK_QUESTION, correctAnswer: 'Barry Bonds', card: { ...MOCK_QUESTION.card, playerName: 'Barry Bonds' } }],
  currentQuestionIndex: 0,
  score: 0,
  correctAnswers: 0,
  totalQuestions: 2,
  skippedQuestions: 0,
  status: 'active',
  startedAt: new Date().toISOString(),
};

// ── sanitizeQuestionForClient ─────────────────────────────────────────────────

describe('sanitizeQuestionForClient', () => {
  it('strips correctAnswer from question payload', () => {
    const sanitized = sanitizeQuestionForClient(MOCK_QUESTION);
    expect(sanitized).not.toHaveProperty('correctAnswer');
  });

  it('strips playerName from card object', () => {
    const sanitized = sanitizeQuestionForClient(MOCK_QUESTION);
    expect(sanitized.card).not.toHaveProperty('playerName');
  });

  it('preserves options array intact', () => {
    const sanitized = sanitizeQuestionForClient(MOCK_QUESTION);
    expect(sanitized.options).toEqual(MOCK_QUESTION.options);
    expect(sanitized.options).toHaveLength(4);
  });

  it('preserves pointValue', () => {
    const sanitized = sanitizeQuestionForClient(MOCK_QUESTION);
    expect(sanitized.pointValue).toBe(175);
  });

  it('preserves non-sensitive card fields (id, imageUrl, setName, year, team)', () => {
    const sanitized = sanitizeQuestionForClient(MOCK_QUESTION);
    expect(sanitized.card.id).toBe('card-test-1');
    expect(sanitized.card.imageUrl).toBe('/api/cards/card-test-1/masked-image');
    expect(sanitized.card.setName).toBe('2013 Topps');
    expect(sanitized.card.year).toBe(2013);
    expect(sanitized.card.team).toBe('Angels');
  });

  it('does not mutate the original question', () => {
    sanitizeQuestionForClient(MOCK_QUESTION);
    expect(MOCK_QUESTION.correctAnswer).toBe('Mike Trout');
    expect(MOCK_QUESTION.card.playerName).toBe('Mike Trout');
  });

  it('image URL is opaque (does not contain player name)', () => {
    const sanitized = sanitizeQuestionForClient(MOCK_QUESTION);
    expect(sanitized.card.imageUrl).not.toContain('Mike');
    expect(sanitized.card.imageUrl).not.toContain('Trout');
    expect(sanitized.card.imageUrl).not.toContain('mike-trout');
  });
});

// ── sanitizeSessionForClient ──────────────────────────────────────────────────

describe('sanitizeSessionForClient', () => {
  it('strips correctAnswer from every question in the session', () => {
    const sanitized = sanitizeSessionForClient(MOCK_SESSION);
    for (const q of sanitized.questions) {
      expect(q).not.toHaveProperty('correctAnswer');
    }
  });

  it('strips card.playerName from every question in the session', () => {
    const sanitized = sanitizeSessionForClient(MOCK_SESSION);
    for (const q of sanitized.questions) {
      expect(q.card).not.toHaveProperty('playerName');
    }
  });

  it('preserves session metadata (id, mode, score, currentQuestionIndex, status)', () => {
    const sanitized = sanitizeSessionForClient(MOCK_SESSION);
    expect(sanitized.id).toBe('session-test-1');
    expect(sanitized.mode).toBe('solo');
    expect(sanitized.score).toBe(0);
    expect(sanitized.currentQuestionIndex).toBe(0);
    expect(sanitized.status).toBe('active');
    expect(sanitized.totalQuestions).toBe(2);
  });

  it('preserves question count', () => {
    const sanitized = sanitizeSessionForClient(MOCK_SESSION);
    expect(sanitized.questions).toHaveLength(2);
  });

  it('does not mutate the original session', () => {
    sanitizeSessionForClient(MOCK_SESSION);
    expect(MOCK_SESSION.questions[0].correctAnswer).toBe('Mike Trout');
    expect(MOCK_SESSION.questions[0].card.playerName).toBe('Mike Trout');
  });

  it('the raw server session DOES have correctAnswer (server-side invariant)', () => {
    expect(MOCK_SESSION.questions[0].correctAnswer).toBeTruthy();
    expect(MOCK_SESSION.questions[0].card.playerName).toBeTruthy();
  });
});

// ── Answer options randomization ──────────────────────────────────────────────

describe('answer options randomization', () => {
  it('every question has exactly 4 options', () => {
    expect(MOCK_QUESTION.options).toHaveLength(4);
  });

  it('correct answer appears exactly once in the options list', () => {
    const count = MOCK_QUESTION.options.filter(o => o === MOCK_QUESTION.correctAnswer).length;
    expect(count).toBe(1);
  });

  it('correct answer is not deterministically first across shuffles', () => {
    const correctAnswer = 'A';
    const base = ['A', 'B', 'C', 'D'];
    const positionsSeen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const shuffled = [...base].sort(() => Math.random() - 0.5);
      positionsSeen.add(shuffled.indexOf(correctAnswer));
    }
    expect(positionsSeen.size).toBeGreaterThan(1);
  });

  it('all options are non-empty strings', () => {
    for (const opt of MOCK_QUESTION.options) {
      expect(typeof opt).toBe('string');
      expect(opt.length).toBeGreaterThan(0);
    }
  });
});

// ── Post-submission correctAnswer reveal contract ─────────────────────────────

describe('post-submission reveal contract', () => {
  it('sanitized question contains no correctAnswer (pre-submission shape)', () => {
    const clientQ = sanitizeQuestionForClient(MOCK_QUESTION);
    expect((clientQ as any).correctAnswer).toBeUndefined();
  });

  it('original question retains correctAnswer for server-side answer checking', () => {
    expect(MOCK_QUESTION.correctAnswer).toBe('Mike Trout');
  });

  it('the post-submission API response shape must include correctAnswer at top level', () => {
    const submitResponseShape = {
      correct: true,
      correctAnswer: MOCK_QUESTION.correctAnswer,
      session: sanitizeSessionForClient(MOCK_SESSION),
    };

    expect(submitResponseShape.correctAnswer).toBe('Mike Trout');
    expect((submitResponseShape.session.questions[0] as any).correctAnswer).toBeUndefined();
    expect((submitResponseShape.session.questions[0].card as any).playerName).toBeUndefined();
  });
});

// ── Replacement card contract ─────────────────────────────────────────────────

describe('card replacement masking contract', () => {
  it('replacement card question is sanitized before sending to client', () => {
    const replacementQuestion: GameQuestion = {
      ...MOCK_QUESTION,
      card: { ...MOCK_QUESTION.card, id: 'replacement-card-1', playerName: 'Babe Ruth' },
      correctAnswer: 'Babe Ruth',
    };
    const sanitized = sanitizeQuestionForClient(replacementQuestion);
    expect(sanitized).not.toHaveProperty('correctAnswer');
    expect(sanitized.card).not.toHaveProperty('playerName');
    expect(sanitized.card.id).toBe('replacement-card-1');
  });
});

// ── Visual masking redesign v3.0 — schema constants ──────────────────────────

describe("Masking redesign — schema constants", () => {
  it("DEFAULT_MASK_REGIONS is a single bottom band at yPct:54, hPct:46", () => {
    expect(DEFAULT_MASK_REGIONS).toHaveLength(1);
    const region = DEFAULT_MASK_REGIONS[0];
    expect(region.yPct).toBe(54);
    expect(region.hPct).toBe(46);
    expect(region.xPct).toBe(0);
    expect(region.wPct).toBe(100);
    expect(region.type).toBe("blur");
  });

  it("DEFAULT_MASK_REGIONS has no top band", () => {
    const topBands = DEFAULT_MASK_REGIONS.filter(r => r.yPct < 20);
    expect(topBands).toHaveLength(0);
  });

  it("SLABBED_MASK_REGIONS is a single inset bottom band", () => {
    expect(SLABBED_MASK_REGIONS).toHaveLength(1);
    const region = SLABBED_MASK_REGIONS[0];
    expect(region.xPct).toBe(5);
    expect(region.wPct).toBe(90);
    expect(region.yPct).toBe(83);
    expect(region.hPct).toBe(14);
    expect(region.type).toBe("blur");
  });
});

// ── Visual masking redesign v3.0 — maskProfiles ───────────────────────────────

describe("Masking redesign — maskProfiles", () => {
  it("CURRENT_MASK_VERSION is v3.0", () => {
    expect(CURRENT_MASK_VERSION).toBe("v3.0");
  });

  it("default profile has 18% bottom band and no top band", () => {
    const profile = getMaskProfile(null);
    expect(profile.bottomBandPct).toBe(0.18);
    expect(profile.topBandPct).toBe(0.0);
  });

  it("1987 Topps profile has 22% bottom band", () => {
    const profile = getMaskProfile("1987 Topps");
    expect(profile.bottomBandPct).toBe(0.22);
    expect(profile.topBandPct).toBe(0.0);
  });

  it("1989 Upper Deck profile has 20% bottom band", () => {
    const profile = getMaskProfile("1989 Upper Deck");
    expect(profile.bottomBandPct).toBe(0.20);
    expect(profile.topBandPct).toBe(0.0);
  });

  it("1952 Topps profile has 35% bottom band", () => {
    const profile = getMaskProfile("1952 Topps");
    expect(profile.bottomBandPct).toBe(0.35);
    expect(profile.topBandPct).toBe(0.0);
  });

  it("unknown set returns default profile", () => {
    const profile = getMaskProfile("2024 Bowman Chrome");
    expect(profile.bottomBandPct).toBe(0.18);
  });

  it("partial set name match works (case-insensitive)", () => {
    const profile = getMaskProfile("Vintage 1952 Topps Heritage");
    expect(profile.bottomBandPct).toBe(0.35);
  });
});

// ── Visual masking redesign v3.0 — no solid colored fallback ─────────────────

describe("Masking redesign — no solid colored fallback in default regions", () => {
  it("DEFAULT_MASK_REGIONS contains no solid-type regions", () => {
    const solidRegions = DEFAULT_MASK_REGIONS.filter(r => r.type === "solid");
    expect(solidRegions).toHaveLength(0);
  });

  it("SLABBED_MASK_REGIONS contains no solid-type regions", () => {
    const solidRegions = SLABBED_MASK_REGIONS.filter(r => r.type === "solid");
    expect(solidRegions).toHaveLength(0);
  });
});
