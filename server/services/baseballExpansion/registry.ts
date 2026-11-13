/**
 * The 21 base baseball targets: Topps, Fleer, and Donruss 1986–1991, plus
 * Upper Deck 1989–1991. Five already have live ids. The other sixteen have
 * stable proposed ids that create may use only after the identity inventory
 * shows no active or inactive row.
 *
 * The sixteen missing targets have a verified published checklist length.
 * That length is the number cap. It is not a supplier candidate total, not a
 * game-eligible count, and not a clearance. No mask profile is registered
 * for them, and none of them are cleared.
 */
export const EXPANSION_NAMESPACE = "8f3c1a0e-7b21-4d5a-9e66-0c1b2a3d4e5f";

export interface ExpansionIdentity {
  sport: "baseball";
  brand: string;
  year: number;
  setName: string;
  cardhedgeSetQuery: string;
  cardhedgeCategory: "Baseball";
}

export interface ExpansionTarget {
  slug: string;
  id: string;
  /** live = public catalog id. missing = proposed id, not cleared. */
  role: "live" | "missing";
  identity: ExpansionIdentity;
  /**
   * Verified base-run length. Null means no number cap yet. Discovery import
   * may still run. Release stays closed until this is a verified count.
   */
  baseCount: number | null;
  /** Where baseCount came from. Null until a verified follow-up sets it. */
  baseCountProvenance: string | null;
}

const live = (
  slug: string,
  id: string,
  brand: string,
  year: number,
  baseCount: number | null,
): ExpansionTarget => ({
  slug,
  id,
  role: "live",
    baseCount,
    baseCountProvenance: baseCount == null ? null : "registry",
    identity: {
    sport: "baseball",
    brand,
    year,
    setName: `${year} ${brand} Baseball`,
    cardhedgeSetQuery: `${year} ${brand} Baseball`,
    cardhedgeCategory: "Baseball",
  },
});

const missing = (
  slug: string,
  id: string,
  brand: string,
  year: number,
  baseCount: number,
  baseCountProvenance: string,
): ExpansionTarget => ({
  ...live(slug, id, brand, year, baseCount),
  role: "missing",
  baseCountProvenance,
});

