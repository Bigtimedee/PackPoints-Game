import type { Lobby, MatchState } from "@shared/schema";

export function isMatchParticipant(lobby: Lobby, userId: string): boolean {
  return userId === lobby.hostId || userId === lobby.guestId;
}

export function isMatchParticipantByState(matchState: MatchState, userId: string): boolean {
  return matchState.participants.some(p => p.userId === userId);
}

export function getParticipantRole(lobby: Lobby, userId: string): "host" | "guest" | null {
  if (userId === lobby.hostId) return "host";
  if (userId === lobby.guestId) return "guest";
  return null;
}
