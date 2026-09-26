/** RFC 6455 1001 Going Away. The server is restarting. */
export const WS_GOING_AWAY_CODE = 1001;

/**
 * True when the player still wants a socket. 1001 is a deploy, so it reconnects
 * the same as a dropped connection.
 */
export function shouldReconnectWebSocket(code: number, allowReconnect: boolean): boolean {
  if (!allowReconnect) return false;
  if (code === WS_GOING_AWAY_CODE) return true;
  return true;
}

/**
 * Player-facing error for a socket close. 1001 has none: an error toast on a
 * play route would cover the card during a deploy.
 */
export function websocketCloseErrorToast(code: number): { title: string; description: string } | null {
  if (code === WS_GOING_AWAY_CODE) return null;
  return null;
}
