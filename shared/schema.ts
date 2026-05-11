import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, integer, boolean, timestamp, index, uniqueIndex, unique, jsonb, real, date, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User status enum for Founders Cap
export const userStatuses = ["PENDING", "ACTIVE", "WAITLISTED", "BANNED"] as const;
export type UserStatus = typeof userStatuses[number];

// User table - combines Replit Auth fields with game stats
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").unique(),
  usernameNormalized: varchar("username_normalized"),
  email: varchar("email").unique(),
  emailNormalized: varchar("email_normalized"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  points: integer("points").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  totalAnswers: integer("total_answers").notNull().default(0),
  isAdmin: boolean("is_admin").notNull().default(false),
  workosUserId: varchar("workos_user_id").unique(),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  activatedAt: timestamp("activated_at"),
  waitlistJoinedAt: timestamp("waitlist_joined_at"),
  deviceFingerprint: varchar("device_fingerprint", { length: 128 }),
  lastSignupIp: varchar("last_signup_ip", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_users_status").on(table.status),
  index("idx_users_email_normalized").on(table.emailNormalized),
  index("idx_users_username_normalized").on(table.usernameNormalized),
]);

// Local credentials for username/password auth (separate from Replit OAuth)
export const localCredentials = pgTable("local_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  passwordHash: varchar("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLocalCredentialSchema = createInsertSchema(localCredentials).omit({
  id: true,
  createdAt: true,
});

export type InsertLocalCredential = z.infer<typeof insertLocalCredentialSchema>;
export type LocalCredential = typeof localCredentials.$inferSelect;

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: varchar("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
  usedAt: true,
});

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;

// ============================================================
// iOS Mobile Auth — JWT refresh tokens
// ============================================================
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 256 }).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    deviceHint: varchar("device_hint", { length: 256 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_refresh_tokens_user").on(table.userId),
    index("idx_refresh_tokens_token").on(table.token),
  ]
);

export type RefreshToken = typeof refreshTokens.$inferSelect;

// ============================================================
// iOS Mobile Auth — Apple Sign In (tracks apple_user_id <-> user mapping)
// ============================================================
export const appleUsers = pgTable("apple_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  appleUserId: varchar("apple_user_id", { length: 256 }).notNull().unique(),
  email: varchar("email", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AppleUser = typeof appleUsers.$inferSelect;

// ============================================================
// iOS Push Notifications — APNs device tokens
// ============================================================
export const apnsTokens = pgTable(
  "apns_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 256 }).notNull(),
    environment: varchar("environment", { length: 20 }).notNull().default("production"),
    updatedAt: timestamp("updated_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_apns_tokens_user").on(table.userId),
    uniqueIndex("uq_apns_token").on(table.token),
  ]
);

export type ApnsToken = typeof apnsTokens.$inferSelect;

// ============================================================
// iOS In-App Purchases — Apple IAP transaction records
// ============================================================
export const appleTransactions = pgTable(
  "apple_transactions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    transactionId: varchar("transaction_id", { length: 256 }).notNull().unique(),
    originalTransactionId: varchar("original_transaction_id", { length: 256 }),
    productId: varchar("product_id", { length: 256 }).notNull(),
    purchaseType: varchar("purchase_type", { length: 50 }).notNull(), // 'subscription' | 'consumable'
    environment: varchar("environment", { length: 20 }).notNull().default("production"),
    rawReceipt: text("raw_receipt"),
    verifiedAt: timestamp("verified_at").defaultNow(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_apple_tx_user").on(table.userId),
    index("idx_apple_tx_product").on(table.productId),
  ]
);

export type AppleTransaction = typeof appleTransactions.$inferSelect;

// User daily progress table - tracks cards answered per day
export const userDailyProgress = pgTable("user_daily_progress", {
  userId: varchar("user_id").notNull().references(() => users.id),
  dayDate: date("day_date").notNull(),
  cardsAnswered: integer("cards_answered").notNull().default(0),
  matchesCompleted: integer("matches_completed").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.dayDate] }),
  index("idx_user_daily_progress_date").on(table.dayDate),
]);

export const insertUserDailyProgressSchema = createInsertSchema(userDailyProgress).omit({
  updatedAt: true,
});

export type InsertUserDailyProgress = z.infer<typeof insertUserDailyProgressSchema>;
export type UserDailyProgress = typeof userDailyProgress.$inferSelect;

export const baseballCards = pgTable("baseball_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  playerName: text("player_name").notNull(),
  team: text("team").notNull().default("Unknown"),
  position: text("position").notNull().default("Unknown"),
  year: integer("year").notNull().default(1987),
  setName: text("set_name").notNull().default("Topps"),
  cardNumber: text("card_number").notNull(),
  imageUrl: text("image_url").notNull(),
  popularity: integer("popularity").notNull().default(50),
  imageVerified: boolean("image_verified").notNull().default(false),
  lastImageCheck: timestamp("last_image_check"),
  imageFailureCount: integer("image_failure_count").notNull().default(0),
  imageLastError: text("image_last_error"),
}, (table) => [
  index("idx_baseball_cards_last_check").on(table.lastImageCheck),
]);

export const insertBaseballCardSchema = createInsertSchema(baseballCards).omit({
  id: true,
});

export type InsertBaseballCard = z.infer<typeof insertBaseballCardSchema>;
export type BaseballCard = typeof baseballCards.$inferSelect;

// Extended card type for gameplay that includes rotation correction
export interface GameplayCard extends BaseballCard {
  imageRotation?: number; // 0, 90, 180, 270 degrees
  playableCardId?: string; // Original playable_cards id for reporting
}

export interface GameQuestion {
  card: GameplayCard;
  options: string[];
  correctAnswer: string;
  pointValue: number;
}

export interface GameSession {
  id: string;
  mode: "solo" | "1v1" | "tournament";
  userId: string | null;
  guestSessionId?: string;
  questions: GameQuestion[];
  currentQuestionIndex: number;
  score: number;
  correctAnswers: number;
  totalQuestions: number;
  skippedQuestions: number;
  status: "active" | "completed" | "expired";
  startedAt: string;
  completedAt?: string;
}

export const gameSessionsTable = pgTable("game_sessions", {
  id: varchar("id").primaryKey(),
  mode: varchar("mode", { length: 20 }).notNull(),
  userId: varchar("user_id"),
  guestSessionId: varchar("guest_session_id"),
  questions: jsonb("questions").notNull(),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  score: integer("score").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  totalQuestions: integer("total_questions").notNull(),
  skippedQuestions: integer("skipped_questions").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  startedAt: varchar("started_at").notNull(),
  completedAt: varchar("completed_at"),
  matchPointsAwarded: integer("match_points_awarded").default(0),
}, (table) => [
  index("idx_game_sessions_user_id").on(table.userId),
  index("idx_game_sessions_status").on(table.status),
]);

export interface LeaderboardEntry {
  rank: number;
  username: string;
  points: number;
  gamesPlayed: number;
  accuracy: number;
}

export interface RedemptionOption {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  usdValue: number;
  platform: "goldin" | "ebay";
  imageUrl: string;
}

export const startGameSchema = z.object({
  mode: z.enum(["solo", "1v1", "tournament"], { errorMap: () => ({ message: "Please select a valid game mode" }) }),
  totalQuestions: z.number({ invalid_type_error: "Number of questions must be a number" }).min(5, "Minimum 5 questions").max(20, "Maximum 20 questions"),
  setId: z.string().uuid("Please select a valid card set").optional(),
});

export type StartGameRequest = z.infer<typeof startGameSchema>;

export const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be 20 characters or fewer").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100, "Password is too long"),
});

export type RegisterRequest = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginRequest = z.infer<typeof loginSchema>;

export const submitAnswerSchema = z.object({
  sessionId: z.string({ required_error: "Session ID is required" }),
  questionIndex: z.number({ required_error: "Question index is required" }),
  selectedAnswer: z.string({ required_error: "Selected answer is required" }),
});

export type SubmitAnswer = z.infer<typeof submitAnswerSchema>;

export const lobbies = pgTable("lobbies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  joinCode: varchar("join_code", { length: 6 }).notNull().unique(),
  hostId: varchar("host_id").notNull(),
  hostUsername: text("host_username").notNull(),
  hostSecret: varchar("host_secret", { length: 32 }).notNull(),
  guestId: varchar("guest_id"),
  guestUsername: text("guest_username"),
  guestSecret: varchar("guest_secret", { length: 32 }),
  status: text("status").notNull().default("waiting"),
  mode: text("mode").notNull().default("1v1_friend"),
  totalQuestions: integer("total_questions").notNull().default(10),
  gameSetId: varchar("game_set_id"),
  wagerAmount: integer("wager_amount").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLobbySchema = createInsertSchema(lobbies).omit({
  id: true,
  createdAt: true,
});

export type InsertLobby = z.infer<typeof insertLobbySchema>;
export type Lobby = typeof lobbies.$inferSelect;

export const MatchStatus = {
  LOBBY: "LOBBY",
  INITIALIZING: "INITIALIZING", 
  ACTIVE: "ACTIVE",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
} as const;

export type MatchStatusType = typeof MatchStatus[keyof typeof MatchStatus];

export const MatchResult = {
  PENDING: "PENDING",
  HOST_WIN: "HOST_WIN",
  GUEST_WIN: "GUEST_WIN",
  TIE: "TIE",
} as const;

export type MatchResultType = typeof MatchResult[keyof typeof MatchResult];

export const matchResultEnum = pgEnum("match_result", ["PENDING", "HOST_WIN", "GUEST_WIN", "TIE"]);

export const matchModes = ["1vFriends", "1vRandom"] as const;
export type MatchMode = typeof matchModes[number];

export const matches = pgTable("matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lobbyId: varchar("lobby_id").notNull(),
  mode: text("mode").notNull().default("1vFriends"),
  status: text("status").notNull().default("LOBBY"),
  hostUserId: varchar("host_user_id"),
  guestUserId: varchar("guest_user_id"),
  cardSetId: varchar("card_set_id"),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  totalQuestions: integer("total_questions").notNull(),
  questionsData: text("questions_data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  endReason: text("end_reason"),
  endDetail: jsonb("end_detail"),
  result: matchResultEnum("result").notNull().default("PENDING"),
  winnerUserId: varchar("winner_user_id"),
  hostCorrect: integer("host_correct").notNull().default(0),
  guestCorrect: integer("guest_correct").notNull().default(0),
  progressApplied: boolean("progress_applied").notNull().default(false),
  wagerAmount: integer("wager_amount").notNull().default(0),
  wagerSettled: boolean("wager_settled").notNull().default(false),
}, (table) => [
  index("idx_matches_status").on(table.status),
  index("idx_matches_host").on(table.hostUserId),
  index("idx_matches_guest").on(table.guestUserId),
]);

export const insertMatchSchema = createInsertSchema(matches).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
  endReason: true,
  result: true,
  winnerUserId: true,
  hostCorrect: true,
  guestCorrect: true,
});

export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matches.$inferSelect;

export const matchParticipantRoles = ["HOST", "GUEST"] as const;
export type MatchParticipantRole = typeof matchParticipantRoles[number];

export const matchParticipants = pgTable("match_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username").notNull(),
  role: text("role").notNull().default("GUEST"),
  score: integer("score").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  isConnected: boolean("is_connected").notNull().default(true),
  ackedAt: timestamp("acked_at"),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
}, (table) => [
  unique("match_participants_match_user_unique").on(table.matchId, table.userId),
]);

export const insertMatchParticipantSchema = createInsertSchema(matchParticipants).omit({
  id: true,
});

export type InsertMatchParticipant = z.infer<typeof insertMatchParticipantSchema>;
export type MatchParticipant = typeof matchParticipants.$inferSelect;

// --- Ranked Competitive System (ELO) ---

export const rankedTierEnum = pgEnum("ranked_tier", [
  "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "LEGEND",
]);

export const playerRatings = pgTable("player_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  rating: integer("rating").notNull().default(1200),
  peakRating: integer("peak_rating").notNull().default(1200),
  tier: rankedTierEnum("tier").notNull().default("BRONZE"),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  winStreak: integer("win_streak").notNull().default(0),
  bestWinStreak: integer("best_win_streak").notNull().default(0),
  seasonId: integer("season_id").notNull().default(1),
  lastMatchAt: timestamp("last_match_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_player_ratings_user").on(table.userId),
  index("idx_player_ratings_rating").on(table.rating),
  index("idx_player_ratings_tier").on(table.tier),
  index("idx_player_ratings_season").on(table.seasonId),
]);

export type PlayerRating = typeof playerRatings.$inferSelect;

export const ratingHistory = pgTable("rating_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  matchId: varchar("match_id").notNull(),
  ratingBefore: integer("rating_before").notNull(),
  ratingAfter: integer("rating_after").notNull(),
  ratingChange: integer("rating_change").notNull(),
  opponentRating: integer("opponent_rating").notNull(),
  result: varchar("result", { length: 10 }).notNull(), // WIN, LOSS, DRAW
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_rating_history_user").on(table.userId),
  index("idx_rating_history_match").on(table.matchId),
]);

export type RatingHistoryEntry = typeof ratingHistory.$inferSelect;

// Tier thresholds
export const RANKED_TIER_THRESHOLDS = {
  BRONZE:   { min: 0,    max: 1199, label: "Bronze",   color: "#CD7F32" },
  SILVER:   { min: 1200, max: 1399, label: "Silver",   color: "#C0C0C0" },
  GOLD:     { min: 1400, max: 1599, label: "Gold",     color: "#FFD700" },
  PLATINUM: { min: 1600, max: 1799, label: "Platinum", color: "#E5E4E2" },
  DIAMOND:  { min: 1800, max: 1999, label: "Diamond",  color: "#B9F2FF" },
  LEGEND:   { min: 2000, max: 9999, label: "Legend",   color: "#FF4500" },
} as const;

export type RankedTierName = keyof typeof RANKED_TIER_THRESHOLDS;

// ── Wager Match constants ──
export const WAGER_MIN_PACKPTS = 100;
export const WAGER_MAX_PACKPTS = 5_000;
export const WAGER_HOUSE_RAKE_PCT = 10; // 10% house rake on winnings

export const matchQuestions = pgTable("match_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  idx: integer("idx").notNull(),
  cardId: varchar("card_id").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  choices: text("choices").notNull(),
  pointValue: integer("point_value").notNull().default(100),
  seedVersion: integer("seed_version").notNull().default(1),
  replacedCount: integer("replaced_count").notNull().default(0),
  assignedAt: timestamp("assigned_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("match_questions_match_idx_unique").on(table.matchId, table.idx),
]);

export const insertMatchQuestionSchema = createInsertSchema(matchQuestions).omit({
  id: true,
  createdAt: true,
  assignedAt: true,
});

export type InsertMatchQuestion = z.infer<typeof insertMatchQuestionSchema>;
export type MatchQuestion = typeof matchQuestions.$inferSelect;

export const matchUsedCards = pgTable("match_used_cards", {
  matchId: varchar("match_id").notNull(),
  cardId: varchar("card_id").notNull(),
  addedAt: timestamp("added_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.matchId, table.cardId] }),
]);

export const insertMatchUsedCardSchema = createInsertSchema(matchUsedCards).omit({
  addedAt: true,
});

export type InsertMatchUsedCard = z.infer<typeof insertMatchUsedCardSchema>;
export type MatchUsedCard = typeof matchUsedCards.$inferSelect;

export const matchAnswers = pgTable("match_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  userId: varchar("user_id").notNull(),
  idx: integer("idx").notNull(),
  selected: text("selected").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  pointsEarned: integer("points_earned").notNull().default(0),
  clientMsgId: text("client_msg_id"),
  answeredAt: timestamp("answered_at").defaultNow(),
}, (table) => [
  unique("match_answers_match_user_idx_unique").on(table.matchId, table.userId, table.idx),
]);

export const insertMatchAnswerSchema = createInsertSchema(matchAnswers).omit({
  id: true,
  answeredAt: true,
});

export type InsertMatchAnswer = z.infer<typeof insertMatchAnswerSchema>;
export type MatchAnswer = typeof matchAnswers.$inferSelect;

export const matchEventTypes = [
  "CREATE", "INIT", "ACK", "SUBMIT", "ADVANCE", "END", "RESYNC", "ERROR"
] as const;
export type MatchEventType = typeof matchEventTypes[number];

export const matchEvents = pgTable("match_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  ts: timestamp("ts").defaultNow().notNull(),
  actorUserId: varchar("actor_user_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
}, (table) => [
  index("idx_match_events_match_ts").on(table.matchId, table.ts),
]);

export const insertMatchEventSchema = createInsertSchema(matchEvents).omit({
  id: true,
  ts: true,
});

export type InsertMatchEvent = z.infer<typeof insertMatchEventSchema>;
export type MatchEvent = typeof matchEvents.$inferSelect;

export interface MatchState {
  matchId: string;
  lobbyId: string;
  status: MatchStatusType;
  currentQuestionIndex: number;
  totalQuestions: number;
  questions: GameQuestion[];
  gameSetId?: string;
  participants: {
    userId: string;
    username: string;
    score: number;
    correctAnswers: number;
    currentQuestionIndex: number;
    hasAnsweredCurrent: boolean;
  }[];
  winner?: string;
  endReason?: string;
  result?: MatchResultType;
  winnerUserId?: string;
  hostCorrect?: number;
  guestCorrect?: number;
  wagerAmount?: number;
}

export const createLobbySchema = z.object({
  hostId: z.string({ required_error: "Host ID is required" }),
  hostUsername: z.string({ required_error: "Host username is required" }),
  totalQuestions: z.number({ invalid_type_error: "Number of questions must be a number" }).min(5, "Minimum 5 questions").max(20, "Maximum 20 questions").default(10),
});

export const createLobbyRequestSchema = z.object({
  totalQuestions: z.coerce.number({ invalid_type_error: "Number of questions must be a number" }).min(5, "Minimum 5 questions").max(20, "Maximum 20 questions").default(10),
  gameSetId: z.string().uuid("Please select a valid card set").nullish(),
  wagerAmount: z.coerce.number().int().min(0).max(WAGER_MAX_PACKPTS).default(0),
});