export const BASEBALL_EXPANSION_TARGETS: readonly ExpansionTarget[] = [
  live("1986-topps-baseball", "2b77043a-6583-4d79-b59d-d2ab20291a17", "Topps", 1986, 792),
  live("1987-topps-baseball", "37fd025d-2ae1-4c92-b8ad-133375d0c722", "Topps", 1987, null),
  live("1988-topps-baseball", "affd57b8-2b1d-4ea3-9f51-1530d8088e5c", "Topps", 1988, null),
  live("1989-topps-baseball", "352b33d1-c110-4e09-b641-8e3c02a94442", "Topps", 1989, null),
  missing("1990-topps-baseball", "97456b32-7b68-56fe-971a-1c821e2b09c4", "Topps", 1990, 792, "Published BASE checklist: https://baseballcardpedia.com/index.php/1990_Topps (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1991-topps-baseball", "14f17bb7-a697-5080-9ec5-381c6d7e15ce", "Topps", 1991, 792, "Published BASE checklist: https://baseballcardpedia.com/index.php/1991_Topps (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1986-fleer-baseball", "891b39b8-0058-5e55-9837-6e4830c55d32", "Fleer", 1986, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1986_Fleer (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1987-fleer-baseball", "1540603b-d6d0-5cd0-884b-9058c9830c13", "Fleer", 1987, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1987_Fleer (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1988-fleer-baseball", "cc78d8df-0502-5876-aab4-5d6a49f72899", "Fleer", 1988, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1988_Fleer (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1989-fleer-baseball", "855e8125-4169-5d0b-b04c-3513feae9637", "Fleer", 1989, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1989_Fleer (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1990-fleer-baseball", "7bb0e667-46ce-5cfe-a76c-a51044756725", "Fleer", 1990, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1990_Fleer (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1991-fleer-baseball", "49e656e0-3762-5113-82b5-1480f1c77541", "Fleer", 1991, 720, "Published BASE checklist: https://baseballcardpedia.com/index.php/1991_Fleer (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1986-donruss-baseball", "c54ed617-573d-5d95-9355-2feea73a7435", "Donruss", 1986, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1986_Donruss (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  live("1987-donruss-baseball", "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4", "Donruss", 1987, 660),
  missing("1988-donruss-baseball", "f690058c-3bde-51d4-a4e5-057b5d45478a", "Donruss", 1988, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1988_Donruss (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1989-donruss-baseball", "d6997c20-0880-5119-80d2-9ce8c9b4727e", "Donruss", 1989, 660, "Published BASE checklist: https://baseballcardpedia.com/index.php/1989_Donruss (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1990-donruss-baseball", "64130c7a-6b1a-533c-9575-1089f7adfdce", "Donruss", 1990, 716, "Published BASE checklist: https://baseballcardpedia.com/index.php/1990_Donruss (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1991-donruss-baseball", "e4f4a86e-3908-5e93-af8f-fd8462c25d97", "Donruss", 1991, 770, "Published BASE checklist: https://baseballcardpedia.com/index.php/1991_Donruss (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1989-upper-deck-baseball", "eb88c57e-cbd5-5d4b-a223-37b8fa8f99c2", "Upper Deck", 1989, 800, "Published BASE checklist: https://baseballcardpedia.com/index.php/1989_Upper_Deck (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1990-upper-deck-baseball", "72dc22b4-38e0-5f7a-8295-a7f5488a5e81", "Upper Deck", 1990, 800, "Published BASE checklist: https://baseballcardpedia.com/index.php/1990_Upper_Deck (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
  missing("1991-upper-deck-baseball", "cd597562-5b8f-5517-aca0-38b04f443747", "Upper Deck", 1991, 800, "Published BASE checklist: https://baseballcardpedia.com/index.php/1991_Upper_Deck (opened Nov8 2026; explicit set-size declaration, not supplier max card number)."),
];

const byId = new Map(BASEBALL_EXPANSION_TARGETS.map((target) => [target.id.toLowerCase(), target]));
const bySlug = new Map(BASEBALL_EXPANSION_TARGETS.map((target) => [target.slug, target]));

/**
 * 1991 Upper Deck is stopped. An active manifest cannot put it in Daily 5.
 * The id matches UD_1991_DISCOVERY. It stays here so this file does not import
 * the cohort module.
 */
export const DAILY5_EXCLUDED_EXPANSION_IDS: readonly string[] = [
  "cd597562-5b8f-5517-aca0-38b04f443747",
];

export function expansionTargetById(id: string | null | undefined): ExpansionTarget | null {
  if (!id) return null;
  return byId.get(id.trim().toLowerCase()) ?? null;
}

export function expansionTargetBySlug(slug: string | null | undefined): ExpansionTarget | null {
  if (!slug) return null;
  return bySlug.get(slug.trim().toLowerCase()) ?? null;
}

export function isDaily5ExpansionExcluded(id: string | null | undefined): boolean {
  if (!id) return false;
  return DAILY5_EXCLUDED_EXPANSION_IDS.includes(id.trim().toLowerCase());
}

export function missingExpansionTargets(): ExpansionTarget[] {
  return BASEBALL_EXPANSION_TARGETS.filter((target) => target.role === "missing");
}

export function isMissingExpansionId(id: string | null | undefined): boolean {
  const target = expansionTargetById(id);
  return target?.role === "missing";
}

/**
 * Static missing-list check. It does not read a release manifest.
 * Daily 5 enrollment is `daily5ExpansionSkipReason`: a missing id stays
 * blocked until an active release manifest is confirmed and the set is not
 * held. Unknown release or hold state stays blocked. 1991 Upper Deck stays
 * excluded even if a manifest row exists. Callers that cannot load that
 * state must keep treating a true result as blocked.
 */
export function isDaily5ExpansionBlocked(id: string | null | undefined): boolean {
  return isMissingExpansionId(id);
}

/** Shared text rejects. Not a numbered checklist. */
export const EXPANSION_PLAYER_DENYLIST: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(auto|autograph|signed|psa|bgs|sgc|relic|patch)\b/i, reason: "auto_slab_relic" },
];

export function fillConfigFromTarget(target: ExpansionTarget): {
  baseCount: number | null;
  baseCountProvenance: string | null;
  playerDenylist: { pattern: RegExp; reason: string }[];
  canonicalSet: string;
  createIdentity: ExpansionIdentity;
} {
  return {
    baseCount: target.baseCount,
    baseCountProvenance: target.baseCountProvenance,
    playerDenylist: EXPANSION_PLAYER_DENYLIST,
    canonicalSet: target.identity.setName,
    createIdentity: target.identity,
  };
}

export function expansionFillConfigs(): Record<string, ReturnType<typeof fillConfigFromTarget>> {
  const out: Record<string, ReturnType<typeof fillConfigFromTarget>> = {};
  for (const target of missingExpansionTargets()) out[target.id] = fillConfigFromTarget(target);
  return out;
}
