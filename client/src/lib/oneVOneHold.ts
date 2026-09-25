/**
 * A 1v1 room that is not ACTIVE yet (waiting for an opponent, or the start
 * countdown) is the same kind of live session as the match itself. A version
 * poll must not reload it.
 */
export function shouldHoldOneVOne(input: {
  surface: "lobby" | "match" | "queue";
  lobbyOpen?: boolean;
  lobbyStatus?: string | null;
  matchStatus?: string | null;
  matchEnded?: boolean;
  queuePhase?: string | null;
}): boolean {
  if (input.surface === "lobby") {
    if (!input.lobbyOpen) return false;
    const status = (input.lobbyStatus || "waiting").toLowerCase();
    return status !== "closed" && status !== "cancelled" && status !== "finished";
  }
  if (input.surface === "queue") {
    const phase = (input.queuePhase || "idle").toLowerCase();
    return phase === "searching" || phase === "connecting" || phase === "matched";
  }
  if (input.matchEnded) return true;
  const status = (input.matchStatus || "").toUpperCase();
  if (!status) return true;
  if (status === "FINISHED" || status === "CANCELLED") return false;
  return true;
}