export const joinLobbySchema = z.object({
  joinCode: z.string().length(6, "Join code must be exactly 6 characters"),
  guestId: z.string({ required_error: "Guest ID is required" }),
  guestUsername: z.string({ required_error: "Guest username is required" }),
});

export const joinLobbyRequestSchema = z.object({
  joinCode: z.string({ required_error: "Join code is required" }).min(1, "Join code is required").length(6, "Join code must be exactly 6 characters"),
});

export const matchAnswerSchema = z.object({
  matchId: z.string(),
  userId: z.string(),
  questionIndex: z.number(),
  selectedAnswer: z.string(),
});

// Friendship status enum
export const friendshipStatuses = ["PENDING", "ACCEPTED", "DECLINED", "BLOCKED"] as const;
export type FriendshipStatus = typeof friendshipStatuses[number];
export const friendshipStatusEnum = pgEnum("friendship_status", friendshipStatuses);

// Friendships table - single-row undirected model (user_low < user_high by UUID)
export const friendships = pgTable("friendships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userLow: varchar("user_low").notNull().references(() => users.id),
  userHigh: varchar("user_high").notNull().references(() => users.id),
  status: friendshipStatusEnum("status").notNull().default("PENDING"),
  initiatedBy: varchar("initiated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_friendships_pair").on(table.userLow, table.userHigh),
  index("idx_friendships_status").on(table.status),
  index("idx_friendships_user_low").on(table.userLow),
  index("idx_friendships_user_high").on(table.userHigh),
]);

export const insertFriendshipSchema = createInsertSchema(friendships).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFriendship = z.infer<typeof insertFriendshipSchema>;
export type Friendship = typeof friendships.$inferSelect;

// Friend match invite status enum
export const friendMatchInviteStatuses = ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"] as const;
export type FriendMatchInviteStatus = typeof friendMatchInviteStatuses[number];
export const friendMatchInviteStatusEnum = pgEnum("friend_match_invite_status", friendMatchInviteStatuses);

// Friend match invites - for 1vFriends mode
export const friendMatchInvites = pgTable("friend_match_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUserId: varchar("from_user_id").notNull().references(() => users.id),
  toUserId: varchar("to_user_id").notNull().references(() => users.id),
  bucket: text("bucket").notNull().default("ANY"),
  mode: text("mode").notNull().default("1vFriends"),
  status: friendMatchInviteStatusEnum("status").notNull().default("PENDING"),
  matchId: varchar("match_id"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("idx_friend_match_invites_to_user").on(table.toUserId, table.status),
  index("idx_friend_match_invites_from_user").on(table.fromUserId, table.status),
]);

export const insertFriendMatchInviteSchema = createInsertSchema(friendMatchInvites).omit({
  id: true,
  createdAt: true,
  matchId: true,
});

export type InsertFriendMatchInvite = z.infer<typeof insertFriendMatchInviteSchema>;
export type FriendMatchInvite = typeof friendMatchInvites.$inferSelect;

// PackPTS Wallet - stores user's balance and lifetime stats
export const wallets = pgTable("wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  balance: integer("balance").notNull().default(0),
  lifetimeEarned: integer("lifetime_earned").notNull().default(0),
  lifetimeSpent: integer("lifetime_spent").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active, frozen, suspended
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWalletSchema = createInsertSchema(wallets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;

// Ledger entry types enum
export const ledgerEntryTypes = ["EARN", "SPEND", "ADJUST", "PURCHASE_CREDIT", "REVERSAL", "STREAK_EARN", "EXPIRE"] as const;
export type LedgerEntryType = typeof ledgerEntryTypes[number];

// Source types for PackPTS buckets (determines expiration policy)
export const bucketSourceTypes = ["EARNED", "PURCHASED", "BONUS", "ADJUSTMENT"] as const;
export type BucketSourceType = typeof bucketSourceTypes[number];

// Bucket status enum
export const bucketStatuses = ["OPEN", "DEPLETED", "EXPIRED"] as const;
export type BucketStatus = typeof bucketStatuses[number];

// PackPTS Ledger - append-only transaction log
export const ledgerEntries = pgTable("ledger_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").notNull().references(() => wallets.id),
  entryType: varchar("entry_type", { length: 20 }).notNull(), // EARN, SPEND, ADJUST, PURCHASE_CREDIT, REVERSAL
  amount: integer("amount").notNull(), // positive for credits, negative for debits
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  source: varchar("source", { length: 30 }), // gameplay, purchase, admin, redemption, adjustment, streak
  eventType: varchar("event_type", { length: 60 }), // match_round_award, stripe_checkout_completed, redeem_request, etc.
  refType: varchar("ref_type", { length: 40 }), // match, round, stripe_session, bundle, admin_action
  refId: varchar("ref_id", { length: 255 }), // unique external/internal id
  metadata: jsonb("metadata"), // flexible JSON for additional context
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(), // prevents duplicate transactions
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ledger_wallet").on(table.walletId),
  index("idx_ledger_created").on(table.createdAt),
  index("idx_ledger_idempotency").on(table.idempotencyKey),
  index("idx_ledger_source_ref").on(table.source, table.refId),
  index("idx_ledger_user_source").on(table.walletId, table.source),
]);

export const packptsEventStatuses = ["received", "processed", "failed"] as const;
export type PackptsEventStatus = typeof packptsEventStatuses[number];

export const packptsEvents = pgTable("packpts_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type", { length: 60 }).notNull(),
  payload: jsonb("payload"),
  status: varchar("status", { length: 20 }).notNull().default("received"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_packpts_events_type").on(table.type),
  index("idx_packpts_events_status").on(table.status),
  index("idx_packpts_events_created").on(table.createdAt),
]);

export const insertLedgerEntrySchema = createInsertSchema(ledgerEntries).omit({
  id: true,
  createdAt: true,
});

export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;

// API request/response schemas for wallet operations
export const spendWalletSchema = z.object({
  amount: z.number().int().positive("Amount must be positive"),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1).max(64),
  metadata: z.record(z.unknown()).optional(),
});

export type SpendWalletRequest = z.infer<typeof spendWalletSchema>;

export const earnWalletSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int().positive("Amount must be positive"),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1).max(64),
  metadata: z.record(z.unknown()).optional(),
});

export type EarnWalletRequest = z.infer<typeof earnWalletSchema>;

export const adjustWalletSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int(), // can be positive or negative
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1).max(64),
  metadata: z.record(z.unknown()).optional(),
});

export type AdjustWalletRequest = z.infer<typeof adjustWalletSchema>;

// Product types for monetization
export const productTypes = ["CONSUMABLE", "ENTITLEMENT", "SUBSCRIPTION"] as const;
export type ProductType = typeof productTypes[number];

// Products catalog - available items for purchase
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sku: varchar("sku", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // CONSUMABLE, ENTITLEMENT, SUBSCRIPTION
  packptsGrant: integer("packpts_grant"), // only for CONSUMABLE
  entitlementKey: varchar("entitlement_key", { length: 100 }), // only for ENTITLEMENT/SUBSCRIPTION
  durationDays: integer("duration_days"), // only for SUBSCRIPTION
  priceUsd: integer("price_usd"), // price in cents
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"),
  ratioUsdPerPackptMicro: integer("ratio_usd_per_packpt_micro"), // USD per PackPTS in micro-dollars (1 USD = 1,000,000 micro)
  ratioPackptPerUsdMicro: integer("ratio_packpt_per_usd_micro"), // PackPTS per USD in micro-packpts
  ratioMode: varchar("ratio_mode", { length: 20 }).default("AUTO"), // AUTO or OVERRIDE
  overrideReason: text("override_reason"),
  guardrailsStatus: varchar("guardrails_status", { length: 20 }), // PASS, WARN, BLOCK, OVERRIDE
  guardrailsJson: jsonb("guardrails_json"), // full evaluation snapshot
  stripePriceId: varchar("stripe_price_id", { length: 200 }),
  sortOrder: integer("sort_order").default(0),
  description: text("description"),
  imageUrl: text("image_url"),
  isBestValue: boolean("is_best_value").default(false),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_products_sku").on(table.sku),
  index("idx_products_active").on(table.isActive),
]);

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// User entitlements - unlocked features/subscriptions
export const userEntitlements = pgTable("user_entitlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  entitlementKey: varchar("entitlement_key", { length: 100 }).notNull(),
  expiresAt: timestamp("expires_at"), // null for permanent entitlements
  source: varchar("source", { length: 50 }).notNull(), // purchase, promo, admin_grant
  sourceReference: varchar("source_reference", { length: 200 }), // order ID, promo code, etc
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_entitlements_user").on(table.userId),
  index("idx_entitlements_key").on(table.entitlementKey),
  index("idx_entitlements_expires").on(table.expiresAt),
]);

export const insertUserEntitlementSchema = createInsertSchema(userEntitlements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserEntitlement = z.infer<typeof insertUserEntitlementSchema>;
export type UserEntitlement = typeof userEntitlements.$inferSelect;

// Purchase event status enum
export const purchaseEventStatuses = ["received", "processed", "failed", "ignored"] as const;
export type PurchaseEventStatus = typeof purchaseEventStatuses[number];

// Purchase events - raw webhook payload log for auditing and retry
export const purchaseEvents = pgTable("purchase_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id", { length: 200 }).notNull().unique(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  userId: varchar("user_id"),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("received"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: timestamp("last_retry_at"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_purchase_events_event_id").on(table.eventId),
  index("idx_purchase_events_user").on(table.userId),
  index("idx_purchase_events_status").on(table.status),
  index("idx_purchase_events_created").on(table.createdAt),
]);

export const insertPurchaseEventSchema = createInsertSchema(purchaseEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processedAt: true,
});

export type InsertPurchaseEvent = z.infer<typeof insertPurchaseEventSchema>;
export type PurchaseEvent = typeof purchaseEvents.$inferSelect;

// Stripe customer mapping for sync operations
export const stripeCustomers = pgTable("stripe_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_stripe_customers_user").on(table.userId),
  index("idx_stripe_customers_stripe").on(table.stripeCustomerId),
]);

export const insertStripeCustomerSchema = createInsertSchema(stripeCustomers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStripeCustomer = z.infer<typeof insertStripeCustomerSchema>;
export type StripeCustomer = typeof stripeCustomers.$inferSelect;

// Stripe checkout session statuses
export const checkoutSessionStatuses = ["CREATED", "PAID", "CANCELED", "EXPIRED"] as const;
export type CheckoutSessionStatus = typeof checkoutSessionStatuses[number];

// Stripe checkout sessions - track checkout state for UI polling
export const stripeCheckoutSessions = pgTable("stripe_checkout_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sku: varchar("sku", { length: 100 }).notNull(),
  stripeSessionId: varchar("stripe_session_id", { length: 200 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("CREATED"),
  packptsGrant: integer("packpts_grant"),
  amountCents: integer("amount_cents"),
  currency: varchar("currency", { length: 10 }).default("usd"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_checkout_sessions_user").on(table.userId),
  index("idx_checkout_sessions_stripe").on(table.stripeSessionId),
  index("idx_checkout_sessions_status").on(table.status),
]);

export const insertStripeCheckoutSessionSchema = createInsertSchema(stripeCheckoutSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStripeCheckoutSession = z.infer<typeof insertStripeCheckoutSessionSchema>;
export type StripeCheckoutSession = typeof stripeCheckoutSessions.$inferSelect;

// Feature flags for system-wide toggles
export const featureFlags = pgTable("feature_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key", { length: 100 }).notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  value: jsonb("value"), // optional configuration value
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_feature_flags_key").on(table.key),
]);

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;

// Daily quotas for tracking usage limits per user per day
export const dailyQuotas = pgTable("daily_quotas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  quotaDate: varchar("quota_date", { length: 10 }).notNull(), // YYYY-MM-DD format
  mode: varchar("mode", { length: 50 }).notNull(), // solo, 1v1_friend, 1v1_random, tournament
  matchesStarted: integer("matches_started").notNull().default(0),
  matchesCompleted: integer("matches_completed").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_daily_quotas_user_date").on(table.userId, table.quotaDate),
  index("idx_daily_quotas_user_date_mode").on(table.userId, table.quotaDate, table.mode),
]);

export const insertDailyQuotaSchema = createInsertSchema(dailyQuotas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDailyQuota = z.infer<typeof insertDailyQuotaSchema>;
export type DailyQuota = typeof dailyQuotas.$inferSelect;

// Match token statuses
export const matchTokenStatuses = ["active", "consumed", "expired", "revoked"] as const;
export type MatchTokenStatus = typeof matchTokenStatuses[number];

// Match tokens for anti-cheat and server-side validation
export const matchTokens = pgTable("match_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 64 }).notNull().unique(), // random token
  userId: varchar("user_id").notNull().references(() => users.id),
  mode: varchar("mode", { length: 50 }).notNull(),
  sessionId: varchar("session_id"), // links to game session
  signature: varchar("signature", { length: 128 }).notNull(), // HMAC signature
  status: varchar("status", { length: 20 }).notNull().default("active"),
  maxPoints: integer("max_points").notNull().default(0), // max possible points for validation
  pointsAwarded: integer("points_awarded"), // actual points awarded on completion
  multiplier: real("multiplier").notNull().default(1.0), // tier-based multiplier
  issuedAt: timestamp("issued_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
}, (table) => [
  index("idx_match_tokens_token").on(table.token),
  index("idx_match_tokens_user").on(table.userId),
  index("idx_match_tokens_user_issued").on(table.userId, table.issuedAt),
  index("idx_match_tokens_status").on(table.status),
]);

export const insertMatchTokenSchema = createInsertSchema(matchTokens).omit({
  id: true,
  issuedAt: true,
  consumedAt: true,
});

export type InsertMatchToken = z.infer<typeof insertMatchTokenSchema>;
export type MatchToken = typeof matchTokens.$inferSelect;

// Tier configuration constants
export const TIER_CONFIG = {
  FREE: {
    dailyMatchLimit: 5,
    hourlyMatchLimit: 3,
    multiplier: 1.0,
    allowedModes: ["solo"] as string[],
  },
  PRO: {
    dailyMatchLimit: null, // unlimited
    hourlyMatchLimit: 20,
    multiplier: 1.5,
    allowedModes: ["solo", "1v1_friend", "1v1_random", "tournament"] as string[],
  },
  LEGEND: {
    dailyMatchLimit: null, // unlimited
    hourlyMatchLimit: 30,
    multiplier: 2.0,
    allowedModes: ["solo", "1v1_friend", "1v1_random", "tournament", "legend"] as string[],
  },
} as const;

// Admin audit log for tracking all admin actions
export const adminAuditLog = pgTable("admin_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: varchar("admin_user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  targetUserId: varchar("target_user_id").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_admin_audit_admin").on(table.adminUserId),
  index("idx_admin_audit_target").on(table.targetUserId),
  index("idx_admin_audit_action").on(table.action),
  index("idx_admin_audit_created").on(table.createdAt),
]);

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLog).omit({
  id: true,
  createdAt: true,
});

export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;

// Analytics event log for tracking user/system events
export const ANALYTICS_EVENT_TYPES = [
  "store_viewed",
  "purchase_started",
  "purchase_completed",
  "match_started",
  "match_completed",
  "pts_earned",
  "pts_spent",
  "redeem_started",
  "redeem_completed",
  "streak_incremented",
  "streak_broken",
  "streak_freeze_used",
  "streak_reward_awarded",
] as const;

export type AnalyticsEventType = typeof ANALYTICS_EVENT_TYPES[number];

export const eventLog = pgTable("event_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  userId: varchar("user_id").references(() => users.id),
  sessionId: varchar("session_id", { length: 100 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_event_log_type").on(table.eventType),
  index("idx_event_log_user").on(table.userId),
  index("idx_event_log_created").on(table.createdAt),
  index("idx_event_log_type_created").on(table.eventType, table.createdAt),
]);

export const insertEventLogSchema = createInsertSchema(eventLog).omit({
  id: true,
  createdAt: true,
});

export type InsertEventLog = z.infer<typeof insertEventLogSchema>;
export type EventLog = typeof eventLog.$inferSelect;

// Analytics event interface for dispatcher
export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  userId?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

// Redemption status types
export const redemptionStatuses = ["pending", "approved", "rejected", "completed", "reversed"] as const;
export type RedemptionStatus = typeof redemptionStatuses[number];

// Redemption types
export const redemptionTypes = ["store_credit"] as const;
export type RedemptionType = typeof redemptionTypes[number];

// Redemption tiers - cap-based conversion with admin margin control
// PackPTS is a discount instrument, not a cash balance
export const redemptionTiers = pgTable("redemption_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(), // e.g., "Starter", "Bronze", "Silver", "Gold"
  packptsRequired: integer("packpts_required").notNull(), // exact PackPTS amount for this tier
  usdCapCents: integer("usd_cap_cents").notNull(), // maximum USD value in cents (e.g., 500 = $5)
  effectiveRatePct: integer("effective_rate_pct").notNull().default(100), // % of cap actually paid (admin margin control)
  description: varchar("description", { length: 255 }).notNull(), // e.g., "Up to $5 toward a card"
  sortOrder: integer("sort_order").notNull().default(0), // display ordering
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_redemption_tiers_active").on(table.isActive),
  index("idx_redemption_tiers_sort").on(table.sortOrder),
]);

export const insertRedemptionTierSchema = createInsertSchema(redemptionTiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRedemptionTier = z.infer<typeof insertRedemptionTierSchema>;
export type RedemptionTier = typeof redemptionTiers.$inferSelect;

// Reward redemptions - tracks user redemptions of PackPTS for store credit
export const rewardRedemptions = pgTable("reward_redemptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  packptsSpent: integer("packpts_spent").notNull(),
  usdValue: integer("usd_value").notNull(), // in cents
  type: varchar("type", { length: 50 }).notNull().default("store_credit"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  creditToken: varchar("credit_token", { length: 64 }).unique(), // token for store checkout
  ledgerIdempotencyKey: varchar("ledger_idempotency_key", { length: 64 }), // links to ledger entry
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reversalReason: text("reversal_reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_redemptions_user").on(table.userId),
  index("idx_redemptions_status").on(table.status),
  index("idx_redemptions_credit_token").on(table.creditToken),
  index("idx_redemptions_created").on(table.createdAt),
]);

export const insertRewardRedemptionSchema = createInsertSchema(rewardRedemptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
});

