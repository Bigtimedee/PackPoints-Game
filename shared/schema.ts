import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, index, jsonb, real } from "drizzle-orm/pg-core";
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

// User table - combines Replit Auth fields with game stats
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").unique(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  points: integer("points").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  totalAnswers: integer("total_answers").notNull().default(0),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
});

export const insertBaseballCardSchema = createInsertSchema(baseballCards).omit({
  id: true,
});

export type InsertBaseballCard = z.infer<typeof insertBaseballCardSchema>;
export type BaseballCard = typeof baseballCards.$inferSelect;

export interface GameQuestion {
  card: BaseballCard;
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
  status: "active" | "completed";
  startedAt: string;
  completedAt?: string;
}

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
  mode: z.enum(["solo", "1v1", "tournament"]),
  totalQuestions: z.number().min(5).max(20),
});

export type StartGameRequest = z.infer<typeof startGameSchema>;

export const registerSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6).max(100),
});

export type RegisterRequest = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginRequest = z.infer<typeof loginSchema>;

export const submitAnswerSchema = z.object({
  sessionId: z.string(),
  questionIndex: z.number(),
  selectedAnswer: z.string(),
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
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLobbySchema = createInsertSchema(lobbies).omit({
  id: true,
  createdAt: true,
});

export type InsertLobby = z.infer<typeof insertLobbySchema>;
export type Lobby = typeof lobbies.$inferSelect;

export const matches = pgTable("matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lobbyId: varchar("lobby_id").notNull(),
  status: text("status").notNull().default("active"),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  totalQuestions: integer("total_questions").notNull(),
  questionsData: text("questions_data").notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertMatchSchema = createInsertSchema(matches).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matches.$inferSelect;

export const matchParticipants = pgTable("match_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  matchId: varchar("match_id").notNull(),
  userId: varchar("user_id").notNull(),
  username: text("username").notNull(),
  score: integer("score").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  isConnected: boolean("is_connected").notNull().default(true),
});

export const insertMatchParticipantSchema = createInsertSchema(matchParticipants).omit({
  id: true,
});

export type InsertMatchParticipant = z.infer<typeof insertMatchParticipantSchema>;
export type MatchParticipant = typeof matchParticipants.$inferSelect;

export interface MatchState {
  matchId: string;
  lobbyId: string;
  status: "waiting" | "active" | "completed";
  currentQuestionIndex: number;
  totalQuestions: number;
  questions: GameQuestion[];
  participants: {
    userId: string;
    username: string;
    score: number;
    correctAnswers: number;
    currentQuestionIndex: number;
    hasAnsweredCurrent: boolean;
  }[];
  winner?: string;
}

export const createLobbySchema = z.object({
  hostId: z.string(),
  hostUsername: z.string(),
  totalQuestions: z.number().min(5).max(20).default(10),
});

export const joinLobbySchema = z.object({
  joinCode: z.string().length(6),
  guestId: z.string(),
  guestUsername: z.string(),
});

export const matchAnswerSchema = z.object({
  matchId: z.string(),
  userId: z.string(),
  questionIndex: z.number(),
  selectedAnswer: z.string(),
});

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
export const ledgerEntryTypes = ["EARN", "SPEND", "ADJUST", "PURCHASE_CREDIT", "REVERSAL"] as const;
export type LedgerEntryType = typeof ledgerEntryTypes[number];

// PackPTS Ledger - append-only transaction log
export const ledgerEntries = pgTable("ledger_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").notNull().references(() => wallets.id),
  entryType: varchar("entry_type", { length: 20 }).notNull(), // EARN, SPEND, ADJUST, PURCHASE_CREDIT, REVERSAL
  amount: integer("amount").notNull(), // positive for credits, negative for debits
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  metadata: jsonb("metadata"), // flexible JSON for additional context
  idempotencyKey: varchar("idempotency_key", { length: 64 }).unique(), // prevents duplicate transactions
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ledger_wallet").on(table.walletId),
  index("idx_ledger_created").on(table.createdAt),
  index("idx_ledger_idempotency").on(table.idempotencyKey),
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
  createdAt: timestamp("created_at").defaultNow(),
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
  eventId: varchar("event_id", { length: 200 }).notNull().unique(), // Stripe event ID
  eventType: varchar("event_type", { length: 100 }).notNull(), // checkout.session.completed, invoice.paid, etc.
  userId: varchar("user_id"), // resolved from metadata, null if unknown
  payload: jsonb("payload").notNull(), // raw Stripe event payload
  status: varchar("status", { length: 20 }).notNull().default("received"), // received, processed, failed, ignored
  errorMessage: text("error_message"),
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
