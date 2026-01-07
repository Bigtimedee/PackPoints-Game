import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertGameSessionSchema, submitAnswerSchema } from "@shared/schema";
import { fetchAdditionalCards, VERIFIED_1987_TOPPS_IMAGES } from "./services/priceCharting";
import { fetch1987ToppsFromCardHedge, isCardHedgeConfigured } from "./services/cardHedge";
import { requireAdminAuth } from "./middleware/adminAuth";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post("/api/game/start", async (req, res) => {
    try {
      const parsed = insertGameSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { mode, userId, totalQuestions } = parsed.data;
      const session = await storage.createGameSession(userId, mode, totalQuestions);
      
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

  app.post("/api/game/next", async (req, res) => {
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

  app.get("/api/profile/stats", async (_req, res) => {
    try {
      const stats = {
        points: 2500,
        gamesPlayed: 42,
        correctAnswers: 156,
        totalAnswers: 210,
        rank: 15,
        level: 5,
        pointsToNextLevel: 500,
        levelProgress: 60,
      };
      res.json(stats);
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

  app.post("/api/admin/fetch-cards", requireAdminAuth, async (req, res) => {
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

  app.post("/api/admin/sync-images", requireAdminAuth, async (_req, res) => {
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