export type InsertRewardRedemption = z.infer<typeof insertRewardRedemptionSchema>;
export type RewardRedemption = typeof rewardRedemptions.$inferSelect;

// Request schema for redemption
export const redeemPackptsSchema = z.object({
  packptsAmount: z.number().int().positive("Amount must be positive").min(1000, "Minimum redemption is 1000 PackPTS"),
  idempotencyKey: z.string().min(8).max(64).optional(),
});

export type RedeemPackptsRequest = z.infer<typeof redeemPackptsSchema>;

// Admin review threshold (in USD cents) - redemptions above this need admin approval
export const REDEMPTION_REVIEW_THRESHOLD_CENTS = 2500; // $25.00

// ============================================
// STREAK SYSTEM - Daily play incentives
// ============================================

// Streak status enum
export const streakStatuses = ["active", "broken", "frozen"] as const;
export type StreakStatus = typeof streakStatuses[number];

// User streak state - tracks current streak for each user
export const streakState = pgTable("streak_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  currentDays: integer("current_days").notNull().default(0),
  longestDays: integer("longest_days").notNull().default(0),
  lastActiveLocalDate: varchar("last_active_local_date", { length: 10 }), // YYYY-MM-DD in user's timezone
  lastClaimLocalDate: varchar("last_claim_local_date", { length: 10 }), // last day reward was claimed
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Chicago"),
  freezesAvailable: integer("freezes_available").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_streak_state_user").on(table.userId),
  index("idx_streak_state_last_active").on(table.lastActiveLocalDate),
]);

export const insertStreakStateSchema = createInsertSchema(streakState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStreakState = z.infer<typeof insertStreakStateSchema>;
export type StreakState = typeof streakState.$inferSelect;

// Streak reward configuration - DB-backed remote config for reward schedule
export const streakRewardConfig = pgTable("streak_reward_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until"), // null = no end date
  jsonSchedule: jsonb("json_schedule").notNull(), // { "1": 25, "2": 30, "3": 35, ... }
  dailyCap: integer("daily_cap").notNull().default(250), // max daily streak reward
  milestoneBonuses: jsonb("milestone_bonuses").notNull(), // { "7": 500, "14": 1250, "30": 5000 }
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_streak_reward_config_effective").on(table.effectiveFrom),
  index("idx_streak_reward_config_enabled").on(table.enabled),
]);

export const insertStreakRewardConfigSchema = createInsertSchema(streakRewardConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStreakRewardConfig = z.infer<typeof insertStreakRewardConfigSchema>;
export type StreakRewardConfig = typeof streakRewardConfig.$inferSelect;

// Streak claim log - append-only log of all streak rewards claimed
export const streakClaimLog = pgTable("streak_claim_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  localDate: varchar("local_date", { length: 10 }).notNull(), // YYYY-MM-DD
  streakDay: integer("streak_day").notNull(), // what day of streak (1, 2, 3...)
  dailyReward: integer("daily_reward").notNull(), // base daily reward
  milestoneBonus: integer("milestone_bonus").notNull().default(0), // bonus for milestone (7, 14, 30 days)
  totalAwarded: integer("total_awarded").notNull(), // daily + milestone
  idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull().unique(),
  matchId: varchar("match_id"), // the match that triggered this claim
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_streak_claim_log_user").on(table.userId),
  index("idx_streak_claim_log_user_date").on(table.userId, table.localDate),
  index("idx_streak_claim_log_idempotency").on(table.idempotencyKey),
  index("idx_streak_claim_log_created").on(table.createdAt),
]);

export const insertStreakClaimLogSchema = createInsertSchema(streakClaimLog).omit({
  id: true,
  createdAt: true,
});

export type InsertStreakClaimLog = z.infer<typeof insertStreakClaimLogSchema>;
export type StreakClaimLog = typeof streakClaimLog.$inferSelect;

// Streak analytics event types
export const STREAK_ANALYTICS_EVENTS = [
  "streak_incremented",
  "streak_broken",
  "streak_freeze_used",
  "streak_reward_awarded",
] as const;

// ============================================
// PACKPTS EXPIRATION SYSTEM
// ============================================

// PackPTS Bucket - tracks point balances with expiration dates for FIFO spending
export const packptsBucket = pgTable("packpts_bucket", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sourceType: varchar("source_type", { length: 20 }).notNull(), // EARNED, PURCHASED, BONUS, ADJUSTMENT
  originalAmount: integer("original_amount").notNull(),
  remainingAmount: integer("remaining_amount").notNull(),
  earnedAt: timestamp("earned_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // null = never expires
  createdFromLedgerEntryId: varchar("created_from_ledger_entry_id").references(() => ledgerEntries.id),
  status: varchar("status", { length: 20 }).notNull().default("OPEN"), // OPEN, DEPLETED, EXPIRED
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_bucket_user").on(table.userId),
  index("idx_bucket_user_expires").on(table.userId, table.expiresAt),
  index("idx_bucket_user_status").on(table.userId, table.status),
  index("idx_bucket_expires_status").on(table.expiresAt, table.status),
]);

export const insertPackptsBucketSchema = createInsertSchema(packptsBucket).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPackptsBucket = z.infer<typeof insertPackptsBucketSchema>;
export type PackptsBucket = typeof packptsBucket.$inferSelect;

// PackPTS Expiration Policy - configurable rules for point expiration
export const packptsExpirationPolicy = pgTable("packpts_expiration_policy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  earnedDaysToExpire: integer("earned_days_to_expire").notNull().default(365), // days after earning
  purchasedDaysToExpire: integer("purchased_days_to_expire"), // null = never expires
  bonusDefaultDaysToExpire: integer("bonus_default_days_to_expire").notNull().default(90),
  inactivityEnabled: boolean("inactivity_enabled").notNull().default(false),
  inactivityDays: integer("inactivity_days").notNull().default(90), // days of inactivity before trigger
  inactivityMinAgeDays: integer("inactivity_min_age_days").notNull().default(90), // min age of points to expire
  gracePeriodDays: integer("grace_period_days").notNull().default(7), // warning period before expiration
  jsonOverrides: jsonb("json_overrides"), // per-promo or special rules
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_expiration_policy_effective").on(table.effectiveFrom),
  index("idx_expiration_policy_enabled").on(table.enabled),
]);

export const insertPackptsExpirationPolicySchema = createInsertSchema(packptsExpirationPolicy).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPackptsExpirationPolicy = z.infer<typeof insertPackptsExpirationPolicySchema>;
export type PackptsExpirationPolicy = typeof packptsExpirationPolicy.$inferSelect;

// PackPTS Spend Allocation - tracks which buckets were reduced during a spend
export const packptsSpendAllocation = pgTable("packpts_spend_allocation", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  spendLedgerEntryId: varchar("spend_ledger_entry_id").notNull().references(() => ledgerEntries.id),
  bucketId: varchar("bucket_id").notNull().references(() => packptsBucket.id),
  amount: integer("amount").notNull(), // amount allocated from this bucket
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_spend_allocation_ledger").on(table.spendLedgerEntryId),
  index("idx_spend_allocation_bucket").on(table.bucketId),
]);

export const insertPackptsSpendAllocationSchema = createInsertSchema(packptsSpendAllocation).omit({
  id: true,
  createdAt: true,
});

export type InsertPackptsSpendAllocation = z.infer<typeof insertPackptsSpendAllocationSchema>;
export type PackptsSpendAllocation = typeof packptsSpendAllocation.$inferSelect;

// PackPTS Liability Snapshot - daily accounting snapshot for reporting
export const packptsLiabilitySnapshot = pgTable("packpts_liability_snapshot", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  asOfDate: varchar("as_of_date", { length: 10 }).notNull(), // YYYY-MM-DD
  totalOutstanding: integer("total_outstanding").notNull(),
  outstandingEarned: integer("outstanding_earned").notNull(),
  outstandingPurchased: integer("outstanding_purchased").notNull(),
  outstandingBonus: integer("outstanding_bonus").notNull(),
  expiring30d: integer("expiring_30d").notNull(),
  expiring60d: integer("expiring_60d").notNull(),
  expiring90d: integer("expiring_90d").notNull(),
  aged0_30: integer("aged_0_30").notNull(),
  aged31_90: integer("aged_31_90").notNull(),
  aged91_180: integer("aged_91_180").notNull(),
  aged181_365: integer("aged_181_365").notNull(),
  aged366Plus: integer("aged_366_plus").notNull(),
  breakageEstimatePct: real("breakage_estimate_pct").notNull().default(25), // percentage
  projectedBreakage: integer("projected_breakage").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_liability_snapshot_date").on(table.asOfDate),
]);

export const insertPackptsLiabilitySnapshotSchema = createInsertSchema(packptsLiabilitySnapshot).omit({
  id: true,
  createdAt: true,
});

export type InsertPackptsLiabilitySnapshot = z.infer<typeof insertPackptsLiabilitySnapshotSchema>;
export type PackptsLiabilitySnapshot = typeof packptsLiabilitySnapshot.$inferSelect;

// Default expiration policy values
export const DEFAULT_EXPIRATION_POLICY = {
  earnedDaysToExpire: 365,
  purchasedDaysToExpire: 730, // 2 years for purchased, or null for never
  bonusDefaultDaysToExpire: 90,
  inactivityEnabled: false,
  inactivityDays: 90,
  inactivityMinAgeDays: 90,
  gracePeriodDays: 7,
  breakageEstimatePct: 25,
} as const;

export type StreakAnalyticsEventType = typeof STREAK_ANALYTICS_EVENTS[number];

// Default streak reward schedule
export const DEFAULT_STREAK_SCHEDULE: Record<string, number> = {
  "1": 25, "2": 30, "3": 35, "4": 40, "5": 45, "6": 50, "7": 55,
  "8": 60, "9": 65, "10": 70, "11": 75, "12": 80, "13": 85, "14": 90,
  "15": 95, "16": 100, "17": 105, "18": 110, "19": 115, "20": 120,
  "21": 125, "22": 130, "23": 135, "24": 140, "25": 145, "26": 150,
  "27": 155, "28": 160, "29": 165, "30": 170,
};

export const DEFAULT_MILESTONE_BONUSES: Record<string, number> = {
  "7": 500,
  "14": 1_250,
  "30": 3_000,
  "60": 7_500,
  "100": 15_000,
  "200": 50_000,
  "365": 100_000,
};

export const MAX_DAILY_STREAK_REWARD = 250; // cap for day > 30

// Streak insurance: cost in PackPTS to purchase one streak freeze
export const STREAK_FREEZE_COST_PACKPTS = 500;

// ============================================
// IDENTITY LINKING SYSTEM - Multi-provider Auth Security
// ============================================

// Identity provider types
export const identityProviders = ["local", "replit", "workos"] as const;
export type IdentityProvider = typeof identityProviders[number];

// User identities - links provider accounts to PackPoints users
export const userIdentities = pgTable("user_identities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  provider: varchar("provider", { length: 20 }).notNull(), // local, replit, workos
  providerUserId: varchar("provider_user_id", { length: 255 }).notNull(), // external ID from provider
  email: varchar("email", { length: 255 }), // email as reported by provider
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_identities_user").on(table.userId),
  index("idx_user_identities_provider_id").on(table.provider, table.providerUserId),
  index("idx_user_identities_email").on(table.email),
]);

export const insertUserIdentitySchema = createInsertSchema(userIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserIdentity = z.infer<typeof insertUserIdentitySchema>;
export type UserIdentity = typeof userIdentities.$inferSelect;

// Pending link challenge status
export const linkChallengeStatuses = ["PENDING", "COMPLETED", "CANCELED", "EXPIRED"] as const;
export type LinkChallengeStatus = typeof linkChallengeStatuses[number];

// Pending link challenges - tracks verification flows for email collisions
export const pendingLinkChallenges = pgTable("pending_link_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id", { length: 255 }).notNull(), // express session id
  provider: varchar("provider", { length: 20 }).notNull(),
  providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  targetUserId: varchar("target_user_id").references(() => users.id), // filled once user proves ownership
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  magicLinkToken: varchar("magic_link_token", { length: 128 }).unique(), // hashed token for magic link
  magicLinkExpiresAt: timestamp("magic_link_expires_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_pending_link_session").on(table.sessionId),
  index("idx_pending_link_provider").on(table.provider, table.providerUserId),
  index("idx_pending_link_status").on(table.status),
  index("idx_pending_link_magic_token").on(table.magicLinkToken),
]);

export const insertPendingLinkChallengeSchema = createInsertSchema(pendingLinkChallenges).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPendingLinkChallenge = z.infer<typeof insertPendingLinkChallengeSchema>;
export type PendingLinkChallenge = typeof pendingLinkChallenges.$inferSelect;

// Identity link audit actions
export const linkAuditActions = [
  "LINK_REQUESTED",
  "LINK_BLOCKED",
  "LINK_COMPLETED",
  "LINK_FAILED",
  "MERGE_REQUESTED",
  "MAGIC_LINK_SENT",
  "MAGIC_LINK_VERIFIED",
] as const;
export type LinkAuditAction = typeof linkAuditActions[number];

// Identity link audit - tracks all linking attempts and outcomes
export const identityLinkAudit = pgTable("identity_link_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id").references(() => users.id), // who initiated (logged in user, may be null)
  targetUserId: varchar("target_user_id").references(() => users.id), // target account
  provider: varchar("provider", { length: 20 }).notNull(),
  providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 30 }).notNull(), // LINK_REQUESTED, LINK_BLOCKED, LINK_COMPLETED, etc.
  reason: text("reason"), // why the action occurred
  ipAddress: varchar("ip_address", { length: 45 }), // IPv4 or IPv6
  userAgent: text("user_agent"),
  deviceFingerprint: varchar("device_fingerprint", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_link_audit_actor").on(table.actorUserId),
  index("idx_link_audit_target").on(table.targetUserId),
  index("idx_link_audit_provider").on(table.provider, table.providerUserId),
  index("idx_link_audit_action").on(table.action),
  index("idx_link_audit_created").on(table.createdAt),
]);

export const insertIdentityLinkAuditSchema = createInsertSchema(identityLinkAudit).omit({
  id: true,
  createdAt: true,
});

export type InsertIdentityLinkAudit = z.infer<typeof insertIdentityLinkAuditSchema>;
export type IdentityLinkAudit = typeof identityLinkAudit.$inferSelect;

// High-value account threshold configuration
export const HIGH_VALUE_PACKPTS_THRESHOLD = 10000;
export const HIGH_VALUE_REQUIRE_MAGIC_LINK = true;

// Link challenge expiration time (15 minutes)
export const LINK_CHALLENGE_EXPIRY_MINUTES = 15;

// Magic link expiration time (15 minutes)
export const MAGIC_LINK_EXPIRY_MINUTES = 15;

// ==================== FOUNDERS CAP SYSTEM ====================

// Default Founders Cap configuration
export const FOUNDERS_CAP_DEFAULT = {
  maxActiveUsers: 500,
  enabled: true,
  inviteBypass: true,
  reservedSeatsForInvites: 100,
};

// App configuration table for runtime settings
export const appConfig = pgTable("app_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by").references(() => users.id),
});

export type AppConfig = typeof appConfig.$inferSelect;

// Waitlist entry statuses
export const waitlistStatuses = ["WAITING", "INVITED", "ACCEPTED", "REJECTED"] as const;
export type WaitlistStatus = typeof waitlistStatuses[number];

// Waitlist entries table
export const waitlistEntries = pgTable("waitlist_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull(),
  emailNormalized: varchar("email_normalized", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("WAITING"),
  position: integer("position").notNull(),
  referralCode: varchar("referral_code", { length: 20 }).unique(),
  referredByCode: varchar("referred_by_code", { length: 20 }),
  referralsCount: integer("referrals_count").notNull().default(0),
  inviteCodeSent: varchar("invite_code_sent", { length: 20 }),
  invitedAt: timestamp("invited_at"),
  acceptedAt: timestamp("accepted_at"),
  deviceFingerprint: varchar("device_fingerprint", { length: 128 }),
  signupIp: varchar("signup_ip", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_waitlist_email_normalized").on(table.emailNormalized),
  index("idx_waitlist_status").on(table.status),
  index("idx_waitlist_position").on(table.position),
  index("idx_waitlist_referral_code").on(table.referralCode),
]);

export const insertWaitlistEntrySchema = createInsertSchema(waitlistEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  referralsCount: true,
});

export type InsertWaitlistEntry = z.infer<typeof insertWaitlistEntrySchema>;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;

// Invite codes table
export const inviteCodes = pgTable("invite_codes", {
  code: varchar("code", { length: 20 }).primaryKey(),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  reservedSeat: boolean("reserved_seat").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdByAdminUserId: varchar("created_by_admin_user_id").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_invite_codes_expires").on(table.expiresAt),
]);

export const insertInviteCodeSchema = createInsertSchema(inviteCodes).omit({
  uses: true,
  createdAt: true,
});

export type InsertInviteCode = z.infer<typeof insertInviteCodeSchema>;
export type InviteCode = typeof inviteCodes.$inferSelect;

// Access audit actions
export const accessAuditActions = [
  "ACTIVATION_ATTEMPT",
  "ACTIVATION_SUCCESS",
  "ACTIVATION_WAITLISTED",
  "INVITE_VALIDATED",
  "INVITE_CONSUMED",
  "INVITE_INVALID",
  "INVITE_EXPIRED",
  "WAITLIST_JOIN",
  "WAITLIST_INVITED",
  "WAITLIST_ACCEPTED",
  "ADMIN_CAP_CHANGE",
  "ADMIN_INVITE_CREATE",
  "ABUSE_BLOCKED",
] as const;
export type AccessAuditAction = typeof accessAuditActions[number];

