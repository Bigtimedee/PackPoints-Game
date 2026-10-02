/**
 * Player-facing set title and year. Keyed by game set id.
 * This does not write the database. Stored set_name and year stay as they are.
 */
export interface SetDisplayOverride {
  title: string;
  yearLabel: string;
}

export const CHROME_BASKETBALL_2024_SET_ID = "229f0379-aa56-40a8-abe3-1af217a397e8";

export const SET_DISPLAY_OVERRIDES: Readonly<Record<string, SetDisplayOverride>> = {
  [CHROME_BASKETBALL_2024_SET_ID]: {
    title: "2024-25 Topps Chrome Basketball",
    yearLabel: "2024-25",
  },
};

export function setDisplayOverride(setId: string | null | undefined): SetDisplayOverride | null {
  if (!setId) return null;
  return SET_DISPLAY_OVERRIDES[setId] ?? null;
}

/** Stored title, unless this set has a display override. */
export function applySetDisplayTitle(setId: string | null | undefined, storedTitle: string | null | undefined): string {
  const override = setDisplayOverride(setId);
  if (override) return override.title;
  return (storedTitle || "").trim();
}

/** Year text players see. Override wins. Otherwise the stored year. */
export function applySetYearLabel(setId: string | null | undefined, year: number | null | undefined): string | null {
  const override = setDisplayOverride(setId);
  if (override) return override.yearLabel;
  if (typeof year !== "number" || !Number.isFinite(year)) return null;
  return String(Math.trunc(year));
}
