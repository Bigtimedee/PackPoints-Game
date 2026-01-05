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
