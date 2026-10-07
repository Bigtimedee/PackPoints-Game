import { createHash } from 'crypto';
import { CURRENT_MASK_VERSION } from '@shared/maskGeometry';
import type { MaskProfile } from '../masking/maskProfiles';
export type SetIdentity = { year: number; brand: string; sport: string; setName: string };
export type CardWitness = { cardId: string; setId: string; player: string; number: string | null; imageUrl: string; imageRotation: number };
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const identityKey = (identity: SetIdentity) => JSON.stringify([identity.year, identity.brand, identity.sport, identity.setName]);
export const witnessKey = (card: CardWitness, revision: string) => digest(JSON.stringify([card.cardId, card.setId, card.player, card.number, card.imageUrl, card.imageRotation, revision, CURRENT_MASK_VERSION]));
export const profileRevision = (identity: SetIdentity, profile: MaskProfile) => digest(JSON.stringify([identityKey(identity), profile, CURRENT_MASK_VERSION]));
/** Only simple edge-name layouts are authorable here. Unsupported slabs/diagonal/multi-name art fails closed. */
export function customBandProfile(value: unknown): MaskProfile | null {
  if (!value || typeof value !== 'object') return null;
  const { edge, height } = value as { edge?: unknown; height?: unknown };
  if ((edge !== 'top' && edge !== 'bottom') || typeof height !== 'number' || !Number.isFinite(height) || height < 5 || height > (edge === 'top' ? 35 : 55)) return null;
  return { id: `admin-${edge}-${height}`, matched: true, nameAnchor: edge, layoutClass: edge === 'top' ? 'TOP_PLATE' : 'BOTTOM_PLAQUE',
    cardOrientation: 'portrait', sidewaysFallbackDeg: 0, topBandPct: edge === 'top' ? height / 100 : 0,
    bottomBandPct: edge === 'bottom' ? height / 100 : 0, leftBandPct: 0, rightBandPct: 0, blurSigma: 25,
    regions: [{ xPct: 0, yPct: edge === 'top' ? 0 : 100 - height, wPct: 100, hPct: height, type: 'blur', radiusPct: 0 }], trustProfileBand: false };
}
export function validHash(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
export function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function reviewMatches(witness: { key: string; sourceHash: string; previewHash: string }, submitted: unknown): boolean {
  if (!submitted || typeof submitted !== 'object') return false;
  const v = submitted as Record<string, unknown>;
  return validHash(v.key) && validHash(v.sourceHash) && validHash(v.previewHash)
    && v.key === witness.key && v.sourceHash === witness.sourceHash && v.previewHash === witness.previewHash;
}
