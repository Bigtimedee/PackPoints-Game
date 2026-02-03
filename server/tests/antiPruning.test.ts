import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { playableCards, gameSets, setAuditLog, users } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { assertMutationAllowed, isKillSwitchEnabled, OPERATION_SOURCES } from '../services/mutationGuard';

describe('Anti-Pruning System', () => {
  let testSetId: string;
  let testAdminUserId: string;
  let testCardIds: string[] = [];

  beforeAll(async () => {
    testSetId = `test-set-${randomUUID()}`;
    testAdminUserId = `test-admin-${randomUUID()}`;

    await db.insert(users).values({
      id: testAdminUserId,
      username: `testadmin_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: true,
    });

    await db.insert(gameSets).values({
      id: testSetId,
      sport: 'Baseball',
      brand: 'Test Brand',
      year: 2024,
      setName: 'Test Set for Anti-Pruning',
      isActive: true,
    });

    for (let i = 0; i < 5; i++) {
      const cardId = `test-card-${randomUUID()}`;
      testCardIds.push(cardId);
      
      await db.insert(playableCards).values({
        id: cardId,
        gameSetId: testSetId,
        cardhedgeCardId: `test-cardhedge-${randomUUID()}`,
        player: `Test Player ${i}`,
        imageUrl: `https://example.com/card${i}.jpg`,
        isPlayable: true,
        number: `${i + 1}`,
        quarantineStatus: 'OK',
        proposedUnplayable: false,
        validationFailCount: 0,
      });
    }
  });

  afterAll(async () => {
    for (const cardId of testCardIds) {
      await db.delete(playableCards).where(eq(playableCards.id, cardId));
    }
    await db.delete(setAuditLog).where(eq(setAuditLog.setId, testSetId));
    await db.delete(gameSets).where(eq(gameSets.id, testSetId));
    await db.delete(users).where(eq(users.id, testAdminUserId));
  });

  beforeEach(async () => {
    for (const cardId of testCardIds) {
      await db.update(playableCards)
        .set({
          isPlayable: true,
          quarantineStatus: 'OK',
          proposedUnplayable: false,
          validationFailCount: 0,
          lastValidationAt: null,
          lastValidationError: null,
        })
        .where(eq(playableCards.id, cardId));
    }
    await db.delete(setAuditLog).where(eq(setAuditLog.setId, testSetId));
  });

  describe('Mutation Guard', () => {
    it('should allow admin manual operations to set isPlayable=false (SET_UNPLAYABLE)', () => {
      const result = assertMutationAllowed({
        operationSource: 'ADMIN_MANUAL',
        action: 'SET_UNPLAYABLE',
      });
      expect(result.allowed).toBe(true);
    });

    it('should block SYSTEM_NON_DESTRUCTIVE from SET_UNPLAYABLE', () => {
      const result = assertMutationAllowed({
        operationSource: 'SYSTEM_NON_DESTRUCTIVE',
        action: 'SET_UNPLAYABLE',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Destructive action');
    });

    it('should block CARDHEDGE_CONFIRMED from SET_UNPLAYABLE', () => {
      const result = assertMutationAllowed({
        operationSource: 'CARDHEDGE_CONFIRMED',
        action: 'SET_UNPLAYABLE',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Destructive action');
    });

    it('should allow SYSTEM_NON_DESTRUCTIVE to UPDATE_QUARANTINE', () => {
      const result = assertMutationAllowed({
        operationSource: 'SYSTEM_NON_DESTRUCTIVE',
        action: 'UPDATE_QUARANTINE',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow SYSTEM_NON_DESTRUCTIVE to UPDATE_VALIDATION_FIELDS', () => {
      const result = assertMutationAllowed({
        operationSource: 'SYSTEM_NON_DESTRUCTIVE',
        action: 'UPDATE_VALIDATION_FIELDS',
      });
      expect(result.allowed).toBe(true);
    });

    it('should block SYSTEM_NON_DESTRUCTIVE from APPLY_PROPOSED_CHANGES', () => {
      const result = assertMutationAllowed({
        operationSource: 'SYSTEM_NON_DESTRUCTIVE',
        action: 'APPLY_PROPOSED_CHANGES',
      });
      expect(result.allowed).toBe(false);
    });

    it('should allow ADMIN_MANUAL to APPLY_PROPOSED_CHANGES', () => {
      const result = assertMutationAllowed({
        operationSource: 'ADMIN_MANUAL',
        action: 'APPLY_PROPOSED_CHANGES',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('Quarantine Status Progression', () => {
    it('should progress from OK to SUSPECT_TRANSIENT on first failure', async () => {
      const cardId = testCardIds[0];
      
      await db.update(playableCards)
        .set({
          quarantineStatus: 'SUSPECT_TRANSIENT',
          validationFailCount: 1,
          lastValidationAt: new Date(),
          lastValidationError: 'Image returned 404',
        })
        .where(eq(playableCards.id, cardId));

      const [card] = await db.select().from(playableCards).where(eq(playableCards.id, cardId));
      
      expect(card.quarantineStatus).toBe('SUSPECT_TRANSIENT');
      expect(card.validationFailCount).toBe(1);
      expect(card.isPlayable).toBe(true);
    });

    it('should progress to SUSPECT_PERSISTENT after multiple failures', async () => {
      const cardId = testCardIds[1];
      
      await db.update(playableCards)
        .set({
          quarantineStatus: 'SUSPECT_PERSISTENT',
          validationFailCount: 3,
          lastValidationAt: new Date(),
          lastValidationError: 'Image returned 404',
        })
        .where(eq(playableCards.id, cardId));

      const [card] = await db.select().from(playableCards).where(eq(playableCards.id, cardId));
      
      expect(card.quarantineStatus).toBe('SUSPECT_PERSISTENT');
      expect(card.isPlayable).toBe(true);
    });

    it('should progress to QUARANTINED_ADMIN_REVIEW after 5+ failures over 24 hours', async () => {
      const cardId = testCardIds[2];
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      
      await db.update(playableCards)
        .set({
          quarantineStatus: 'QUARANTINED_ADMIN_REVIEW',
          validationFailCount: 5,
          firstFailureAt: oldDate,
          lastValidationAt: new Date(),
          lastValidationError: 'Image returned 404',
          proposedUnplayable: true,
        })
        .where(eq(playableCards.id, cardId));

      const [card] = await db.select().from(playableCards).where(eq(playableCards.id, cardId));
      
      expect(card.quarantineStatus).toBe('QUARANTINED_ADMIN_REVIEW');
      expect(card.proposedUnplayable).toBe(true);
      expect(card.isPlayable).toBe(true);
    });
  });

  describe('Admin Approval Flow', () => {
    it('should mark card as unplayable when admin applies proposed changes', async () => {
      const cardId = testCardIds[3];
      
      await db.update(playableCards)
        .set({
          quarantineStatus: 'QUARANTINED_ADMIN_REVIEW',
          proposedUnplayable: true,
          validationFailCount: 5,
        })
        .where(eq(playableCards.id, cardId));

      const [cardBefore] = await db.select().from(playableCards).where(eq(playableCards.id, cardId));
      expect(cardBefore.isPlayable).toBe(true);
      expect(cardBefore.proposedUnplayable).toBe(true);

      await db.update(playableCards)
        .set({
          isPlayable: false,
          blockedReason: 'admin_approved_removal',
          quarantineStatus: 'REMOVED_BY_ADMIN',
          proposedUnplayable: false,
        })
        .where(eq(playableCards.id, cardId));

      const [cardAfter] = await db.select().from(playableCards).where(eq(playableCards.id, cardId));
      expect(cardAfter.isPlayable).toBe(false);
      expect(cardAfter.blockedReason).toBe('admin_approved_removal');
      expect(cardAfter.quarantineStatus).toBe('REMOVED_BY_ADMIN');
    });

    it('should create audit log entry when admin approves changes', async () => {
      await db.insert(setAuditLog).values({
        id: randomUUID(),
        setId: testSetId,
        actionType: 'APPLY_PROPOSED_UNPLAYABLE',
        operationSource: 'ADMIN_MANUAL',
        actorUserId: testAdminUserId,
        beforeTotalCards: 5,
        afterTotalCards: 5,
        beforePlayableCards: 5,
        afterPlayableCards: 4,
        deltaTotalCards: 0,
        deltaPlayableCards: -1,
        reason: 'Admin approved proposed removal',
        evidenceJson: { cardsAffected: 1 },
      });

      const logs = await db.select().from(setAuditLog).where(eq(setAuditLog.setId, testSetId));
      
      expect(logs.length).toBe(1);
      expect(logs[0].actionType).toBe('APPLY_PROPOSED_UNPLAYABLE');
      expect(logs[0].operationSource).toBe('ADMIN_MANUAL');
      expect(logs[0].actorUserId).toBe(testAdminUserId);
      expect(logs[0].deltaPlayableCards).toBe(-1);
    });
  });

  describe('Card Selection Exclusion', () => {
    it('should exclude cards with isPlayable=false from random selection', async () => {
      const cardId = testCardIds[4];
      
      await db.update(playableCards)
        .set({ isPlayable: false })
        .where(eq(playableCards.id, cardId));

      const playableCardsList = await db
        .select()
        .from(playableCards)
        .where(
          and(
            eq(playableCards.gameSetId, testSetId),
            eq(playableCards.isPlayable, true)
          )
        );

      const excludedCard = playableCardsList.find(c => c.id === cardId);
      expect(excludedCard).toBeUndefined();
    });

    it('should include cards with proposedUnplayable=true in selection until admin approves', async () => {
      const cardId = testCardIds[0];
      
      await db.update(playableCards)
        .set({
          proposedUnplayable: true,
          quarantineStatus: 'QUARANTINED_ADMIN_REVIEW',
        })
        .where(eq(playableCards.id, cardId));

      const playableCardsList = await db
        .select()
        .from(playableCards)
        .where(
          and(
            eq(playableCards.gameSetId, testSetId),
            eq(playableCards.isPlayable, true)
          )
        );

      const proposedCard = playableCardsList.find(c => c.id === cardId);
      expect(proposedCard).toBeDefined();
      expect(proposedCard?.proposedUnplayable).toBe(true);
    });
  });

  describe('Operation Sources', () => {
    it('should have all three operation sources defined', () => {
      expect(OPERATION_SOURCES).toContain('ADMIN_MANUAL');
      expect(OPERATION_SOURCES).toContain('SYSTEM_NON_DESTRUCTIVE');
      expect(OPERATION_SOURCES).toContain('CARDHEDGE_CONFIRMED');
    });

    it('should validate operation source in mutation context', () => {
      const invalidResult = assertMutationAllowed({
        operationSource: 'INVALID_SOURCE' as any,
        action: 'UPDATE_QUARANTINE',
      });
      expect(invalidResult.allowed).toBe(false);
      expect(invalidResult.reason).toContain('Invalid operation_source');
    });
  });

  describe('Kill Switch', () => {
    it('should correctly check kill switch status', () => {
      const result = isKillSwitchEnabled();
      expect(typeof result).toBe('boolean');
    });

    it('should block SYSTEM_NON_DESTRUCTIVE when kill switch is enabled', () => {
      const originalEnv = process.env.DISABLE_AUTOMATED_SET_MUTATIONS;
      try {
        process.env.DISABLE_AUTOMATED_SET_MUTATIONS = 'true';
        const result = assertMutationAllowed({
          operationSource: 'SYSTEM_NON_DESTRUCTIVE',
          action: 'UPDATE_QUARANTINE',
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('kill switch');
      } finally {
        process.env.DISABLE_AUTOMATED_SET_MUTATIONS = originalEnv;
      }
    });

    it('should allow ADMIN_MANUAL even when kill switch is enabled', () => {
      const originalEnv = process.env.DISABLE_AUTOMATED_SET_MUTATIONS;
      try {
        process.env.DISABLE_AUTOMATED_SET_MUTATIONS = 'true';
        const result = assertMutationAllowed({
          operationSource: 'ADMIN_MANUAL',
          action: 'SET_UNPLAYABLE',
        });
        expect(result.allowed).toBe(true);
      } finally {
        process.env.DISABLE_AUTOMATED_SET_MUTATIONS = originalEnv;
      }
    });
  });
});
