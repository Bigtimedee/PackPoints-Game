import { describe, expect, it, vi } from 'vitest';
vi.mock('../masking/maskPlanStore', () => ({ readWarmMaskPlan: () => null }));
import { sanitizeQuestionForClient, sanitizeSessionForClient } from '../utils/questionSanitizer';

const q = (answered: boolean, userAnswer?: string) => ({
  card: { id: 'c1', playableCardId: 'p1', gameSetId: 's', imageRotation: 0 },
  options: ['A', 'B', 'C', 'D'], correctAnswer: 'B', pointValue: 10,
  ...(answered ? { answered: true, userAnswer } : {}),
}) as any;

describe('Solo recovery highlight wire shape', () => {
  it('sends stored pick and correct option only for answered Solo questions', () => {
    const s = sanitizeSessionForClient({ id: 'r', questions: [q(true, 'C'), q(false)] } as any);
    expect(s.questions[0]).toMatchObject({ answered: true, userAnswer: 'C', correctAnswer: 'B' });
    expect(s.questions[1]).not.toHaveProperty('correctAnswer');
    expect(s.questions[1]).not.toHaveProperty('userAnswer');
    expect(s.questions[1].card).not.toHaveProperty('revealUrl');
  });
  it('never sends the correct option outside Solo, even when answered', () => {
    for (const scope of ['match', 'd5', 'ad5'] as const) {
      const out = sanitizeQuestionForClient(q(true, 'B'), { scope: scope as any, sessionId: 'r', index: 0 });
      expect(out).not.toHaveProperty('correctAnswer');
    }
  });
});
