/** Pure identity match. Active and inactive rows both count. */
export interface IdentityRow {
  id: string;
  sport: string;
  year: number;
  brand: string;
  setName: string;
  isActive: boolean;
  isUserCreated: boolean;
  cards: number;
}

export function squashName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function namesCollide(left: string, right: string): boolean {
  const a = squashName(left);
  const b = squashName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function collidingIdentities(
  target: { sport: string; year: number; brand: string; setName: string },
  rows: readonly IdentityRow[],
  proposedId: string,
): IdentityRow[] {
  const sport = squashName(target.sport);
  const brand = squashName(target.brand);
  const proposed = proposedId.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.id.trim().toLowerCase() === proposed) return false;
    if (row.isUserCreated) return false;
    if (squashName(row.sport) !== sport) return false;
    if (row.year !== target.year) return false;
    if (squashName(row.brand) !== brand) return false;
    return namesCollide(row.setName, target.setName);
  });
}