// Access audit log table
export const accessAuditLog = pgTable("access_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: varchar("action", { length: 30 }).notNull(),
  userId: varchar("user_id").references(() => users.id),
  email: varchar("email", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  deviceFingerprint: varchar("device_fingerprint", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_access_audit_action").on(table.action),
  index("idx_access_audit_user").on(table.userId),
  index("idx_access_audit_created").on(table.createdAt),
  index("idx_access_audit_ip").on(table.ipAddress),
]);

export const insertAccessAuditLogSchema = createInsertSchema(accessAuditLog).omit({
  id: true,
  createdAt: true,
});

export type InsertAccessAuditLog = z.infer<typeof insertAccessAuditLogSchema>;
export type AccessAuditLog = typeof accessAuditLog.$inferSelect;

// Active user counter table for atomic cap enforcement
export const activeUserCounter = pgTable("active_user_counter", {
  id: integer("id").primaryKey().default(1),
  count: integer("count").notNull().default(0),
  reservedSeatsUsed: integer("reserved_seats_used").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ActiveUserCounter = typeof activeUserCounter.$inferSelect;

// ============================================
// FOUNDERS PASS (Viral Invite System)
// ============================================

export const foundersPassStatusEnum = pgEnum("founders_pass_status", [
  "ACTIVE",
  "CONSUMED",
  "DEACTIVATED",
  "EXPIRED",
]);

export const foundersPass = pgTable("founders_pass", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: varchar("token_hash", { length: 128 }).unique().notNull(),
  issuedToUserId: varchar("issued_to_user_id").references(() => users.id).notNull(),
  status: foundersPassStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow(),
  consumedAt: timestamp("consumed_at"),
  consumedByUserId: varchar("consumed_by_user_id").references(() => users.id),
  consumedByIp: varchar("consumed_by_ip", { length: 45 }),
  consumedByDeviceFingerprint: varchar("consumed_by_device_fingerprint", { length: 128 }),
  deactivatedAt: timestamp("deactivated_at"),
}, (table) => [
  index("idx_founders_pass_issued_to").on(table.issuedToUserId),
  index("idx_founders_pass_status").on(table.status),
  index("idx_founders_pass_token_hash").on(table.tokenHash),
]);

export type InsertFoundersPass = typeof foundersPass.$inferInsert;
export type FoundersPass = typeof foundersPass.$inferSelect;

export const foundersPassEventTypeEnum = pgEnum("founders_pass_event_type", [
  "ISSUED",
  "LINK_VIEWED",
  "REDEEM_ATTEMPT",
  "REDEEM_SUCCESS",
  "REDEEM_FAIL",
  "DEACTIVATED_GLOBAL",
  "DEACTIVATED_INDIVIDUAL",
]);

export const foundersPassEvents = pgTable("founders_pass_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  passId: varchar("pass_id").references(() => foundersPass.id).notNull(),
  eventType: foundersPassEventTypeEnum("event_type").notNull(),
  ip: varchar("ip", { length: 45 }),
  userAgent: text("user_agent"),
  deviceFingerprint: varchar("device_fingerprint", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_founders_pass_events_pass").on(table.passId),
  index("idx_founders_pass_events_type").on(table.eventType),
  index("idx_founders_pass_events_created").on(table.createdAt),
]);

export type InsertFoundersPassEvent = typeof foundersPassEvents.$inferInsert;
export type FoundersPassEvent = typeof foundersPassEvents.$inferSelect;

// ============================================
// LIVE LISTINGS MARKETPLACE
// ============================================

export const marketplaceSourceEnum = pgEnum("marketplace_source", [
  "ebay",
  "goldin",
]);

export const marketplaceCache = pgTable("marketplace_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: marketplaceSourceEnum("source").notNull(),
  cacheKey: text("cache_key").notNull().unique(),
  payload: jsonb("payload").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_marketplace_cache_source_key").on(table.source, table.cacheKey),
  index("idx_marketplace_cache_expires").on(table.expiresAt),
]);

export type InsertMarketplaceCache = typeof marketplaceCache.$inferInsert;
export type MarketplaceCache = typeof marketplaceCache.$inferSelect;

export const outboundClicks = pgTable("outbound_clicks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: marketplaceSourceEnum("source").notNull(),
  listingId: text("listing_id").notNull(),
  destinationUrl: text("destination_url").notNull(),
  outboundUrl: text("outbound_url"),
  customId: text("custom_id"),
  userId: varchar("user_id").references(() => users.id),
  sessionId: text("session_id"),
  ip: varchar("ip", { length: 45 }),
  ipHash: varchar("ip_hash", { length: 64 }),
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  pagePath: text("page_path"),
  cardSetId: varchar("card_set_id"),
  cardId: varchar("card_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_outbound_clicks_source").on(table.source),
  index("idx_outbound_clicks_user").on(table.userId),
  index("idx_outbound_clicks_created").on(table.createdAt),
  index("idx_outbound_clicks_listing").on(table.listingId),
]);

export type InsertOutboundClick = typeof outboundClicks.$inferInsert;
export type OutboundClick = typeof outboundClicks.$inferSelect;

export const externalListingsSnapshot = pgTable("external_listings_snapshot", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: marketplaceSourceEnum("source").notNull(),
  query: text("query").notNull(),
  listingCount: integer("listing_count").notNull(),
  minPriceCents: integer("min_price_cents"),
  maxPriceCents: integer("max_price_cents"),
  capturedAt: timestamp("captured_at").defaultNow(),
}, (table) => [
  index("idx_external_listings_source").on(table.source),
  index("idx_external_listings_captured").on(table.capturedAt),
]);

export type InsertExternalListingsSnapshot = typeof externalListingsSnapshot.$inferInsert;
export type ExternalListingsSnapshot = typeof externalListingsSnapshot.$inferSelect;

export const goldinCuratedListings = pgTable("goldin_curated_listings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  destinationUrl: text("destination_url").notNull(),
  endsAt: timestamp("ends_at"),
  priceDisplay: text("price_display"),
  tags: text("tags").array(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_goldin_curated_active").on(table.isActive),
  index("idx_goldin_curated_ends").on(table.endsAt),
]);

export const insertGoldinCuratedListingSchema = createInsertSchema(goldinCuratedListings).omit({
  id: true,
  createdAt: true,
});

export type InsertGoldinCuratedListing = z.infer<typeof insertGoldinCuratedListingSchema>;
export type GoldinCuratedListing = typeof goldinCuratedListings.$inferSelect;

// Game Sets - canonical playable card set contexts
export const sportEnum = ["baseball", "basketball", "football", "hockey"] as const;
export type Sport = typeof sportEnum[number];

export const gameSets = pgTable("game_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sport: text("sport").notNull(),
  brand: text("brand").notNull(),
  year: integer("year").notNull(),
  setName: text("set_name").notNull(),
  league: text("league"),
  isActive: boolean("is_active").notNull().default(true),
  marketplaceKeywords: jsonb("marketplace_keywords").$type<string[]>().notNull().default([]),
  cardhedgeSetQuery: text("cardhedge_set_query"), // Exact query string for Card Hedge API
  cardhedgeCategory: text("cardhedge_category"), // Card Hedge category (Baseball, Basketball, etc.)
  cardsImportedCount: integer("cards_imported_count").notNull().default(0),
  lastImportAt: timestamp("last_import_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_game_sets_active").on(table.isActive),
  index("idx_game_sets_sport_year").on(table.sport, table.year),
]);

export const insertGameSetSchema = createInsertSchema(gameSets).omit({
  id: true,
  createdAt: true,
});

export const updateGameSetSchema = z.object({
  setName: z.string().min(1).optional(),
  sport: z.enum(sportEnum).optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  brand: z.string().min(1).optional(),
  marketplaceKeywords: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  cardhedgeSetQuery: z.string().optional(),
  cardhedgeCategory: z.string().optional(),
});

export type InsertGameSet = z.infer<typeof insertGameSetSchema>;
export type UpdateGameSet = z.infer<typeof updateGameSetSchema>;
export type GameSet = typeof gameSets.$inferSelect;

export type PlayableSet = {
  id: string;
  sport: string;
  brand: string;
  year: number;
  setName: string;
  league: string | null;
  cardsImportedCount: number;
};

// User Active Sets - which game sets a user has selected
export const userActiveSets = pgTable("user_active_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  gameSetId: varchar("game_set_id").notNull().references(() => gameSets.id),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  isDefault: boolean("is_default").notNull().default(false),
}, (table) => [
  index("idx_user_active_sets_user").on(table.userId),
  index("idx_user_active_sets_game_set").on(table.gameSetId),
]);

export const insertUserActiveSetSchema = createInsertSchema(userActiveSets).omit({
  id: true,
});

export type InsertUserActiveSet = z.infer<typeof insertUserActiveSetSchema>;
export type UserActiveSet = typeof userActiveSets.$inferSelect;

// Match Context Log - tracks which contexts users play
export const matchContextEventTypes = ["MATCH_STARTED", "MATCH_COMPLETED", "SET_SELECTED"] as const;
export type MatchContextEventType = typeof matchContextEventTypes[number];

export const matchContextLog = pgTable("match_context_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  matchId: varchar("match_id"),
  gameSetId: varchar("game_set_id").notNull().references(() => gameSets.id),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_match_context_user_created").on(table.userId, table.createdAt),
  index("idx_match_context_game_set").on(table.gameSetId),
]);

export const insertMatchContextLogSchema = createInsertSchema(matchContextLog).omit({
  id: true,
  createdAt: true,
});

export type InsertMatchContextLog = z.infer<typeof insertMatchContextLogSchema>;
export type MatchContextLog = typeof matchContextLog.$inferSelect;

// API schemas for game set endpoints
export const updateActiveGameSetsSchema = z.object({
  gameSetIds: z.array(z.string().uuid("Each game set ID must be valid")),
  defaultSetId: z.string().uuid("Default set ID must be valid").optional(),
});

export type UpdateActiveGameSetsRequest = z.infer<typeof updateActiveGameSetsSchema>;

// Contextual search params
export const contextualSearchSchema = z.object({
  q: z.string().optional(),
  source: z.enum(["ebay", "goldin", "all"]).default("all"),
  setId: z.string().uuid("Please select a valid card set").optional(),
  limit: z.number().min(1).max(100).default(20),
  sort: z.enum(["relevance", "priceAsc", "priceDesc", "endingSoon"]).default("relevance"),
  forceRefresh: z.boolean().default(false),
});

export type ContextualSearchParams = z.infer<typeof contextualSearchSchema>;

// Subscription Products - admin-managed monthly PackPTS subscription packages
export const billingIntervals = ["month", "year"] as const;
export type BillingInterval = typeof billingIntervals[number];

export const subscriptionProducts = pgTable("subscription_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  packptsGrant: integer("packpts_grant").notNull(), // PackPTS credited each billing cycle
  priceUsd: integer("price_usd").notNull(), // price in cents (e.g., 499 = $4.99)
  billingInterval: varchar("billing_interval", { length: 20 }).notNull().default("month"),
  stripePriceId: varchar("stripe_price_id", { length: 100 }), // Stripe Price ID for checkout
  sortOrder: integer("sort_order").notNull().default(0), // for display ordering
  isBestValue: boolean("is_best_value").notNull().default(false), // highlight badge
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_subscription_products_active").on(table.isActive),
  index("idx_subscription_products_sort").on(table.sortOrder),
]);

export const insertSubscriptionProductSchema = createInsertSchema(subscriptionProducts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSubscriptionProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  packptsGrant: z.number().int().positive().optional(),
  priceUsd: z.number().int().positive().optional(),
  billingInterval: z.enum(billingIntervals).optional(),
  stripePriceId: z.string().max(100).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isBestValue: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type InsertSubscriptionProduct = z.infer<typeof insertSubscriptionProductSchema>;
export type UpdateSubscriptionProduct = z.infer<typeof updateSubscriptionProductSchema>;
export type SubscriptionProduct = typeof subscriptionProducts.$inferSelect;

// ============================================
// GEO INTELLIGENCE TABLES
// ============================================

// Geo session source enum
export const geoSessionSources = ["http", "ws"] as const;
export type GeoSessionSource = typeof geoSessionSources[number];

// User geo session - tracks session-level geo data with privacy-safe IP hashing
export const userGeoSession = pgTable("user_geo_session", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  sessionId: text("session_id"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  ipHash: text("ip_hash"), // HMAC-SHA256 hashed IP for privacy
  userAgent: text("user_agent"),
  timezone: text("timezone"), // from X-Client-Timezone header
  country: text("country"),
  region: text("region"), // US state code (CA, MA, HI, etc.)
  asn: text("asn"),
  carrierName: text("carrier_name"),
  isVpn: boolean("is_vpn"),
  source: varchar("source", { length: 10 }).notNull().default("http"),
  geoConfidence: integer("geo_confidence").notNull().default(0), // 0-100
}, (table) => [
  index("idx_user_geo_session_user_last_seen").on(table.userId, table.lastSeenAt),
  index("idx_user_geo_session_country_region").on(table.country, table.region),
  index("idx_user_geo_session_session_id").on(table.sessionId),
]);

export const insertUserGeoSessionSchema = createInsertSchema(userGeoSession).omit({
  id: true,
});

export type InsertUserGeoSession = z.infer<typeof insertUserGeoSessionSchema>;
export type UserGeoSession = typeof userGeoSession.$inferSelect;

// User geo profile - computed home state with confidence
export const userGeoProfile = pgTable("user_geo_profile", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  homeCountry: text("home_country"),
  homeRegion: text("home_region"), // Inferred "home state"
  confidence: integer("confidence").notNull().default(0), // 0-100
  basis: jsonb("basis"), // Stats used to compute home state (top 3 states, scores)
  lastComputedAt: timestamp("last_computed_at").defaultNow(),
});

export const insertUserGeoProfileSchema = createInsertSchema(userGeoProfile);

export type InsertUserGeoProfile = z.infer<typeof insertUserGeoProfileSchema>;
export type UserGeoProfile = typeof userGeoProfile.$inferSelect;

// Geo rollups daily - pre-aggregated stats for fast admin queries
export const geoRollupsDaily = pgTable("geo_rollups_daily", {
  day: timestamp("day").notNull(),
  country: text("country").notNull(),
  region: text("region").notNull(),
  activeUsers: integer("active_users").notNull().default(0),
  sessions: integer("sessions").notNull().default(0),
  newUsers: integer("new_users").notNull().default(0),
}, (table) => [
  uniqueIndex("idx_geo_rollups_daily_unique").on(table.day, table.country, table.region),
  index("idx_geo_rollups_daily_day").on(table.day),
]);

export const insertGeoRollupsDailySchema = createInsertSchema(geoRollupsDaily);

export type InsertGeoRollupsDaily = z.infer<typeof insertGeoRollupsDailySchema>;
export type GeoRollupsDaily = typeof geoRollupsDaily.$inferSelect;

// Playable Cards - cards imported from Card Hedge for gameplay
export const imageReviewStatuses = ["unreviewed", "reported", "approved", "rejected"] as const;
export type ImageReviewStatus = typeof imageReviewStatuses[number];

export const quarantineStatuses = ["OK", "SUSPECT_TRANSIENT", "SUSPECT_PERSISTENT", "QUARANTINED_ADMIN_REVIEW"] as const;
export type QuarantineStatus = typeof quarantineStatuses[number];

export const playableCards = pgTable("playable_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameSetId: varchar("game_set_id").notNull().references(() => gameSets.id),
  cardhedgeCardId: text("cardhedge_card_id").notNull().unique(), // Card Hedge card_id
  description: text("description"),
  player: text("player"),
  set: text("set"),
  number: text("number"),
  variant: text("variant"),
  imageUrl: text("image_url"),
  category: text("category"),
  rookie: boolean("rookie"),
  rawImagesOnly: boolean("raw_images_only").notNull().default(false),
  isPlayable: boolean("is_playable").notNull().default(true), // false for checklists, multi-player cards
  blockedReason: text("blocked_reason"), // Reason if isPlayable=false (e.g., "checklist", "multi-player")
  imageReviewStatus: varchar("image_review_status", { length: 20 }).notNull().default("unreviewed"), // Image quality review
  reportCount: integer("report_count").notNull().default(0), // Number of user reports for wrong image
  imageRotation: integer("image_rotation").notNull().default(0), // Rotation correction: 0, 90, 180, 270 degrees
  lastImageCheck: timestamp("last_image_check"),
  imageFailureCount: integer("image_failure_count").notNull().default(0),
  imageLastError: text("image_last_error"),
  contentVerified: boolean("content_verified"), // Pixel-level content analysis passed (NULL=pending, true=passed, false=failed)
  contentVerifiedAt: timestamp("content_verified_at"), // When content was last verified
  quarantineStatus: varchar("quarantine_status", { length: 30 }).notNull().default("OK"), // OK, SUSPECT_TRANSIENT, SUSPECT_PERSISTENT, QUARANTINED_ADMIN_REVIEW
  proposedUnplayable: boolean("proposed_unplayable").notNull().default(false), // True when CardHedge confirms removal, awaiting admin approval
  validationFailCount: integer("validation_fail_count").notNull().default(0), // Cumulative validation failures
  lastValidationReason: text("last_validation_reason"), // Reason for last validation failure
  lastValidationHttpStatus: integer("last_validation_http_status"), // HTTP status from last validation
  lastValidationContentType: text("last_validation_content_type"), // Content-Type from last validation
  lastValidationCheckedAt: timestamp("last_validation_checked_at"), // When last validation occurred
  firstValidationFailAt: timestamp("first_validation_fail_at"), // When validation first started failing (for 24h rule)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_playable_cards_game_set").on(table.gameSetId),
  index("idx_playable_cards_player").on(table.player),
  index("idx_playable_cards_set").on(table.set),
  index("idx_playable_cards_number").on(table.number),
  index("idx_playable_cards_is_playable").on(table.isPlayable),
  index("idx_playable_cards_image_review").on(table.imageReviewStatus),
  index("idx_playable_cards_last_check").on(table.lastImageCheck),
  index("idx_playable_cards_content_verified").on(table.contentVerified),
  index("idx_playable_cards_quarantine").on(table.quarantineStatus),
  index("idx_playable_cards_proposed_unplayable").on(table.proposedUnplayable),
]);

