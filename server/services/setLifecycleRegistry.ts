import type { MaskProfile } from '../masking/maskProfiles';
export type LifecycleRegistryRow = { setId: string; identity: string; revision: string; profile: MaskProfile | null; published: boolean };
let rows = new Map<string, LifecycleRegistryRow>();
export function replaceLifecycleRegistry(next: LifecycleRegistryRow[]) { rows = new Map(next.map(row => [row.setId, row])); }
export function lifecycleSet(setId?: string | null) { return setId ? rows.get(setId) : undefined; }
export function lifecycleProfile(setId?: string | null) { return lifecycleSet(setId)?.profile ?? undefined; }
