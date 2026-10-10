import { afterEach, describe, expect, it } from 'vitest';
import { getMaskProfile, MASK_LAYOUT_SET_IDS, profileIsRegistered } from '../masking/maskProfiles';
import { resolveNameMaskPlan } from '../masking/nameLocalization';
import { PROFILE_REBUILD_SET_IDS } from '../masking/maskCachePurge';
import { BLOCKED_CARD_ID_RULES } from '../lib/cardBlocklist';
import { replaceLifecycleRegistry } from '../services/setLifecycleRegistry';

const ID = '3235b4fd-858a-424b-b9df-6f0f2d070d1b';
const BAND = [{ xPct: 0, yPct: 83, wPct: 100, hPct: 17, type: 'blur', radiusPct: 0 }];
afterEach(() => replaceLifecycleRegistry([]));

describe('1995-96 Upper Deck Basketball profile', () => {
  it('is keyed to the set id and the basketball/1995/upper deck hint', () => {
    expect(MASK_LAYOUT_SET_IDS.upperDeckBasketball1995).toBe(ID);
    for (const p of [getMaskProfile(null, ID), getMaskProfile('1995-96 Upper Deck Basketball'), getMaskProfile('1995 Upper Deck Basketball')]) {
      expect(p.id).toBe('1995-upper-deck-bb');
      expect(p.fixedNameBand).toBe(true);
      expect(p.regions).toEqual(BAND);
      expect(profileIsRegistered(p, ID)).toBe(true);
    }
    expect(getMaskProfile('1995 Upper Deck Baseball').id).not.toBe('1995-upper-deck-bb');
    expect(getMaskProfile('1995 Upper Deck').id).not.toBe('1995-upper-deck-bb');
  });
  it('keeps the exact band and refuses an off-band surname', () => {
    const base = { playerName: 'Muggsy Bogues', gameSetId: ID, setHint: '1995 Upper Deck Basketball', imageWidth: 705, imageHeight: 1200 };
    const inBand = resolveNameMaskPlan({ ...base, words: [{ text: 'Bogues', confidence: 95, x: 100, y: 1040, w: 200, h: 50 }], plateBox: { x: 0, y: 1100, w: 705, h: 60 } });
    expect(inBand.regions).toEqual(BAND);
    expect(inBand.namePlateUnresolved).toBe(false);
    const off = resolveNameMaskPlan({ ...base, words: [{ text: 'Bogues', confidence: 95, x: 640, y: 300, w: 50, h: 300 }] });
    expect(off.regions).toEqual(BAND);
    expect(off.namePlateUnresolved).toBe(true);
  });
  it('rebuilds stale default-profile bakes and blocks the four Design rejects only', () => {
    expect(PROFILE_REBUILD_SET_IDS).toContain(ID);
    const nums = BLOCKED_CARD_ID_RULES.filter(r => r.gameSetId === '3235b4fd').map(r => r.number).sort();
    expect(nums).toEqual(['132', '14', '145', '31']);
  });
});