export const insertPlayableCardSchema = createInsertSchema(playableCards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPlayableCard = z.infer<typeof insertPlayableCardSchema>;
export type PlayableCard = typeof playableCards.$inferSelect;

// Card Image Reports - user reports for wrong/mismatched card images
export const cardImageReportReasons = ["wrong_sport", "wrong_player", "wrong_set", "bad_image", "upside_down", "multi_player", "other"] as const;
export type CardImageReportReason = typeof cardImageReportReasons[number];

export const cardImageReports = pgTable("card_image_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cardId: varchar("card_id").notNull().references(() => playableCards.id),
  reporterId: varchar("reporter_id").references(() => users.id), // null for guest reports
  sessionId: varchar("session_id"), // game session where report was made
  reason: varchar("reason", { length: 30 }).notNull(), // wrong_sport, wrong_player, wrong_set, bad_image, other
  description: text("description"), // Optional user description
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, reviewed, resolved, dismissed
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"), // What action was taken
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_card_image_reports_card").on(table.cardId),
  index("idx_card_image_reports_status").on(table.status),
  index("idx_card_image_reports_reporter").on(table.reporterId),
]);

export const insertCardImageReportSchema = createInsertSchema(cardImageReports).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});

export const createCardImageReportSchema = z.object({
  cardId: z.string().min(1),
  sessionId: z.string().optional(),
  reason: z.enum(cardImageReportReasons),
  description: z.string().max(500).optional(),
});

export type InsertCardImageReport = z.infer<typeof insertCardImageReportSchema>;
export type CardImageReport = typeof cardImageReports.$inferSelect;

// Card Hedge Import Runs - tracking import job status
export const importRunStatuses = ["PENDING", "RUNNING", "SUCCESS", "FAILED"] as const;
export type ImportRunStatus = typeof importRunStatuses[number];

export const cardhedgeImportRuns = pgTable("cardhedge_import_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gameSetId: varchar("game_set_id").notNull().references(() => gameSets.id),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
  pageSize: integer("page_size").notNull().default(100),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  cardsImported: integer("cards_imported").notNull().default(0),
  error: text("error"),
}, (table) => [
  index("idx_cardhedge_import_runs_game_set").on(table.gameSetId),
  index("idx_cardhedge_import_runs_status").on(table.status),
]);

export const insertCardhedgeImportRunSchema = createInsertSchema(cardhedgeImportRuns).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
});

export type InsertCardhedgeImportRun = z.infer<typeof insertCardhedgeImportRunSchema>;
export type CardhedgeImportRun = typeof cardhedgeImportRuns.$inferSelect;

// ============================================
// PROFIT GUARDRAIL & MARKETPLACE REDEMPTIONS
// ============================================

// Profit Policy - single active row, versioned for auditability
export const profitPolicy = pgTable("profit_policy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  minMarginM: real("min_margin_m").notNull().default(0.25), // minimum profit margin (e.g., 0.25 = 25%)
  affiliateRateA: real("affiliate_rate_a").notNull().default(0.02), // affiliate revenue rate (e.g., 0.02 = 2%)
  affiliateHaircutH: real("affiliate_haircut_h").notNull().default(0.70), // haircut for affiliate reliability (e.g., 0.70 = 70%)
  processingFeeRateR: real("processing_fee_rate_r").notNull().default(0.00), // processing fee rate
  fixedFeeFCents: integer("fixed_fee_f_cents").notNull().default(0), // fixed fee in cents
  packptsValueVMicrousd: integer("packpts_value_v_microusd").notNull().default(2000), // value per PackPTS in micro-USD (2000 = $0.002)
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_profit_policy_effective").on(table.effectiveFrom),
  index("idx_profit_policy_enabled").on(table.enabled),
]);

export const insertProfitPolicySchema = createInsertSchema(profitPolicy).omit({
  id: true,
  createdAt: true,
});

export type InsertProfitPolicy = z.infer<typeof insertProfitPolicySchema>;
export type ProfitPolicy = typeof profitPolicy.$inferSelect;

// External Purchase Intent Status Enum
export const purchaseIntentStatusEnum = pgEnum("purchase_intent_status", [
  "CREATED",
  "APPROVED",
  "DENIED",
  "PURCHASE_CONFIRMED",
  "CREDIT_GRANTED",
  "CANCELED",
]);

// External Purchase Intent - tracks the listing and redemption calculation
export const externalPurchaseIntent = pgTable("external_purchase_intent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  source: marketplaceSourceEnum("source").notNull(),
  listingId: text("listing_id").notNull(),
  listingUrl: text("listing_url").notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  computedRmax: integer("computed_rmax").notNull().default(0),
  requestedRedeemPackpts: integer("requested_redeem_packpts").notNull().default(0),
  approvedRedeemPackpts: integer("approved_redeem_packpts").notNull().default(0),
  status: purchaseIntentStatusEnum("status").notNull().default("CREATED"),
  calcSnapshot: jsonb("calc_snapshot").$type<{
    P: number; // purchase price USD
    A: number; // affiliate rate
    h: number; // haircut
    m: number; // min margin
    r: number; // processing rate
    f: number; // fixed fee USD
    v: number; // USD per PackPTS
    Cmax: number; // max credit USD
    Rmax: number; // max redeemable PackPTS
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_external_purchase_intent_user").on(table.userId),
  index("idx_external_purchase_intent_status").on(table.status),
  index("idx_external_purchase_intent_source").on(table.source),
  index("idx_external_purchase_intent_created").on(table.createdAt),
]);

export const insertExternalPurchaseIntentSchema = createInsertSchema(externalPurchaseIntent).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertExternalPurchaseIntent = z.infer<typeof insertExternalPurchaseIntentSchema>;
export type ExternalPurchaseIntent = typeof externalPurchaseIntent.$inferSelect;

// Redemption Credit Status Enum
export const redemptionCreditStatusEnum = pgEnum("redemption_credit_status", [
  "PENDING",
  "GRANTED",
  "REVERSED",
]);

// Redemption Credit - what we grant as store credit / rebate credit
export const redemptionCredit = pgTable("redemption_credit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseIntentId: varchar("purchase_intent_id").notNull().references(() => externalPurchaseIntent.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  packptsSpent: integer("packpts_spent").notNull(),
  creditCents: integer("credit_cents").notNull(),
  status: redemptionCreditStatusEnum("status").notNull().default("PENDING"),
  ledgerSpendEntryId: varchar("ledger_spend_entry_id").references(() => ledgerEntries.id),
  ledgerCreditEntryId: varchar("ledger_credit_entry_id").references(() => ledgerEntries.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_redemption_credit_purchase_intent").on(table.purchaseIntentId),
  index("idx_redemption_credit_user").on(table.userId),
  index("idx_redemption_credit_status").on(table.status),
  unique("redemption_credit_purchase_intent_unique").on(table.purchaseIntentId),
]);

export const insertRedemptionCreditSchema = createInsertSchema(redemptionCredit).omit({
  id: true,
  createdAt: true,
});

export type InsertRedemptionCredit = z.infer<typeof insertRedemptionCreditSchema>;
export type RedemptionCredit = typeof redemptionCredit.$inferSelect;

// API schemas for profit guardrail
export const redemptionQuoteRequestSchema = z.object({
  source: z.enum(["ebay", "goldin"]),
  listingId: z.string().min(1),
  listingUrl: z.string().url(),
  priceCents: z.number().int().positive(),
  currency: z.string().default("usd"),
});

export type RedemptionQuoteRequest = z.infer<typeof redemptionQuoteRequestSchema>;

export const redemptionApplyRequestSchema = z.object({
  purchaseIntentId: z.string().uuid(),
  requestedRedeemPackpts: z.number().int().min(0),
});

export type RedemptionApplyRequest = z.infer<typeof redemptionApplyRequestSchema>;

export const purchaseConfirmRequestSchema = z.object({
  purchaseIntentId: z.string().uuid(),
  evidence: z.string().optional(), // receipt URL or reference
});

export type PurchaseConfirmRequest = z.infer<typeof purchaseConfirmRequestSchema>;

// ============================================
// TREASURY & MARGIN POOL SYSTEM
// ============================================

// Margin Ledger Source Type Enum
export const marginSourceTypeEnum = pgEnum("margin_source_type", [
  "PACKPTS_SALE",      // Revenue from selling PackPTS bundles
  "AFFILIATE_PAYOUT",  // Confirmed affiliate commission
  "PARTNER_REBATE",    // Partner/merchant rebates
  "MANUAL_ADJUSTMENT", // Admin manual adjustments
]);

// Margin Ledger - company-side accounting (NOT user-visible)
export const marginLedger = pgTable("margin_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceType: marginSourceTypeEnum("source_type").notNull(),
  amountCents: integer("amount_cents").notNull(), // positive only
  referenceId: text("reference_id"), // link to order/payout/etc
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_margin_ledger_source_type").on(table.sourceType),
  index("idx_margin_ledger_created").on(table.createdAt),
]);

export const insertMarginLedgerSchema = createInsertSchema(marginLedger).omit({
  id: true,
  createdAt: true,
});

export type InsertMarginLedger = z.infer<typeof insertMarginLedgerSchema>;
export type MarginLedger = typeof marginLedger.$inferSelect;

// Margin Usage - tracks consumed margin per redemption
export const marginUsage = pgTable("margin_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  redemptionId: varchar("redemption_id").notNull().references(() => redemptionCredit.id),
  amountCents: integer("amount_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_margin_usage_redemption").on(table.redemptionId),
  index("idx_margin_usage_created").on(table.createdAt),
]);

export const insertMarginUsageSchema = createInsertSchema(marginUsage).omit({
  id: true,
  createdAt: true,
});

export type InsertMarginUsage = z.infer<typeof insertMarginUsageSchema>;
export type MarginUsage = typeof marginUsage.$inferSelect;

// Reservation Status Enum
export const reservationStatusEnum = pgEnum("reservation_status", [
  "ACTIVE",   // Reserved, pending purchase
  "RELEASED", // Canceled, margin returned to pool
  "CONSUMED", // Purchase confirmed, margin used
]);

// Redemption Reservations - prevents race conditions on margin pool
export const redemptionReservations = pgTable("redemption_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseIntentId: varchar("purchase_intent_id").notNull().references(() => externalPurchaseIntent.id),
  reservedCents: integer("reserved_cents").notNull(),
  status: reservationStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_redemption_reservations_intent").on(table.purchaseIntentId),
  index("idx_redemption_reservations_status").on(table.status),
  unique("redemption_reservations_intent_unique").on(table.purchaseIntentId),
]);

export const insertRedemptionReservationSchema = createInsertSchema(redemptionReservations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRedemptionReservation = z.infer<typeof insertRedemptionReservationSchema>;
export type RedemptionReservation = typeof redemptionReservations.$inferSelect;

// Marketplace Margin Config - per-source affiliate rates and haircuts
export const marketplaceMarginConfig = pgTable("marketplace_margin_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: marketplaceSourceEnum("source").notNull().unique(),
  affiliateRate: real("affiliate_rate").notNull().default(0.02), // e.g., 0.02 = 2%
  haircut: real("haircut").notNull().default(0.50), // e.g., 0.50 = 50%
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_marketplace_margin_config_source").on(table.source),
]);

export const insertMarketplaceMarginConfigSchema = createInsertSchema(marketplaceMarginConfig).omit({
  id: true,
  updatedAt: true,
});

export type InsertMarketplaceMarginConfig = z.infer<typeof insertMarketplaceMarginConfigSchema>;
export type MarketplaceMarginConfig = typeof marketplaceMarginConfig.$inferSelect;

// API schemas for treasury
export const manualMarginCreditSchema = z.object({
  amountCents: z.number().int().positive(),
  sourceType: z.enum(["PACKPTS_SALE", "AFFILIATE_PAYOUT", "PARTNER_REBATE", "MANUAL_ADJUSTMENT"]),
  note: z.string().optional(),
  referenceId: z.string().optional(),
});

export type ManualMarginCredit = z.infer<typeof manualMarginCreditSchema>;

export const updateMarketplaceMarginConfigSchema = z.object({
  source: z.enum(["ebay", "goldin"]),
  affiliateRate: z.number().min(0).max(1),
  haircut: z.number().min(0).max(1),
});

export type UpdateMarketplaceMarginConfig = z.infer<typeof updateMarketplaceMarginConfigSchema>;

// ============================================
// REWARD SYSTEM - Fame-based PackPTS awards
// ============================================

// Reward Policy - versioned, one active at a time
export const rewardPolicy = pgTable("reward_policy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  enabled: boolean("enabled").notNull().default(true),
  minPts: integer("min_pts").notNull().default(100),
  maxPts: integer("max_pts").notNull().default(200),
  gamma: real("gamma").notNull().default(2.0),
  maxAwardCap: integer("max_award_cap").notNull().default(250),
  vintageMultipliers: jsonb("vintage_multipliers").notNull().default({
    pre1980: 1.15,
    "1980_1999": 1.05,
    "2000_2019": 1.0,
    "2020_plus": 0.9,
  }),
  rarityMultipliers: jsonb("rarity_multipliers").notNull().default({
    base: 1.0,
    insert: 1.1,
    parallel: 1.2,
    sp: 1.3,
  }),
  dailyPointsCap: integer("daily_points_cap").notNull().default(5000),
  perMatchPointsCap: integer("per_match_points_cap").notNull().default(1000),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_reward_policy_effective").on(table.effectiveFrom),
  index("idx_reward_policy_enabled").on(table.enabled),
]);

export const insertRewardPolicySchema = createInsertSchema(rewardPolicy).omit({
  id: true,
  createdAt: true,
});

export type InsertRewardPolicy = z.infer<typeof insertRewardPolicySchema>;
export type RewardPolicy = typeof rewardPolicy.$inferSelect;

// Player Fame - stores fame scores for players
export const playerFame = pgTable("player_fame", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sport: varchar("sport", { length: 20 }).notNull().default("baseball"),
  playerName: text("player_name").notNull(),
  playerKey: text("player_key").notNull().unique(),
  fameScore: real("fame_score").notNull().default(0.5),
  sourceBreakdown: jsonb("source_breakdown").default({}),
  lastUpdated: timestamp("last_updated").defaultNow(),
}, (table) => [
  index("idx_player_fame_sport_name").on(table.sport, table.playerName),
  index("idx_player_fame_key").on(table.playerKey),
]);

export const insertPlayerFameSchema = createInsertSchema(playerFame).omit({
  id: true,
  lastUpdated: true,
});

export type InsertPlayerFame = z.infer<typeof insertPlayerFameSchema>;
export type PlayerFame = typeof playerFame.$inferSelect;

// Award reason enum
export const awardReasonEnum = pgEnum("award_reason", ["QUIZ_CORRECT", "STREAK_BONUS", "OTHER"]);

// Rarity type enum for cards
export const rarityTypeEnum = pgEnum("rarity_type", ["base", "insert", "parallel", "sp"]);

// Points Awards - append-only audit log
export const pointsAwards = pgTable("points_awards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  matchId: varchar("match_id"),
  cardId: varchar("card_id"),
  playerKey: text("player_key"),
  fameScore: real("fame_score"),
  basePts: integer("base_pts").notNull(),
  vintageMultiplier: real("vintage_multiplier").notNull().default(1.0),
  rarityMultiplier: real("rarity_multiplier").notNull().default(1.0),
  finalPts: integer("final_pts").notNull(),
  policyId: varchar("policy_id").references(() => rewardPolicy.id),
  reason: awardReasonEnum("reason").notNull().default("QUIZ_CORRECT"),
  idempotencyKey: varchar("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_points_awards_user_created").on(table.userId, table.createdAt),
  index("idx_points_awards_match").on(table.matchId),
  index("idx_points_awards_idempotency").on(table.idempotencyKey),
]);

export const insertPointsAwardSchema = createInsertSchema(pointsAwards).omit({
  id: true,
  createdAt: true,
});

export type InsertPointsAward = z.infer<typeof insertPointsAwardSchema>;
export type PointsAward = typeof pointsAwards.$inferSelect;

// User Points Counters - for daily cap enforcement
export const userPointsCounters = pgTable("user_points_counters", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  date: varchar("date", { length: 10 }).notNull(),
  pointsAwardedToday: integer("points_awarded_today").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_points_counters_date").on(table.date),
]);

export const insertUserPointsCounterSchema = createInsertSchema(userPointsCounters).omit({
  updatedAt: true,
});

export type InsertUserPointsCounter = z.infer<typeof insertUserPointsCounterSchema>;
export type UserPointsCounter = typeof userPointsCounters.$inferSelect;

// Internal Player Stats - for computing fame from gameplay
export const internalPlayerStats = pgTable("internal_player_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  playerKey: text("player_key").notNull().unique(),
  attempts: integer("attempts").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_internal_player_stats_key").on(table.playerKey),
]);

export const insertInternalPlayerStatsSchema = createInsertSchema(internalPlayerStats).omit({
  id: true,
  updatedAt: true,
});

export type InsertInternalPlayerStats = z.infer<typeof insertInternalPlayerStatsSchema>;
export type InternalPlayerStats = typeof internalPlayerStats.$inferSelect;

// API schemas for reward system
export const createRewardPolicySchema = z.object({
  minPts: z.number().int().min(1).max(1000).optional(),
  maxPts: z.number().int().min(1).max(1000).optional(),
  gamma: z.number().min(0.1).max(10).optional(),
  maxAwardCap: z.number().int().min(1).max(1000).optional(),
  vintageMultipliers: z.record(z.number()).optional(),
  rarityMultipliers: z.record(z.number()).optional(),
  dailyPointsCap: z.number().int().min(100).max(100000).optional(),
  perMatchPointsCap: z.number().int().min(100).max(10000).optional(),
  effectiveFrom: z.string().datetime().optional(),
});

