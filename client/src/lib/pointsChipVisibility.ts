/**
 * Hard rule (Design): no points chip or wallet sheet during active play.
 * Active play = any screen holding play chrome (Daily 5 while playing) or a
 * live game/match route (solo, 1v1, tournament, Beat-me all run under these).
 * Game Complete on /daily releases play chrome, so the chip returns there.
 */
const PLAY_ROUTE_PREFIXES = ["/game/", "/match/", "/match", "/tournament/", "/beat-me/", "/b/"];
export function pointsChipHidden(location: string, playActive: boolean): boolean {
  if (playActive) return true;
  return PLAY_ROUTE_PREFIXES.some((p) => location === p || location.startsWith(p.endsWith("/") ? p : p + "/"));
}
