/**
 * Shared TypeScript interfaces for PackPTS API responses.
 * Replaces `any` types in useQuery and mutation hooks.
 */

// --- Auth ---
export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'user' | 'admin';
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  token?: string;
}

// --- Cap / Waitlist ---
export interface CapStatus {
  isCapped: boolean;
  currentUsers: number;
  maxUsers: number;
  waitlistPosition?: number;
  estimatedWait?: string;
}

export interface WaitlistEntry {
  id: number;
  email: string;
  position: number;
  createdAt: string;
}

export interface WaitlistStatus {
  isOnWaitlist: boolean;
  position?: number;
  totalWaiting?: number;
}

// --- Profile ---
export interface ProfileStats {
  username: string;
  email: string;
  points: number;
  gamesPlayed: number;
  correctAnswers: number;
  totalAnswers: number;
  rank: number;
  level: number;
  pointsToNextLevel: number;
  levelProgress: number;
  createdAt: string;
}

// --- Wallet ---
export interface WalletBalance {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
}

export interface WalletTransaction {
  id: number;
  type: 'earn' | 'spend' | 'expire';
  amount: number;
  description: string;
  createdAt: string;
}

// --- Game ---
export interface GameQuestion {
  cardId: number;
  imageUrl: string;
  options: string[];
  timeLimit: number;
  correctAnswer?: string;
  pointValue?: number;
  card?: Record<string, unknown>;
}

export interface GameAnswerResult {
  correct: boolean;
  correctAnswer: string;
  pointsEarned: number;
  explanation?: string;
}

export interface GameSession {
  sessionId: string;
  status: 'active' | 'completed';
  score: number;
  questionsAnswered: number;
  totalQuestions: number;
}

// --- Lobby ---
export interface LobbyPlayer {
  userId: number;
  username: string;
  isReady: boolean;
  isHost: boolean;
}

export interface LobbyState {
  lobbyId: string;
  joinCode: string;
  status: 'waiting' | 'starting' | 'in_progress' | 'finished';
  players: LobbyPlayer[];
  hostId: number;
  maxPlayers: number;
  createdAt: string;
}

// --- WebSocket Events ---
export interface WsBaseEvent {
  type: string;
}

export interface WsLobbyUpdateEvent extends WsBaseEvent {
  type: 'LOBBY_UPDATE';
  lobby: LobbyState;
}

export interface WsPlayerJoinedEvent extends WsBaseEvent {
  type: 'PLAYER_JOINED';
  player: LobbyPlayer;
}

export interface WsPlayerLeftEvent extends WsBaseEvent {
  type: 'PLAYER_LEFT';
  userId: number;
}

export interface WsGameStartEvent extends WsBaseEvent {
  type: 'GAME_START';
  matchId: string;
}

export interface WsErrorEvent extends WsBaseEvent {
  type: 'ERROR';
  message: string;
  code?: string;
}

export type WsLobbyEvent =
  | WsLobbyUpdateEvent
  | WsPlayerJoinedEvent
  | WsPlayerLeftEvent
  | WsGameStartEvent
  | WsErrorEvent;

// --- Leaderboard ---
export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  points: number;
  gamesPlayed: number;
  accuracy?: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// --- Pagination ---
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// --- Streak ---
export interface StreakInfo {
  currentDays: number;
  longestDays: number;
  lastPlayedAt: string | null;
  playedToday: boolean;
  calendarDays?: string[];
}