export type CreateRewardPolicy = z.infer<typeof createRewardPolicySchema>;

export const updatePlayerFameSchema = z.object({
  playerKey: z.string().min(1),
  fameScore: z.number().min(0).max(1),
  sport: z.enum(["baseball", "basketball", "football", "hockey"]).optional(),
});

export type UpdatePlayerFame = z.infer<typeof updatePlayerFameSchema>;

// CardHedge Card Details Cache - persistent cache for card details API
export const cardDetailsCache = pgTable("card_details_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cardId: varchar("card_id").notNull(),
  rawImagesOnly: boolean("raw_images_only").notNull().default(false),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("idx_card_details_cache_expires").on(table.expiresAt),
  uniqueIndex("idx_card_details_cache_card_raw").on(table.cardId, table.rawImagesOnly),
]);

export const insertCardDetailsCacheSchema = createInsertSchema(cardDetailsCache).omit({
  id: true,
  fetchedAt: true,
});

export type InsertCardDetailsCache = z.infer<typeof insertCardDetailsCacheSchema>;
export type CardDetailsCache = typeof cardDetailsCache.$inferSelect;

// CardHedge Search Cache - persistent cache for card search API
export const cardhedgeSearchCache = pgTable("cardhedge_search_cache", {
  cacheKey: varchar("cache_key").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("idx_cardhedge_search_cache_expires").on(table.expiresAt),
]);

export const insertCardhedgeSearchCacheSchema = createInsertSchema(cardhedgeSearchCache).omit({
  fetchedAt: true,
});

export type InsertCardhedgeSearchCache = z.infer<typeof insertCardhedgeSearchCacheSchema>;
export type CardhedgeSearchCache = typeof cardhedgeSearchCache.$inferSelect;

// ============================================
// STORE PACKAGE PROFIT GUARDRAILS
// ============================================

// Sales Channel Enum - where the sale originates
export const salesChannelEnum = pgEnum("sales_channel", [
  "web_stripe",    // Web Stripe checkout
  "ios_iap",       // iOS In-App Purchase
  "android_iap",   // Android In-App Purchase
]);

// Store Fee Profiles - fee structures per sales channel
export const storeFeeProfiles = pgTable("store_fee_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  channel: salesChannelEnum("channel").notNull().unique(),
  feeRate: real("fee_rate").notNull(), // e.g., 0.029 for 2.9%
  feeFixedCents: integer("fee_fixed_cents").notNull(), // e.g., 30 for $0.30
  platformFeeRate: real("platform_fee_rate").notNull().default(0), // 0 for web, 0.15-0.30 for app stores
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_store_fee_profiles_channel").on(table.channel),
  index("idx_store_fee_profiles_active").on(table.isActive),
]);

export const insertStoreFeeProfileSchema = createInsertSchema(storeFeeProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStoreFeeProfile = z.infer<typeof insertStoreFeeProfileSchema>;
export type StoreFeeProfile = typeof storeFeeProfiles.$inferSelect;

// Store Package Policy - global policy settings for package validation
export const storePackagePolicy = pgTable("store_package_policy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  minMarginRate: real("min_margin_rate").notNull().default(0.30), // 30% minimum gross margin
  warnMarginBand: real("warn_margin_band").notNull().default(0.05), // warn if within 5% of min
  maxValuePerPtMicrousd: integer("max_value_per_pt_microusd").notNull().default(2000), // 0.002 USD/pt in micro-USD
  allowOverride: boolean("allow_override").notNull().default(false),
  reserveRate: real("reserve_rate").notNull().default(1.0), // % of net revenue to margin pool
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_store_package_policy_active").on(table.isActive),
]);

export const insertStorePackagePolicySchema = createInsertSchema(storePackagePolicy).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStorePackagePolicy = z.infer<typeof insertStorePackagePolicySchema>;
export type StorePackagePolicy = typeof storePackagePolicy.$inferSelect;

// Package Validation Decision Enum
export const packageValidationDecisionEnum = pgEnum("package_validation_decision", [
  "PASS",      // All guardrails satisfied
  "WARN",      // Within warning band or too generous
  "BLOCK",     // Below minimum margin - blocked
  "OVERRIDE",  // Admin override of a blocked package
]);

// Store Package Validations - audit log of all package evaluations
export const storePackageValidations = pgTable("store_package_validations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").references(() => products.id),
  policyId: varchar("policy_id").notNull().references(() => storePackagePolicy.id),
  feeProfileId: varchar("fee_profile_id").notNull().references(() => storeFeeProfiles.id),
  priceCents: integer("price_cents").notNull(),
  ptsGrant: integer("pts_grant").notNull(),
  channel: salesChannelEnum("channel").notNull(),
  totalFeesCents: integer("total_fees_cents").notNull(),
  netRevenueCents: integer("net_revenue_cents").notNull(),
  grossMarginRate: real("gross_margin_rate").notNull(),
  impliedValuePerPtMicrousd: integer("implied_value_per_pt_microusd").notNull(),
  decision: packageValidationDecisionEnum("decision").notNull(),
  reasons: text("reasons").array().notNull(),
  adminUserId: varchar("admin_user_id").references(() => users.id),
  overrideNote: text("override_note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_store_package_validations_product").on(table.productId),
  index("idx_store_package_validations_decision").on(table.decision),
  index("idx_store_package_validations_created").on(table.createdAt),
]);

export const insertStorePackageValidationSchema = createInsertSchema(storePackageValidations).omit({
  id: true,
  createdAt: true,
});

export type InsertStorePackageValidation = z.infer<typeof insertStorePackageValidationSchema>;
export type StorePackageValidation = typeof storePackageValidations.$inferSelect;

// API Schemas for Store Package Guardrails
export const evaluatePackageSchema = z.object({
  priceCents: z.number().int().positive(),
  ptsGrant: z.number().int().positive(),
  channel: z.enum(["web_stripe", "ios_iap", "android_iap"]).default("web_stripe"),
});

export type EvaluatePackageRequest = z.infer<typeof evaluatePackageSchema>;

export const createStorePackageSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  priceCents: z.number().int().positive(),
  ptsGrant: z.number().int().positive(),
  channel: z.enum(["web_stripe", "ios_iap", "android_iap"]).default("web_stripe"),
  confirm: z.boolean().optional(), // required to confirm WARN decisions
});

export type CreateStorePackageRequest = z.infer<typeof createStorePackageSchema>;

export const updateStorePackageSchema = createStorePackageSchema.partial().extend({
  priceCents: z.number().int().positive().optional(),
  ptsGrant: z.number().int().positive().optional(),
});

export type UpdateStorePackageRequest = z.infer<typeof updateStorePackageSchema>;

export const overridePackageSchema = z.object({
  note: z.string().min(1).max(500),
});

export type OverridePackageRequest = z.infer<typeof overridePackageSchema>;

// ==========================================
// GUARDRAIL #2 - Match Points Counters (per-match earning cap enforcement)
// ==========================================
export const matchPointsCounters = pgTable("match_points_counters", {
  matchId: varchar("match_id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_match_points_counters_user").on(table.userId),
]);

export const insertMatchPointsCounterSchema = createInsertSchema(matchPointsCounters).omit({
  updatedAt: true,
});

export type InsertMatchPointsCounter = z.infer<typeof insertMatchPointsCounterSchema>;
export type MatchPointsCounter = typeof matchPointsCounters.$inferSelect;

// ==========================================
// GUARDRAIL #3 - User Risk State (refund-safe issuance)
// ==========================================
export const userRiskStatusEnum = pgEnum("user_risk_status", ["NORMAL", "FROZEN"]);

export const userRiskState = pgTable("user_risk_state", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  status: userRiskStatusEnum("status").notNull().default("NORMAL"),
  reason: text("reason"),
  frozenAt: timestamp("frozen_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_risk_state_status").on(table.status),
]);

export const insertUserRiskStateSchema = createInsertSchema(userRiskState).omit({
  updatedAt: true,
  frozenAt: true,
});

export type InsertUserRiskState = z.infer<typeof insertUserRiskStateSchema>;
export type UserRiskState = typeof userRiskState.$inferSelect;

// Store Purchases - track PENDING vs SETTLED PackPTS
export const storePurchaseStatusEnum = pgEnum("store_purchase_status", [
  "CREATED", "PAID_PENDING", "SETTLED", "REFUNDED", "CHARGEBACK"
]);

export const storePurchases = pgTable("store_purchases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  stripeSessionId: text("stripe_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: storePurchaseStatusEnum("status").notNull().default("CREATED"),
  ptsGrant: integer("pts_grant").notNull(),
  priceCents: integer("price_cents").notNull(),
  productSku: text("product_sku"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_store_purchases_user").on(table.userId),
  index("idx_store_purchases_status").on(table.status),
  index("idx_store_purchases_session").on(table.stripeSessionId),
]);

export const insertStorePurchaseSchema = createInsertSchema(storePurchases).omit({
  id: true,
  settledAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStorePurchase = z.infer<typeof insertStorePurchaseSchema>;
export type StorePurchase = typeof storePurchases.$inferSelect;

// ==========================================
// GUARDRAIL #4 - Anti-Collusion & Bot Detection
// ==========================================
export const gameplayEventTypeEnum = pgEnum("gameplay_event_type", [
  "QUESTION_SHOWN", "ANSWER_SUBMITTED", "MATCH_END"
]);

export const gameplayEvents = pgTable("gameplay_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id),
  opponentId: varchar("opponent_id"),
  eventType: gameplayEventTypeEnum("event_type").notNull(),
  cardId: varchar("card_id"),
  answerCorrect: boolean("answer_correct"),
  responseTimeMs: integer("response_time_ms"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_gameplay_events_match").on(table.matchId),
  index("idx_gameplay_events_user").on(table.userId),
  index("idx_gameplay_events_created").on(table.createdAt),
]);

export const insertGameplayEventSchema = createInsertSchema(gameplayEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertGameplayEvent = z.infer<typeof insertGameplayEventSchema>;
export type GameplayEvent = typeof gameplayEvents.$inferSelect;

// Risk Signals - patterns detected by risk engine
export const riskSignalTypeEnum = pgEnum("risk_signal_type", [
  "REPEAT_PAIRING", "WIN_TRADING", "FAST_RESPONSES", "HIGH_VOLUME", "MULTI_ACCOUNT"
]);

export const riskSignals = pgTable("risk_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  signalType: riskSignalTypeEnum("signal_type").notNull(),
  severity: integer("severity").notNull().default(1),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_risk_signals_user").on(table.userId),
  index("idx_risk_signals_type").on(table.signalType),
  index("idx_risk_signals_created").on(table.createdAt),
]);

export const insertRiskSignalSchema = createInsertSchema(riskSignals).omit({
  id: true,
  createdAt: true,
});

export type InsertRiskSignal = z.infer<typeof insertRiskSignalSchema>;
export type RiskSignal = typeof riskSignals.$inferSelect;

// Risk Actions - enforcement actions taken
export const riskActionTypeEnum = pgEnum("risk_action_type", [
  "THROTTLE", "REDUCE_REWARDS", "CAP_LOWER", "CAPTCHA", "FREEZE"
]);

export const riskActions = pgTable("risk_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  action: riskActionTypeEnum("action").notNull(),
  reason: text("reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_risk_actions_user").on(table.userId),
  index("idx_risk_actions_action").on(table.action),
  index("idx_risk_actions_created").on(table.createdAt),
  index("idx_risk_actions_expires").on(table.expiresAt),
]);

export const insertRiskActionSchema = createInsertSchema(riskActions).omit({
  id: true,
  createdAt: true,
});

export type InsertRiskAction = z.infer<typeof insertRiskActionSchema>;
export type RiskAction = typeof riskActions.$inferSelect;

// ==========================================
// FRAUD SCORING PIPELINE - Append-only event tables + rollups + signals + snapshots
// ==========================================

// Auth Events (append-only)
export const authEventTypeEnum = pgEnum("auth_event_type", [
  "LOGIN_SUCCESS", "LOGIN_FAIL", "SIGNUP", "LOGOUT", "PASSWORD_RESET", "OAUTH_LINK", "SESSION_CREATED"
]);

export const authEvents = pgTable("auth_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  eventType: authEventTypeEnum("event_type").notNull(),
  sessionId: text("session_id"),
  deviceId: text("device_id"),
  ipHash: text("ip_hash"),
  ipCountry: text("ip_country"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_auth_events_user").on(table.userId),
  index("idx_auth_events_type").on(table.eventType),
  index("idx_auth_events_created").on(table.createdAt),
  index("idx_auth_events_device").on(table.deviceId),
  index("idx_auth_events_ip").on(table.ipHash),
]);

export const insertAuthEventSchema = createInsertSchema(authEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertAuthEvent = z.infer<typeof insertAuthEventSchema>;
export type AuthEvent = typeof authEvents.$inferSelect;

// Device Events (append-only)
export const deviceEventTypeEnum = pgEnum("device_event_type", [
  "DEVICE_SEEN", "COOKIE_RESET", "STORAGE_RESET"
]);

export const deviceEvents = pgTable("device_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  deviceId: text("device_id").notNull(),
  fingerprintVersion: text("fingerprint_version"),
  ipHash: text("ip_hash"),
  ipCountry: text("ip_country"),
  eventType: deviceEventTypeEnum("event_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_device_events_user").on(table.userId),
  index("idx_device_events_device").on(table.deviceId),
  index("idx_device_events_created").on(table.createdAt),
  index("idx_device_events_ip").on(table.ipHash),
]);

export const insertDeviceEventSchema = createInsertSchema(deviceEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertDeviceEvent = z.infer<typeof insertDeviceEventSchema>;
export type DeviceEvent = typeof deviceEvents.$inferSelect;

// Payment Events (append-only)
export const paymentEventTypeEnum = pgEnum("payment_event_type", [
  "CHECKOUT_CREATED", "PAID", "SETTLED", "REFUNDED", "DISPUTE_OPENED", "DISPUTE_WON", "DISPUTE_LOST", "PAYMENT_FAILED"
]);

export const paymentEvents = pgTable("payment_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  purchaseId: varchar("purchase_id"),
  stripeEventId: text("stripe_event_id").unique(),
  eventType: paymentEventTypeEnum("event_type").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: text("currency").default("usd"),
  paymentMethodFingerprint: text("payment_method_fingerprint"),
  ipHash: text("ip_hash"),
  ipCountry: text("ip_country"),
  deviceId: text("device_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_payment_events_user").on(table.userId),
  index("idx_payment_events_type").on(table.eventType),
  index("idx_payment_events_created").on(table.createdAt),
  index("idx_payment_events_stripe").on(table.stripeEventId),
  index("idx_payment_events_device").on(table.deviceId),
]);

export const insertPaymentEventSchema = createInsertSchema(paymentEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertPaymentEvent = z.infer<typeof insertPaymentEventSchema>;
export type PaymentEvent = typeof paymentEvents.$inferSelect;

// Redemption Events (append-only)
export const redemptionSourceEnum = pgEnum("redemption_source", ["ebay", "goldin"]);
export const redemptionEventTypeEnum = pgEnum("redemption_event_type", [
  "QUOTE", "APPLY", "RESERVE", "RELEASE", "CONSUME", "CANCEL", "CONFIRM"
]);

export const redemptionEvents = pgTable("redemption_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  purchaseIntentId: varchar("purchase_intent_id"),
  source: redemptionSourceEnum("source"),
  eventType: redemptionEventTypeEnum("event_type").notNull(),
  priceCents: integer("price_cents"),
  ptsRequested: integer("pts_requested"),
  ptsApproved: integer("pts_approved"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_redemption_events_user").on(table.userId),
  index("idx_redemption_events_type").on(table.eventType),
  index("idx_redemption_events_created").on(table.createdAt),
]);

export const insertRedemptionEventSchema = createInsertSchema(redemptionEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertRedemptionEvent = z.infer<typeof insertRedemptionEventSchema>;
export type RedemptionEvent = typeof redemptionEvents.$inferSelect;

// User Rollup 24h - Aggregated activity per user per day
export const userRollup24h = pgTable("user_rollup_24h", {
  userId: varchar("user_id").notNull(),
  windowStart: timestamp("window_start").notNull(),
  loginFailCount: integer("login_fail_count").default(0),
  loginSuccessCount: integer("login_success_count").default(0),
  distinctDeviceCount: integer("distinct_device_count").default(0),
  distinctIpCount: integer("distinct_ip_count").default(0),
  purchaseCount: integer("purchase_count").default(0),
  purchaseAmountCents: integer("purchase_amount_cents").default(0),
  redemptionApplyCount: integer("redemption_apply_count").default(0),
  redemptionPtsApproved: integer("redemption_pts_approved").default(0),
  gameplayMatches: integer("gameplay_matches").default(0),
  gameplayAnswers: integer("gameplay_answers").default(0),
  gameplayCorrect: integer("gameplay_correct").default(0),
  gameplayMedianResponseMs: integer("gameplay_median_response_ms"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_rollup_24h_window").on(table.windowStart),
  unique("user_rollup_24h_pk").on(table.userId, table.windowStart),
]);

export const insertUserRollup24hSchema = createInsertSchema(userRollup24h);
export type InsertUserRollup24h = z.infer<typeof insertUserRollup24hSchema>;
export type UserRollup24h = typeof userRollup24h.$inferSelect;

// Device Rollup 24h - Aggregated activity per device per day
export const deviceRollup24h = pgTable("device_rollup_24h", {
  deviceId: text("device_id").notNull(),
  windowStart: timestamp("window_start").notNull(),
  distinctUserCount: integer("distinct_user_count").default(0),
  purchaseCount: integer("purchase_count").default(0),
  purchaseAmountCents: integer("purchase_amount_cents").default(0),
  signupCount: integer("signup_count").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_device_rollup_24h_window").on(table.windowStart),
  unique("device_rollup_24h_pk").on(table.deviceId, table.windowStart),
]);

export const insertDeviceRollup24hSchema = createInsertSchema(deviceRollup24h);
export type InsertDeviceRollup24h = z.infer<typeof insertDeviceRollup24hSchema>;
export type DeviceRollup24h = typeof deviceRollup24h.$inferSelect;

// IP Rollup 24h - Aggregated activity per IP hash per day
export const ipRollup24h = pgTable("ip_rollup_24h", {
  ipHash: text("ip_hash").notNull(),
  windowStart: timestamp("window_start").notNull(),
  distinctUserCount: integer("distinct_user_count").default(0),
  purchaseCount: integer("purchase_count").default(0),
  purchaseAmountCents: integer("purchase_amount_cents").default(0),
  signupCount: integer("signup_count").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_ip_rollup_24h_window").on(table.windowStart),
  unique("ip_rollup_24h_pk").on(table.ipHash, table.windowStart),
]);

export const insertIpRollup24hSchema = createInsertSchema(ipRollup24h);
export type InsertIpRollup24h = z.infer<typeof insertIpRollup24hSchema>;
export type IpRollup24h = typeof ipRollup24h.$inferSelect;

// Fraud Signals (append-only) - More granular signals than existing risk_signals
export const fraudSignals = pgTable("fraud_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  signalType: text("signal_type").notNull(),
  severity: integer("severity").notNull(),
  window: text("window").notNull().default("24h"),  // "window" is reserved in SQL but Drizzle handles quoting
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_fraud_signals_user_created").on(table.userId, table.createdAt),
  index("idx_fraud_signals_type_created").on(table.signalType, table.createdAt),
]);

export const insertFraudSignalSchema = createInsertSchema(fraudSignals).omit({
  id: true,
  createdAt: true,
});
export type InsertFraudSignal = z.infer<typeof insertFraudSignalSchema>;
export type FraudSignal = typeof fraudSignals.$inferSelect;

// Risk Snapshot (one row per user) - Current risk assessment
export const riskTierEnum = pgEnum("risk_tier", ["LOW", "MEDIUM", "HIGH"]);

export const riskSnapshots = pgTable("risk_snapshots", {
  userId: varchar("user_id").primaryKey(),
  updatedAt: timestamp("updated_at").defaultNow(),
  tierSuggestion: riskTierEnum("tier_suggestion").default("LOW"),
  score: integer("score").default(0),
  flags: jsonb("flags").default({}),
  topReasons: text("top_reasons").array().default([]),
  lastPurchaseAt: timestamp("last_purchase_at"),
  lastRedemptionApplyAt: timestamp("last_redemption_apply_at"),
  lastDeviceId: text("last_device_id"),
  lastIpHash: text("last_ip_hash"),
  lastCountry: text("last_country"),
});

export const insertRiskSnapshotSchema = createInsertSchema(riskSnapshots);
export type InsertRiskSnapshot = z.infer<typeof insertRiskSnapshotSchema>;
export type RiskSnapshot = typeof riskSnapshots.$inferSelect;

// Risk Suppressions - Temporarily ignore certain signals for a user
export const riskSuppressions = pgTable("risk_suppressions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  signalType: text("signal_type").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_risk_suppressions_user").on(table.userId),
  index("idx_risk_suppressions_expires").on(table.expiresAt),
  unique("risk_suppressions_user_signal").on(table.userId, table.signalType),
]);

export const insertRiskSuppressionSchema = createInsertSchema(riskSuppressions).omit({
  id: true,
  createdAt: true,
});
export type InsertRiskSuppression = z.infer<typeof insertRiskSuppressionSchema>;
export type RiskSuppression = typeof riskSuppressions.$inferSelect;

// Risk Jobs - DB-backed queue for rollup/signal/snapshot computation
export const riskJobTypeEnum = pgEnum("risk_job_type", [
  "ROLLUP_24H", "COMPUTE_SIGNALS", "UPDATE_SNAPSHOT"
]);
export const riskJobStatusEnum = pgEnum("risk_job_status", [
  "PENDING", "RUNNING", "SUCCEEDED", "FAILED"
]);

export const riskJobs = pgTable("risk_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobType: riskJobTypeEnum("job_type").notNull(),
  userId: varchar("user_id"),
  deviceId: text("device_id"),
  ipHash: text("ip_hash"),
  runAfter: timestamp("run_after").defaultNow(),
  status: riskJobStatusEnum("status").default("PENDING"),
  attempts: integer("attempts").default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_risk_jobs_status_run").on(table.status, table.runAfter),
  index("idx_risk_jobs_type_run").on(table.jobType, table.runAfter),
]);

