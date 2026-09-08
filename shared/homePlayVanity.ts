/**
 * Home play-vanity gate (Design HOME_VANITY_QUARANTINE).
 * Total Games Played / Cards Guessed stay off home until volume is real
 * or staff explicitly overrides. Do not invent counts or show placeholders.
 */

export const HOME_PLAY_VANITY_MIN_GAMES = 500;
export const HOME_PLAY_VANITY_FLAG = "home.show_play_vanity";

export function shouldShowHomePlayVanity(opts: {
  totalGames?: number | null;
  staffOverride?: boolean | null;
}): boolean {
  if (opts.staffOverride === true) return true;
  const totalGames = Number(opts.totalGames);
  return Number.isFinite(totalGames) && totalGames >= HOME_PLAY_VANITY_MIN_GAMES;
}
