import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { startGameSchema, submitAnswerSchema, createLobbySchema, joinLobbySchema, registerSchema, loginSchema, users, type User } from "@shared/schema";
import { fetchAdditionalCards, VERIFIED_1987_TOPPS_IMAGES } from "./services/priceCharting";
import { fetch1987ToppsFromCardHedge, isCardHedgeConfigured } from "./services/cardHedge";
import { isAuthenticated } from "./replit_integrations/auth";
import { matchService } from "./services/matchService";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

// Middleware to require admin role
const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as any;
  if (!user?.claims?.sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const dbUser = await storage.getUser(user.claims.sub);
  if (!dbUser?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post("/api/game/start", async (req: any, res) => {
    try {
      const parsed = startGameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { mode, totalQuestions } = parsed.data;
      
      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      
      if (mode !== "solo" && !userId) {
        return res.status(401).json({ error: "Authentication required for this game mode" });
      }
      
      let guestSessionId: string | undefined;
      if (!userId) {
        if (!req.session.guestId) {
          req.session.guestId = require('crypto').randomUUID();
        }
        guestSessionId = req.session.guestId;
      }
      
      const session = await storage.createGameSession(userId, mode, totalQuestions, guestSessionId);
      
      res.json(session);
    } catch (error) {
      console.error("Error starting game:", error);
      res.status(500).json({ error: "Failed to start game" });
    }
  });

  app.get("/api/game/session/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const session = await storage.getGameSession(id);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      res.json(session);
    } catch (error) {
      console.error("Error getting session:", error);
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  app.post("/api/game/answer", async (req, res) => {
    try {
      const parsed = submitAnswerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { sessionId, questionIndex, selectedAnswer } = parsed.data;
      const session = await storage.getGameSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      if (session.status === "completed") {
        return res.status(400).json({ error: "Game already completed" });
      }
      
      if (questionIndex !== session.currentQuestionIndex) {
        return res.status(400).json({ error: "Invalid question index" });
      }
      
      const currentQuestion = session.questions[questionIndex];
      
      if ((currentQuestion as any).answered) {
        return res.status(400).json({ error: "Question already answered" });
      }
      
      const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
      
      if (isCorrect) {
        session.score += currentQuestion.pointValue;
        session.correctAnswers += 1;
      }
      
      (currentQuestion as any).answered = true;
      (currentQuestion as any).userAnswer = selectedAnswer;
      
      await storage.updateGameSession(session);
      
      res.json({
        correct: isCorrect,
        correctAnswer: currentQuestion.correctAnswer,
        pointsEarned: isCorrect ? currentQuestion.pointValue : 0,
        totalScore: session.score,
        session,
      });
    } catch (error) {
      console.error("Error submitting answer:", error);
      res.status(500).json({ error: "Failed to submit answer" });
    }
  });

  app.post("/api/game/next", async (req: any, res) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }
      
      const session = await storage.getGameSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      if (session.currentQuestionIndex >= session.totalQuestions - 1) {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        
        if (session.userId) {
          await storage.updateUserStats(session.userId, {
            pointsEarned: session.score,
            correctAnswers: session.correctAnswers,
            totalAnswers: session.totalQuestions,
          });
        } else if (session.guestSessionId) {
          if (!req.session.pendingPoints) {
            req.session.pendingPoints = { score: 0, correctAnswers: 0, totalAnswers: 0, gamesPlayed: 0 };
          }
          req.session.pendingPoints.score += session.score;
          req.session.pendingPoints.correctAnswers += session.correctAnswers;
          req.session.pendingPoints.totalAnswers += session.totalQuestions;
          req.session.pendingPoints.gamesPlayed += 1;
        }
      } else {
        session.currentQuestionIndex += 1;
      }
      
      await storage.updateGameSession(session);
      
      res.json(session);
    } catch (error) {
      console.error("Error moving to next question:", error);
      res.status(500).json({ error: "Failed to move to next question" });
    }
  });

  app.get("/api/leaderboard", async (_req, res) => {
    try {
      const leaderboard = await storage.getLeaderboard(20);
      res.json(leaderboard);
    } catch (error) {
      console.error("Error getting leaderboard:", error);
      res.status(500).json({ error: "Failed to get leaderboard" });
    }
  });

  app.get("/api/marketplace", async (_req, res) => {
    try {
      const options = await storage.getRedemptionOptions();
      res.json(options);
    } catch (error) {
      console.error("Error getting marketplace:", error);
      res.status(500).json({ error: "Failed to get marketplace" });
    }
  });

  app.get("/api/profile/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Calculate rank from leaderboard
      const leaderboard = await storage.getLeaderboard(100);
      const rank = leaderboard.findIndex(e => e.points <= user.points) + 1 || leaderboard.length + 1;
      
      // Calculate level (every 1000 points = 1 level)
      const level = Math.floor(user.points / 1000) + 1;
      const pointsToNextLevel = 1000 - (user.points % 1000);
      const levelProgress = Math.round(((user.points % 1000) / 1000) * 100);
      
      res.json({
        points: user.points,
        gamesPlayed: user.gamesPlayed,
        correctAnswers: user.correctAnswers,
        totalAnswers: user.totalAnswers,
        rank,
        level,
        pointsToNextLevel,
        levelProgress,
      });
    } catch (error) {
      console.error("Error getting profile stats:", error);
      res.status(500).json({ error: "Failed to get profile stats" });
    }
  });

  app.get("/api/cards", async (_req, res) => {
    try {
      const cards = await storage.getCards();
      res.json(cards);
    } catch (error) {
      console.error("Error getting cards:", error);
      res.status(500).json({ error: "Failed to get cards" });
    }
  });

  app.post("/api/auth/register", async (req: any, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      
      const { username, password } = parsed.data;
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: "Username already taken" });
      }
      
      const user = await storage.createLocalUser(username, password);
      
      if (req.session.pendingPoints) {
        const pending = req.session.pendingPoints;
        await storage.updateUserStats(user.id, {
          pointsEarned: pending.score,
          correctAnswers: pending.correctAnswers,
          totalAnswers: pending.totalAnswers,
        });
        
        for (let i = 1; i < pending.gamesPlayed; i++) {
          await db.update(users).set({
            gamesPlayed: sql`${users.gamesPlayed} + 1`
          }).where(eq(users.id, user.id));
        }
        
        delete req.session.pendingPoints;
        delete req.session.guestId;
      }
      
      req.session.localUserId = user.id;
      
      const updatedUser = await storage.getUser(user.id);
      
      res.json({ 
        success: true, 
        user: {
          id: updatedUser!.id,
          username: updatedUser!.username,
          points: updatedUser!.points,
          gamesPlayed: updatedUser!.gamesPlayed,
        }
      });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ error: "Failed to register" });
    }
  });

  app.post("/api/auth/local-login", async (req: any, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      
      const { username, password } = parsed.data;
      
      const user = await storage.validateLocalCredentials(username, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      req.session.localUserId = user.id;
      
      res.json({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          points: user.points,
          gamesPlayed: user.gamesPlayed,
        }
      });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ error: "Failed to login" });
    }
  });

  app.get("/api/guest/pending-points", async (req: any, res) => {
    try {
      const pendingPoints = req.session?.pendingPoints || null;
      res.json({ pendingPoints });
    } catch (error) {
      console.error("Error getting pending points:", error);
      res.status(500).json({ error: "Failed to get pending points" });
    }
  });

  app.post("/api/auth/local-logout", async (req: any, res) => {
    try {
      delete req.session.localUserId;
      res.json({ success: true });
    } catch (error) {
      console.error("Error logging out:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  });

  app.post("/api/lobby/create", async (req, res) => {
    try {
      const parsed = createLobbySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { hostId, hostUsername, totalQuestions } = parsed.data;
      const lobby = await matchService.createLobby(hostId, hostUsername, totalQuestions);
      
      const { guestSecret: _, ...lobbyForHost } = lobby;
      res.json({ ...lobbyForHost, membershipSecret: lobby.hostSecret });
    } catch (error) {
      console.error("Error creating lobby:", error);
      res.status(500).json({ error: "Failed to create lobby" });
    }
  });

  app.post("/api/lobby/join", async (req, res) => {
    try {
      const parsed = joinLobbySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { joinCode, guestId, guestUsername } = parsed.data;
      const lobby = await matchService.joinLobby(joinCode, guestId, guestUsername);
      
      if (!lobby) {
        return res.status(404).json({ error: "Lobby not found or not available" });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = lobby;
      res.json({ ...safeLobby, membershipSecret: lobby.guestSecret });
    } catch (error) {
      console.error("Error joining lobby:", error);
      res.status(500).json({ error: "Failed to join lobby" });
    }
  });

  app.get("/api/lobby/:id", async (req, res) => {
    try {
      const lobby = await matchService.getLobby(req.params.id);
      
      if (!lobby) {
        return res.status(404).json({ error: "Lobby not found" });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = lobby;
      res.json(safeLobby);
    } catch (error) {
      console.error("Error getting lobby:", error);
      res.status(500).json({ error: "Failed to get lobby" });
    }
  });

  app.get("/api/lobby/code/:code", async (req, res) => {
    try {
      const lobby = await matchService.getLobbyByCode(req.params.code);
      
      if (!lobby) {
        return res.status(404).json({ error: "Lobby not found" });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = lobby;
      res.json(safeLobby);
    } catch (error) {
      console.error("Error getting lobby:", error);
      res.status(500).json({ error: "Failed to get lobby" });
    }
  });

  app.post("/api/lobby/:id/leave", async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "userId required" });
      }
      
      const result = await matchService.leaveLobby(req.params.id, userId);
      
      res.json({ success: true, lobby: result });
    } catch (error) {
      console.error("Error leaving lobby:", error);
      res.status(500).json({ error: "Failed to leave lobby" });
    }
  });

  app.post("/api/admin/fetch-cards", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.body.limit) || 5, 10);
      
      const existingCards = await storage.getCards();
      const existingNames = new Set(existingCards.map(c => c.playerName));
      
      const newCards = await fetchAdditionalCards(limit);
      
      const uniqueNewCards = newCards.filter(c => !existingNames.has(c.playerName));
      
      let added = 0;
      for (const card of uniqueNewCards) {
        await storage.addCard({
          playerName: card.playerName,
          team: card.team || "Unknown",
          position: "Unknown",
          year: 1987,
          setName: "Topps",
          cardNumber: card.cardNumber,
          imageUrl: card.imageUrl,
          popularity: card.popularity,
          imageVerified: true,
        });
        added++;
      }
      
      res.json({ 
        message: `Added ${added} new cards to database`,
        added,
        total: existingCards.length + added
      });
    } catch (error) {
      console.error("Error fetching additional cards:", error);
      res.status(500).json({ error: "Failed to fetch cards" });
    }
  });

  app.get("/api/cards/stats", async (_req, res) => {
    try {
      const cards = await storage.getCards();
      const verified = cards.filter(c => c.imageVerified).length;
      res.json({
        total: cards.length,
        verified,
        unverified: cards.length - verified
      });
    } catch (error) {
      console.error("Error getting card stats:", error);
      res.status(500).json({ error: "Failed to get card stats" });
    }
  });

  app.get("/api/admin/dashboard", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const allUsers: User[] = await db.select().from(users);
      const allCards = await storage.getCards();
      const verifiedCards = allCards.filter(c => c.imageVerified).length;
      
      const totalUsers = allUsers.length;
      const totalPoints = allUsers.reduce((sum: number, u: User) => sum + u.points, 0);
      const totalGames = allUsers.reduce((sum: number, u: User) => sum + u.gamesPlayed, 0);
      const totalCorrect = allUsers.reduce((sum: number, u: User) => sum + u.correctAnswers, 0);
      const totalAnswers = allUsers.reduce((sum: number, u: User) => sum + u.totalAnswers, 0);
      const avgAccuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
      
      const topPlayers = [...allUsers]
        .sort((a: User, b: User) => b.points - a.points)
        .slice(0, 5)
        .map((u: User) => ({
          username: u.firstName || u.email?.split('@')[0] || 'Anonymous',
          points: u.points,
          gamesPlayed: u.gamesPlayed,
        }));
      
      const mostActive = [...allUsers]
        .sort((a: User, b: User) => b.gamesPlayed - a.gamesPlayed)
        .slice(0, 5)
        .map((u: User) => ({
          username: u.firstName || u.email?.split('@')[0] || 'Anonymous',
          gamesPlayed: u.gamesPlayed,
          points: u.points,
        }));
      
      res.json({
        overview: {
          totalUsers,
          totalPoints,
          totalGames,
          avgAccuracy,
          totalCards: allCards.length,
          verifiedCards,
        },
        topPlayers,
        mostActive,
      });
    } catch (error) {
      console.error("Error getting dashboard stats:", error);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const search = (req.query.search as string) || "";
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;
      
      let allUsers: User[] = await db.select().from(users);
      
      if (search) {
        const searchLower = search.toLowerCase();
        allUsers = allUsers.filter((u: User) => 
          (u.firstName || '').toLowerCase().includes(searchLower) ||
          (u.lastName || '').toLowerCase().includes(searchLower) ||
          (u.email || '').toLowerCase().includes(searchLower)
        );
      }
      
      const total = allUsers.length;
      const sortedUsers = [...allUsers].sort((a: User, b: User) => b.points - a.points);
      const paginatedUsers = sortedUsers.slice(offset, offset + limit);
      
      const usersWithStats = paginatedUsers.map((u: User) => ({
        id: u.id,
        username: u.firstName || u.email?.split('@')[0] || 'Anonymous',
        points: u.points,
        gamesPlayed: u.gamesPlayed,
        correctAnswers: u.correctAnswers,
        totalAnswers: u.totalAnswers,
        accuracy: u.totalAnswers > 0 ? Math.round((u.correctAnswers / u.totalAnswers) * 100) : 0,
      }));
      
      res.json({
        users: usersWithStats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error getting users:", error);
      res.status(500).json({ error: "Failed to get users" });
    }
  });

  app.get("/api/admin/users/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const accuracy = user.totalAnswers > 0 
        ? Math.round((user.correctAnswers / user.totalAnswers) * 100) 
        : 0;
      
      const avgPointsPerGame = user.gamesPlayed > 0 
        ? Math.round(user.points / user.gamesPlayed) 
        : 0;
      
      res.json({
        id: user.id,
        username: user.firstName || user.email?.split('@')[0] || 'Anonymous',
        points: user.points,
        gamesPlayed: user.gamesPlayed,
        correctAnswers: user.correctAnswers,
        totalAnswers: user.totalAnswers,
        accuracy,
        avgPointsPerGame,
      });
    } catch (error) {
      console.error("Error getting user:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/admin/sync-images", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const cards = await storage.getCards();
      const players = cards.map(c => ({ playerName: c.playerName, cardNumber: c.cardNumber }));
      
      const imageResults = await fetch1987ToppsFromCardHedge(players);
      
      let verified = 0;
      let fromCardHedge = 0;
      let unverified = 0;
      
      for (const card of cards) {
        const result = imageResults.get(card.playerName);
        
        if (result && result.imageUrl && result.verified) {
          await storage.updateCardImage(card.playerName, result.imageUrl, true);
          verified++;
          if (result.source === "cardhedge") {
            fromCardHedge++;
          }
        } else if (result && result.imageUrl) {
          await storage.updateCardImage(card.playerName, result.imageUrl, false);
          unverified++;
        } else {
          await storage.updateCardImage(card.playerName, "", false);
          unverified++;
        }
      }
      
      res.json({ 
        message: `Synced images: ${verified} verified (${fromCardHedge} from Card Hedge), ${unverified} unverified`,
        verified,
        fromCardHedge,
        unverified,
        cardHedgeConfigured: isCardHedgeConfigured()
      });
    } catch (error) {
      console.error("Error syncing images:", error);
      res.status(500).json({ error: "Failed to sync images" });
    }
  });

  return httpServer;
}