export const insertRiskJobSchema = createInsertSchema(riskJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRiskJob = z.infer<typeof insertRiskJobSchema>;
export type RiskJob = typeof riskJobs.$inferSelect;

// ============================================================
// ADMIN SET IMPORTER - Provider-Agnostic Card Import System
// ============================================================

// Card Set Sport Enum (uses capitalized format for CardHedge compatibility)
export const cardSetSportEnum = pgEnum("card_set_sport", [
  "Baseball", "Basketball", "Football", "Hockey"
]);
export type CardSetSport = "Baseball" | "Basketball" | "Football" | "Hockey";

// Card Sets - Admin-defined sets for import
export const cardSets = pgTable("card_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sport: cardSetSportEnum("sport").notNull(),
  year: integer("year").notNull(),
  brand: text("brand"),
  setName: text("set_name").notNull(),
  providerPreference: text("provider_preference").notNull().default("cardhedge"),
  keywords: text("keywords").array().notNull().default([]),
  expectedCardCount: integer("expected_card_count"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_card_sets_sport_year").on(table.sport, table.year),
  index("idx_card_sets_active").on(table.isActive),
]);

export const insertCardSetSchema = createInsertSchema(cardSets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCardSet = z.infer<typeof insertCardSetSchema>;
export type CardSet = typeof cardSets.$inferSelect;

// Card Set Masks - Per-set configuration for player name masking during gameplay
export const cardSetMasks = pgTable("card_set_masks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setKey: text("set_key").notNull().unique(),
  providerSetId: text("provider_set_id"),
  maskVersion: integer("mask_version").default(1).notNull(),
  regions: jsonb("regions").notNull().$type<MaskRegion[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export interface MaskRegion {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  type: "solid" | "blur" | "pixelate";
  radiusPct?: number;
}

export const insertCardSetMaskSchema = createInsertSchema(cardSetMasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCardSetMask = z.infer<typeof insertCardSetMaskSchema>;
export type CardSetMask = typeof cardSetMasks.$inferSelect;

// Default mask regions for unknown sets - covers top 18% AND bottom 38% to hide names in all positions
export const DEFAULT_MASK_REGIONS: MaskRegion[] = [
  { xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 },
  { xPct: 0, yPct: 62, wPct: 100, hPct: 38, type: "blur", radiusPct: 0 },
];

// Slabbed card variant (name may sit higher)
export const SLABBED_MASK_REGIONS: MaskRegion[] = [
  { xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 },
  { xPct: 0, yPct: 62, wPct: 100, hPct: 38, type: "blur", radiusPct: 0 },
];

// Cards - Local canonical catalog of imported cards
export const catalogCards = pgTable("catalog_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  providerCardId: text("provider_card_id").notNull(),
  sport: cardSetSportEnum("sport"),
  year: integer("year"),
  brand: text("brand"),
  setName: text("set_name"),
  cardNumber: text("card_number"),
  variant: text("variant"),
  player: text("player"),
  description: text("description"),
  imageUrl: text("image_url"),
  categoryRaw: text("category_raw"),
  setRaw: text("set_raw"),
  raw: jsonb("raw").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_catalog_cards_provider_id").on(table.provider, table.providerCardId),
  index("idx_catalog_cards_sport").on(table.sport),
  index("idx_catalog_cards_player").on(table.player),
]);

export const insertCatalogCardSchema = createInsertSchema(catalogCards).omit({
  id: true,
  createdAt: true,
});
export type InsertCatalogCard = z.infer<typeof insertCatalogCardSchema>;
export type CatalogCard = typeof catalogCards.$inferSelect;

// Card Set Cards - Membership linking sets to cards
export const cardSetCards = pgTable("card_set_cards", {
  setId: varchar("set_id").notNull().references(() => cardSets.id, { onDelete: "cascade" }),
  cardId: varchar("card_id").notNull().references(() => catalogCards.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_card_set_cards_set").on(table.setId),
  index("idx_card_set_cards_card").on(table.cardId),
]);

// Set Import Job Status Enum
export const setImportJobStatusEnum = pgEnum("set_import_job_status", [
  "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "PARTIAL"
]);

// Set Import Jobs - Track import progress
export const setImportJobs = pgTable("set_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setId: varchar("set_id").notNull().references(() => cardSets.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  status: setImportJobStatusEnum("status").notNull().default("PENDING"),
  totalPages: integer("total_pages").notNull().default(0),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  cardsFound: integer("cards_found").notNull().default(0),
  cardsInserted: integer("cards_inserted").notNull().default(0),
  cardsLinked: integer("cards_linked").notNull().default(0),
  lastError: text("last_error"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_set_import_jobs_set").on(table.setId),
  index("idx_set_import_jobs_status").on(table.status),
]);

export const insertSetImportJobSchema = createInsertSchema(setImportJobs).omit({
  id: true,
  createdAt: true,
});
export type InsertSetImportJob = z.infer<typeof insertSetImportJobSchema>;
export type SetImportJob = typeof setImportJobs.$inferSelect;

// Set Import Job Log Level Enum
export const setImportJobLogLevelEnum = pgEnum("set_import_job_log_level", [
  "INFO", "WARN", "ERROR"
]);

// Set Import Job Logs - Detailed import logs
export const setImportJobLogs = pgTable("set_import_job_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => setImportJobs.id, { onDelete: "cascade" }),
  level: setImportJobLogLevelEnum("level").notNull(),
  message: text("message").notNull(),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_set_import_job_logs_job").on(table.jobId),
]);

export const insertSetImportJobLogSchema = createInsertSchema(setImportJobLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertSetImportJobLog = z.infer<typeof insertSetImportJobLogSchema>;
export type SetImportJobLog = typeof setImportJobLogs.$inferSelect;

// API Schemas for Admin Set Importer
export const createCardSetSchema = z.object({
  sport: z.enum(["Baseball", "Basketball", "Football", "Hockey"]),
  year: z.number().int().min(1800).max(2100),
  brand: z.string().optional(),
  setName: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  expectedCardCount: z.number().int().positive().optional(),
});
export type CreateCardSetRequest = z.infer<typeof createCardSetSchema>;

export const updateCardSetSchema = z.object({
  sport: z.enum(["Baseball", "Basketball", "Football", "Hockey"]).optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  brand: z.string().nullable().optional(),
  setName: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  expectedCardCount: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCardSetRequest = z.infer<typeof updateCardSetSchema>;

// ============================================
// 1vRandom Matchmaking System
// ============================================

// User Presence Status Enum
export const presenceStatusEnum = pgEnum("presence_status", [
  "ONLINE", "OFFLINE", "IN_MATCH", "SEARCHING"
]);

// User Presence - tracks real-time connection state
export const userPresence = pgTable("user_presence", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  socketId: varchar("socket_id"),
  status: presenceStatusEnum("status").notNull().default("OFFLINE"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_presence_status").on(table.status),
  index("idx_user_presence_last_seen").on(table.lastSeenAt),
]);

export const insertUserPresenceSchema = createInsertSchema(userPresence).omit({
  updatedAt: true,
});
export type InsertUserPresence = z.infer<typeof insertUserPresenceSchema>;
export type UserPresence = typeof userPresence.$inferSelect;

// Matchmaking Ticket Status Enum
export const ticketStatusEnum = pgEnum("ticket_status", [
  "WAITING", "MATCHED", "CANCELLED", "EXPIRED"
]);

// Matchmaking Mode Enum
export const matchmakingModeEnum = pgEnum("matchmaking_mode", [
  "1vRandom"
]);

// Matchmaking Tickets - queue entries for users seeking matches
export const matchmakingTickets = pgTable("matchmaking_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mode: matchmakingModeEnum("mode").notNull(),
  bucket: varchar("bucket").notNull(),
  status: ticketStatusEnum("status").notNull().default("WAITING"),
  socketId: varchar("socket_id"),
  lastHeartbeatAt: timestamp("last_heartbeat_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_matchmaking_tickets_user").on(table.userId),
  index("idx_matchmaking_tickets_status").on(table.status),
  index("idx_matchmaking_tickets_bucket").on(table.bucket),
  index("idx_matchmaking_tickets_mode_bucket_status_created").on(table.mode, table.bucket, table.status, table.createdAt),
  uniqueIndex("idx_matchmaking_tickets_active_unique")
    .on(table.userId, table.mode)
    .where(sql`status IN ('WAITING', 'MATCHED')`),
]);

export const insertMatchmakingTicketSchema = createInsertSchema(matchmakingTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMatchmakingTicket = z.infer<typeof insertMatchmakingTicketSchema>;
export type MatchmakingTicket = typeof matchmakingTickets.$inferSelect;

// PvP Match Status Enum
export const pvpMatchStatusEnum = pgEnum("pvp_match_status", [
  "CREATED", "ACTIVE", "FINISHED", "CANCELLED"
]);

// PvP Matches - active and historical 1v1 matchmaking games
export const pvpMatches = pgTable("pvp_matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mode: matchmakingModeEnum("mode").notNull(),
  bucket: varchar("bucket").notNull(),
  player1Id: varchar("player1_id").notNull().references(() => users.id),
  player2Id: varchar("player2_id").notNull().references(() => users.id),
  player1TicketId: varchar("player1_ticket_id").references(() => matchmakingTickets.id),
  player2TicketId: varchar("player2_ticket_id").references(() => matchmakingTickets.id),
  status: pvpMatchStatusEnum("status").notNull().default("CREATED"),
  winnerId: varchar("winner_id").references(() => users.id),
  player1Score: integer("player1_score").default(0),
  player2Score: integer("player2_score").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, (table) => [
  index("idx_pvp_matches_player1").on(table.player1Id),
  index("idx_pvp_matches_player2").on(table.player2Id),
  index("idx_pvp_matches_status").on(table.status),
]);

export const insertPvpMatchSchema = createInsertSchema(pvpMatches).omit({
  id: true,
  createdAt: true,
});
export type InsertPvpMatch = z.infer<typeof insertPvpMatchSchema>;
export type PvpMatch = typeof pvpMatches.$inferSelect;

export const userGameplayDailyCounters = pgTable("user_gameplay_daily_counters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  dayKey: varchar("day_key", { length: 10 }).notNull(),
  cardsCompleted: integer("cards_completed").notNull().default(0),
  basePtsAwarded: integer("base_pts_awarded").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_gameplay_daily_unique").on(table.userId, table.dayKey),
  index("idx_user_gameplay_daily_day").on(table.dayKey),
]);

export const insertUserGameplayDailyCounterSchema = createInsertSchema(userGameplayDailyCounters).omit({
  id: true,
  updatedAt: true,
});
export type InsertUserGameplayDailyCounter = z.infer<typeof insertUserGameplayDailyCounterSchema>;
export type UserGameplayDailyCounter = typeof userGameplayDailyCounters.$inferSelect;

export const gameplayCardDailyEvents = pgTable("gameplay_card_daily_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  dayKey: varchar("day_key", { length: 10 }).notNull(),
  matchId: varchar("match_id"),
  cardId: varchar("card_id").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_gameplay_card_daily_unique").on(table.userId, table.dayKey, table.cardId),
  index("idx_gameplay_card_daily_user_day").on(table.userId, table.dayKey),
]);

export const insertGameplayCardDailyEventSchema = createInsertSchema(gameplayCardDailyEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertGameplayCardDailyEvent = z.infer<typeof insertGameplayCardDailyEventSchema>;
export type GameplayCardDailyEvent = typeof gameplayCardDailyEvents.$inferSelect;

// Card Image Quarantine - tracks card_ids with placeholder/bad images
export const cardImageQuarantine = pgTable("card_image_quarantine", {
  cardId: varchar("card_id").primaryKey(),
  reason: text("reason").notNull(),
  imageUrl: text("image_url"),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  seenCount: integer("seen_count").notNull().default(1),
});

export const insertCardImageQuarantineSchema = createInsertSchema(cardImageQuarantine).omit({
  firstSeenAt: true,
  lastSeenAt: true,
  seenCount: true,
});
export type InsertCardImageQuarantine = z.infer<typeof insertCardImageQuarantineSchema>;
export type CardImageQuarantine = typeof cardImageQuarantine.$inferSelect;

// Image cache status enum
export const imageCacheStatuses = ["ok", "bad", "pending"] as const;
export type ImageCacheStatus = typeof imageCacheStatuses[number];

// Card Image Cache - tracks validation status and proxied paths for card images
export const cardImageCache = pgTable("card_image_cache", {
  cardId: varchar("card_id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  proxiedPath: text("proxied_path").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  lastHttpStatus: integer("last_http_status"),
  lastContentType: text("last_content_type"),
  bytes: integer("bytes"),
  failCount: integer("fail_count").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at").defaultNow(),
}, (table) => [
  index("idx_card_image_cache_status").on(table.status),
]);

export const insertCardImageCacheSchema = createInsertSchema(cardImageCache).omit({
  lastCheckedAt: true,
});
export type InsertCardImageCache = z.infer<typeof insertCardImageCacheSchema>;
export type CardImageCache = typeof cardImageCache.$inferSelect;

// Match card queue - cards reserved for a match (10 primary + 10 spare)
export const matchCardQueue = pgTable("match_card_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  cardId: text("card_id").notNull(),
  idx: integer("idx").notNull(),
  isSpare: boolean("is_spare").notNull().default(false),
  usedAsReplacement: boolean("used_as_replacement").notNull().default(false),
  markedBad: boolean("marked_bad").notNull().default(false),
  servedAt: timestamp("served_at"),
  answeredAt: timestamp("answered_at"),
}, (table) => [
  index("idx_match_card_queue_match").on(table.matchId),
  index("idx_match_card_queue_card").on(table.cardId),
]);

export const insertMatchCardQueueSchema = createInsertSchema(matchCardQueue).omit({
  id: true,
  servedAt: true,
  answeredAt: true,
});
export type InsertMatchCardQueue = z.infer<typeof insertMatchCardQueueSchema>;
export type MatchCardQueue = typeof matchCardQueue.$inferSelect;

// Telemetry for card delivery pipeline
export const telemetryCardDelivery = pgTable("telemetry_card_delivery", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts").defaultNow().notNull(),
  matchId: varchar("match_id"),
  setKey: text("set_key"),
  stage: text("stage").notNull(),
  cardId: text("card_id"),
  detail: jsonb("detail"),
}, (table) => [
  index("idx_telemetry_card_delivery_ts").on(table.ts),
  index("idx_telemetry_card_delivery_stage").on(table.stage),
  index("idx_telemetry_card_delivery_match").on(table.matchId),
]);

export const insertTelemetryCardDeliverySchema = createInsertSchema(telemetryCardDelivery).omit({
  id: true,
  ts: true,
});
export type InsertTelemetryCardDelivery = z.infer<typeof insertTelemetryCardDeliverySchema>;
export type TelemetryCardDelivery = typeof telemetryCardDelivery.$inferSelect;

export const cardImageMaskCache = pgTable("card_image_mask_cache", {
  cardId: text("card_id").primaryKey(),
  rawImageUrl: text("raw_image_url").notNull(),
  maskedImagePath: text("masked_image_path").notNull(),
  maskVersion: text("mask_version").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_card_mask_cache_version").on(table.maskVersion),
]);

export type CardImageMaskCache = typeof cardImageMaskCache.$inferSelect;

export const operationSources = ["ADMIN_MANUAL", "SYSTEM_NON_DESTRUCTIVE", "CARDHEDGE_CONFIRMED"] as const;
export type OperationSource = typeof operationSources[number];

export const setAuditLog = pgTable("set_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setId: varchar("set_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  operationSource: varchar("operation_source", { length: 30 }).notNull(),
  actorUserId: varchar("actor_user_id"),
  beforeTotalCards: integer("before_total_cards").notNull().default(0),
  afterTotalCards: integer("after_total_cards").notNull().default(0),
  beforePlayableCards: integer("before_playable_cards").notNull().default(0),
  afterPlayableCards: integer("after_playable_cards").notNull().default(0),
  deltaTotalCards: integer("delta_total_cards").notNull().default(0),
  deltaPlayableCards: integer("delta_playable_cards").notNull().default(0),
  reason: text("reason"),
  evidenceJson: jsonb("evidence_json"),
}, (table) => [
  index("idx_set_audit_log_set").on(table.setId),
  index("idx_set_audit_log_created").on(table.createdAt),
  index("idx_set_audit_log_action").on(table.actionType),
  index("idx_set_audit_log_source").on(table.operationSource),
]);

export const insertSetAuditLogSchema = createInsertSchema(setAuditLog).omit({
  id: true,
  createdAt: true,
});
export type InsertSetAuditLog = z.infer<typeof insertSetAuditLogSchema>;
export type SetAuditLog = typeof setAuditLog.$inferSelect;

// Admin Bundle Audit Log - tracks all bundle/package mutations
export const adminBundleAuditLog = pgTable("admin_bundle_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bundleId: varchar("bundle_id").notNull().references(() => products.id),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 50 }).notNull(), // CREATE, UPDATE, OVERRIDE_RATIO, OVERRIDE_GUARDRAILS
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_bundle_audit_bundle").on(table.bundleId),
  index("idx_bundle_audit_actor").on(table.actorUserId),
  index("idx_bundle_audit_created").on(table.createdAt),
]);

export const insertBundleAuditLogSchema = createInsertSchema(adminBundleAuditLog).omit({
  id: true,
  createdAt: true,
});
export type InsertBundleAuditLog = z.infer<typeof insertBundleAuditLogSchema>;
export type BundleAuditLog = typeof adminBundleAuditLog.$inferSelect;

// Bundle preview request schema - supports bidirectional USD <-> PackPTS
export const bundlePreviewSchema = z.object({
  sku: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200).optional(),
  channel: z.enum(["web_stripe", "ios_iap", "android_iap"]).default("web_stripe"),
  usdPriceCents: z.number().int().min(0).optional(),
  packptsAmount: z.number().int().min(0).optional(),
  driver: z.enum(["USD", "PACKPTS"]).default("USD"),
  ratioMode: z.enum(["AUTO", "OVERRIDE"]).default("AUTO"),
  overrideRatioUsdPerPackptMicro: z.number().int().positive().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
});

export type BundlePreviewRequest = z.infer<typeof bundlePreviewSchema>;

// Bundle create request schema
export const bundleCreateSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  channel: z.enum(["web_stripe", "ios_iap", "android_iap"]).default("web_stripe"),
  usdPriceCents: z.number().int().positive(),
  packptsAmount: z.number().int().positive(),
  ratioMode: z.enum(["AUTO", "OVERRIDE"]).default("AUTO"),
  overrideRatioUsdPerPackptMicro: z.number().int().positive().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
  overrideGuardrails: z.boolean().optional(),
  overrideGuardrailsReason: z.string().min(10).max(500).optional(),
  confirm: z.boolean().optional(),
});

