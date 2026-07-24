export const DAILY_GAMEPLAY_BASE = {
  CARDS_MAX_PER_DAY: 200,
  PTS_MAX_PER_DAY: 15000,
  // Absolute per-card ceiling AFTER all multipliers (incl. Set-of-the-Week).
  // Guards against an admin-set set multiplier pushing a single card far past
  // the intended per-award cap and inflating PackPTS liability. 250 base cap ×
  // a reasonable 2x featured bonus.
  PTS_MAX_PER_CARD: 500,
  
  dayKeyUTC: (d: Date = new Date()): string => {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },
  
  pointsForCardsCompleted: (c: number): number => {
    return Math.floor(15000 * Math.min(c, 200) / 200);
  }
};

export const POINTS_PER_CARD = 75;
