import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  points: integer("points").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  totalAnswers: integer("total_answers").notNull().default(0),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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
  userId: string;
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

export const insertGameSessionSchema = z.object({
  mode: z.enum(["solo", "1v1", "tournament"]),
  userId: z.string(),
  totalQuestions: z.number().min(5).max(20),
});

export type InsertGameSession = z.infer<typeof insertGameSessionSchema>;

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