export type BundleCreateRequest = z.infer<typeof bundleCreateSchema>;

// ============================================
// DAILY 5 CHALLENGE SYSTEM
// ============================================

export const dailyChallengeStatuses = ["SCHEDULED", "ACTIVE", "CLOSED"] as const;
export type DailyChallengeStatus = typeof dailyChallengeStatuses[number];

export const dailyChallenges = pgTable("daily_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: varchar("date", { length: 10 }).notNull().unique(),
  mode: varchar("mode", { length: 20 }).notNull().default("DAILY5"),
  setId: varchar("set_id").references(() => gameSets.id),
  seed: varchar("seed", { length: 128 }).notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("SCHEDULED"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_daily_challenges_date").on(table.date),
  index("idx_daily_challenges_status").on(table.status),
]);

export const insertDailyChallengeSchema = createInsertSchema(dailyChallenges).omit({
  id: true,
  createdAt: true,
});
export type InsertDailyChallenge = z.infer<typeof insertDailyChallengeSchema>;
export type DailyChallenge = typeof dailyChallenges.$inferSelect;

export const dailyChallengeCards = pgTable("daily_challenge_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyChallengeId: varchar("daily_challenge_id").notNull().references(() => dailyChallenges.id),
  position: integer("position").notNull(),
  cardId: varchar("card_id").notNull().references(() => playableCards.id),
  correctAnswer: text("correct_answer").notNull(),
  choices: jsonb("choices").notNull().$type<string[]>(),
  pointValue: integer("point_value").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_daily_challenge_cards_challenge").on(table.dailyChallengeId),
  unique("daily_challenge_cards_position_unique").on(table.dailyChallengeId, table.position),
]);

export const insertDailyChallengeCardSchema = createInsertSchema(dailyChallengeCards).omit({
  id: true,
  createdAt: true,
});
export type InsertDailyChallengeCard = z.infer<typeof insertDailyChallengeCardSchema>;
export type DailyChallengeCard = typeof dailyChallengeCards.$inferSelect;

export const dailyChallengeEntries = pgTable("daily_challenge_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyChallengeId: varchar("daily_challenge_id").notNull().references(() => dailyChallenges.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  creditedAt: timestamp("credited_at"),
  score: integer("score").notNull().default(0),
  correctCount: integer("correct_count").notNull().default(0),
  timeMs: integer("time_ms"),
  flagged: boolean("flagged").default(false),
  flagReason: text("flag_reason"),
  answers: jsonb("answers").$type<{ position: number; selected: string; correct: boolean; timeMs?: number }[]>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("daily_challenge_entries_user_unique").on(table.dailyChallengeId, table.userId),
  index("idx_daily_challenge_entries_challenge").on(table.dailyChallengeId),
  index("idx_daily_challenge_entries_user").on(table.userId),
  index("idx_daily_challenge_entries_score").on(table.dailyChallengeId, table.score),
]);

export const insertDailyChallengeEntrySchema = createInsertSchema(dailyChallengeEntries).omit({
  id: true,
  createdAt: true,
});
export type InsertDailyChallengeEntry = z.infer<typeof insertDailyChallengeEntrySchema>;
export type DailyChallengeEntry = typeof dailyChallengeEntries.$inferSelect;

// ============================================
// DAILY 5 API SCHEMAS
// ============================================

export const daily5AnswerSchema = z.object({
  challengeId: z.string(),
  position: z.number().int().min(1).max(5),
  selectedAnswer: z.string(),
});
export type Daily5AnswerRequest = z.infer<typeof daily5AnswerSchema>;

export const daily5FinishSchema = z.object({
  challengeId: z.string(),
});
export type Daily5FinishRequest = z.infer<typeof daily5FinishSchema>;

// ============================================
// SHARE EVENTS / REFERRALS / CONTENT ASSETS
// ============================================

export const shareEventTypeEnum = pgEnum("share_event_type", [
  "SCORE_CARD", "LEADERBOARD_CARD", "STREAK_CARD", "CHALLENGE_INVITE",
]);

export const shareTargetEnum = pgEnum("share_target", [
  "TIKTOK", "INSTAGRAM", "X", "DISCORD", "COPY_LINK", "NATIVE_SHARE",
]);

export const shareEvents = pgTable("share_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  shareType: shareEventTypeEnum("share_type").notNull(),
  target: shareTargetEnum("target").notNull(),
  contentAssetId: varchar("content_asset_id"),
  shareLinkId: varchar("share_link_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_share_events_user").on(table.userId, table.createdAt),
  index("idx_share_events_type").on(table.shareType, table.createdAt),
]);

export const insertShareEventSchema = createInsertSchema(shareEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertShareEvent = z.infer<typeof insertShareEventSchema>;
export type ShareEvent = typeof shareEvents.$inferSelect;

export const referralPurposeEnum = pgEnum("referral_purpose", [
  "INVITE", "DAILY5_CHALLENGE", "SCORE_SHARE",
]);

export const referralLinks = pgTable("referral_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 20 }).notNull().unique(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  purpose: referralPurposeEnum("purpose").notNull(),
  destinationPath: text("destination_path").notNull(),
  clickCount: integer("click_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_referral_links_user").on(table.createdByUserId),
  index("idx_referral_links_code").on(table.code),
]);

export const insertReferralLinkSchema = createInsertSchema(referralLinks).omit({
  id: true,
  clickCount: true,
  createdAt: true,
});
export type InsertReferralLink = z.infer<typeof insertReferralLinkSchema>;
export type ReferralLink = typeof referralLinks.$inferSelect;

export const referralAttributionEventEnum = pgEnum("referral_attribution_event", [
  "SIGNUP", "FIRST_MATCH", "FIRST_PURCHASE",
]);

export const referralAttributions = pgTable("referral_attributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referralLinkId: varchar("referral_link_id").notNull().references(() => referralLinks.id),
  invitedUserId: varchar("invited_user_id").notNull().references(() => users.id),
  eventType: referralAttributionEventEnum("event_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uq_referral_attribution").on(table.referralLinkId, table.invitedUserId, table.eventType),
  index("idx_referral_attributions_link").on(table.referralLinkId),
  index("idx_referral_attributions_user").on(table.invitedUserId),
]);

export const insertReferralAttributionSchema = createInsertSchema(referralAttributions).omit({
  id: true,
  createdAt: true,
});
export type InsertReferralAttribution = z.infer<typeof insertReferralAttributionSchema>;
export type ReferralAttribution = typeof referralAttributions.$inferSelect;

// --- Referral Tier Milestones ---

export const referralMilestoneTypeEnum = pgEnum("referral_milestone_type", [
  "TIER_1", "TIER_2", "TIER_3", "TIER_4",
]);

export const referralMilestones = pgTable("referral_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  milestoneType: referralMilestoneTypeEnum("milestone_type").notNull(),
  referralCountAtGrant: integer("referral_count_at_grant").notNull(),
  bonusAwarded: integer("bonus_awarded").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uq_referral_milestone_user").on(table.userId, table.milestoneType),
  index("idx_referral_milestones_user").on(table.userId),
]);

export const insertReferralMilestoneSchema = createInsertSchema(referralMilestones).omit({
  id: true,
  createdAt: true,
});
export type InsertReferralMilestone = z.infer<typeof insertReferralMilestoneSchema>;
export type ReferralMilestone = typeof referralMilestones.$inferSelect;

export const contentAssetTypeEnum = pgEnum("content_asset_type", [
  "SCORE_CARD", "DAILY5_RANK_CARD", "STREAK_BADGE", "LEADERBOARD_SPOTLIGHT",
]);

export const contentAssets = pgTable("content_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assetType: contentAssetTypeEnum("asset_type").notNull(),
  userId: varchar("user_id").references(() => users.id),
  sourceEventId: varchar("source_event_id"),
  metadata: jsonb("metadata"),
  imagePath: text("image_path"),
  videoPath: text("video_path"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uq_content_asset").on(table.assetType, table.userId, table.sourceEventId),
  index("idx_content_assets_user").on(table.userId),
  index("idx_content_assets_type").on(table.assetType, table.createdAt),
]);

export const insertContentAssetSchema = createInsertSchema(contentAssets).omit({
  id: true,
  createdAt: true,
});
export type InsertContentAsset = z.infer<typeof insertContentAssetSchema>;
export type ContentAsset = typeof contentAssets.$inferSelect;

// ---- Social Media Agent ----

export const socialPlatformEnum = pgEnum("social_platform", ["TWITTER", "TIKTOK"]);
export const socialPostStatusEnum = pgEnum("social_post_status", [
  "DRAFT", "QUEUED", "PUBLISHING", "PUBLISHED", "FAILED", "SKIPPED",
]);
export const socialContentTypeEnum = pgEnum("social_content_type", [
  "TRIVIA_CARD", "LEADERBOARD_HIGHLIGHT", "STREAK_MILESTONE",
  "MARKET_PRICE_SPOTLIGHT", "NEW_USER_ACQUISITION", "REWARD_ANNOUNCEMENT", "CHALLENGE",
]);
export const abTestStatusEnum = pgEnum("ab_test_status", ["RUNNING", "CONCLUDED", "INCONCLUSIVE"]);
export const campaignRewardTypeEnum = pgEnum("campaign_reward_type", [
  "SIGNUP_BONUS", "STREAK_REWARD", "REFERRAL",
]);

export const socialPosts = pgTable("social_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: socialPlatformEnum("platform").notNull(),
  contentType: socialContentTypeEnum("content_type").notNull(),
  status: socialPostStatusEnum("status").notNull().default("DRAFT"),
  abGroup: varchar("ab_group", { length: 1 }),
  abTestId: varchar("ab_test_id"),
  campaignId: varchar("campaign_id"),
  cardId: varchar("card_id"),
  cardImageUrl: text("card_image_url"),
  composedImagePath: text("composed_image_path"),
  cardQueryParams: jsonb("card_query_params"),
  copyText: text("copy_text").notNull(),
  hashtags: text("hashtags").array(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  publishedAt: timestamp("published_at"),
  platformPostId: varchar("platform_post_id"),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorMessage: text("error_message"),
  factCheckPassed: boolean("fact_check_passed").notNull().default(false),
  factCheckLog: jsonb("fact_check_log"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_social_posts_platform_status").on(t.platform, t.status),
  index("idx_social_posts_scheduled").on(t.scheduledAt, t.status),
  index("idx_social_posts_ab_test").on(t.abTestId),
]);
export const insertSocialPostSchema = createInsertSchema(socialPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type SocialPost = typeof socialPosts.$inferSelect;

export const postAnalytics = pgTable("post_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => socialPosts.id),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  impressions: integer("impressions").default(0),
  likes: integer("likes").default(0),
  shares: integer("shares").default(0),
  comments: integer("comments").default(0),
  clicks: integer("clicks").default(0),
  profileVisits: integer("profile_visits").default(0),
  newSignupsAttributed: integer("new_signups_attributed").default(0),
  conversionRate: real("conversion_rate"),
}, (t) => [index("idx_post_analytics_post_id").on(t.postId)]);
export type PostAnalytics = typeof postAnalytics.$inferSelect;

export const abTests = pgTable("ab_tests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  contentType: socialContentTypeEnum("content_type").notNull(),
  testName: varchar("test_name").notNull(),
  hypothesis: text("hypothesis"),
  variantADescription: text("variant_a_description"),
  variantBDescription: text("variant_b_description"),
  status: abTestStatusEnum("status").notNull().default("RUNNING"),
  winner: varchar("winner", { length: 1 }),
  winningMetric: varchar("winning_metric"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
}, (t) => [index("idx_ab_tests_status").on(t.status)]);
export type AbTest = typeof abTests.$inferSelect;

// ---------------------------------------------------------------------------
// Prompt evolution — stores AI-generated copy variants produced by the
// nightly promptEvolution loop. contentGenerator loads active variants from
// here in preference to hardcoded copy.
// ---------------------------------------------------------------------------
export const evolvedCopyVariants = pgTable("evolved_copy_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contentType: socialContentTypeEnum("content_type").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(), // "TWITTER" | "TIKTOK" | "ALL"
  abGroup: varchar("ab_group", { length: 1 }).notNull(),   // "A" | "B" | "C"
  copyText: text("copy_text").notNull(),
  generation: integer("generation").notNull().default(1),
  rationale: text("rationale"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_evolved_copy_active").on(t.isActive, t.contentType, t.platform),
]);
export type EvolvedCopyVariant = typeof evolvedCopyVariants.$inferSelect;

export const campaignRewards = pgTable("campaign_rewards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  rewardType: campaignRewardTypeEnum("reward_type").notNull(),
  rewardDescription: text("reward_description").notNull(),
  rewardValue: varchar("reward_value").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  validFrom: timestamp("valid_from").defaultNow(),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("idx_campaign_rewards_active").on(t.isActive)]);
export type CampaignReward = typeof campaignRewards.$inferSelect;
