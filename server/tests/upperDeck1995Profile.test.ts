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
  it('rebuilds stale default-profile bakes and blocks the Design rejects and the non-base pool', () => {
    expect(PROFILE_REBUILD_SET_IDS).toContain(ID);
    const nums = BLOCKED_CARD_ID_RULES.filter(r => r.gameSetId === '3235b4fd').map(r => r.number).sort();
    for (const n of ['14', '132', '31', '145', '21', '30', '27', '140', '194']) expect(nums).toContain(n);
    expect(nums).toHaveLength(68);
  });
});

import sharp from 'sharp';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { verifyFixedBandRotations, FIXED_BAND_ROTATED_REASON } from '../masking/fixedBandRotatedCheck';
import { preparedMaskFile } from '../services/heldMaskPreparation';
import { CURRENT_MASK_VERSION } from '@shared/maskGeometry';

describe('fixed band rotated OCR and readiness', () => {
  it('refuses a surname read only at 90 or 270 degrees, passes a clean image, fails closed on timeout', async () => {
    const buf = await sharp({ create: { width: 70, height: 120, channels: 3, background: '#000' } }).jpeg().toBuffer();
    const seen: number[] = [];
    const vertical = await verifyFixedBandRotations({ buffer: buf, playerName: 'Charles Barkley', recognize: async (_b, w) => {
      seen.push(w); return { words: seen.length === 2 ? [{ text: 'BARKLEY', confidence: 90, x: 0, y: 0, w: 10, h: 10 }] : [], timedOut: false, ms: 1 } as any; } });
    expect(seen).toEqual([120, 120]);
    expect(vertical).toMatchObject({ ok: false, reason: FIXED_BAND_ROTATED_REASON });
    const clean = await verifyFixedBandRotations({ buffer: buf, playerName: 'Charles Barkley', recognize: async () => ({ words: [{ text: 'LAKERS', confidence: 90, x: 0, y: 0, w: 1, h: 1 }], timedOut: false, ms: 1 }) as any });
    expect(clean.ok).toBe(true);
    const slow = await verifyFixedBandRotations({ buffer: buf, playerName: 'Charles Barkley', recognize: async () => ({ words: [], timedOut: true, ms: 1 }) as any });
    expect(slow.ok).toBe(false);
  });
  it('treats an exact y83/h17 bake as ready for this set only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ud95-'));
    const card = '11111111-2222-4333-8444-555555555555';
    const stem = path.join(dir, `${card}_${CURRENT_MASK_VERSION}`);
    writeFileSync(`${stem}.ok`, '');
    writeFileSync(`${stem}.jpg`, 'x');
    writeFileSync(`${stem}.json`, JSON.stringify({ maskVersion: CURRENT_MASK_VERSION, layoutClass: 'BOTTOM_PLAQUE', regions: BAND }));
    expect(preparedMaskFile(card, dir, ID)).toBe(`${stem}.jpg`);
    expect(preparedMaskFile(card, dir)).toBeNull();
  });
  it('declares the 705x1200 base scan size', () => {
    expect(getMaskProfile(null, ID).baseSourceSize).toEqual({ width: 705, height: 1200 });
  });
});
