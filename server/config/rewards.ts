export const DAILY_GAMEPLAY_BASE = {
  CARDS_MAX_PER_DAY: 200,
  PTS_MAX_PER_DAY: 15000,
  
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
