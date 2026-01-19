import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { matchService } from "./services/matchService";
import { matchmakingService } from "./services/matchmakingService";
import { streakService } from "./services/streakService";
import { log } from "./index";
import type { MatchState } from "@shared/schema";

interface ClientConnection {
  userId: string;
  username: string;
  lobbyId?: string;
  matchId?: string;
  membershipSecret?: string;
  isAuthenticated?: boolean;
  inQueue?: boolean;
}

const clients = new Map<WebSocket, ClientConnection>();
const lobbyConnections = new Map<string, Set<WebSocket>>();
const matchConnections = new Map<string, Set<WebSocket>>();

export function setupWebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    log("WebSocket client connected", "ws");

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (error) {
        console.error("WebSocket message error:", error);
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    });

    ws.on("close", async () => {
      const client = clients.get(ws);
      if (client) {
        if (client.inQueue) {
          matchmakingService.handleDisconnect(client.userId);
        }
        if (client.lobbyId) {
          await handleDisconnectFromLobby(ws, client);
        }
        if (client.matchId) {
          await handleDisconnectFromMatch(ws, client);
        }
        clients.delete(ws);
        log(`WebSocket client disconnected: ${client.username}`, "ws");
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });

  return wss;
}

async function handleMessage(ws: WebSocket, message: any) {
  const { type, payload } = message;

  switch (type) {
    case "join_lobby":
      await handleJoinLobbyWs(ws, payload);
      break;
    case "leave_lobby":
      await handleLeaveLobbyWs(ws, payload);
      break;
    case "start_match":
      await handleStartMatch(ws, payload);
      break;
    case "submit_answer":
      await handleSubmitAnswer(ws, payload);
      break;
    case "ready_next":
      await handleReadyNext(ws, payload);
      break;
    case "join_match":
      await handleJoinMatch(ws, payload);
      break;
    case "join_queue":
      await handleJoinQueue(ws, payload);
      break;
    case "leave_queue":
      await handleLeaveQueue(ws, payload);
      break;
    default:
      ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
  }
}

async function handleJoinLobbyWs(ws: WebSocket, payload: { userId: string; username: string; lobbyId: string; membershipSecret: string }) {
  const { userId, username, lobbyId, membershipSecret } = payload;
  
  const existingClient = clients.get(ws);
  if (existingClient && existingClient.userId && existingClient.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Cannot change user identity mid-session" }));
    return;
  }
  
  const lobby = await matchService.getLobby(lobbyId);
  if (!lobby) {
    ws.send(JSON.stringify({ type: "error", message: "Lobby not found" }));
    return;
  }
  
  if (!matchService.verifyMembershipSecret(lobby, userId, membershipSecret)) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid membership credentials" }));
    return;
  }
  
  clients.set(ws, { userId, username, lobbyId, membershipSecret, isAuthenticated: true });
  
  if (!lobbyConnections.has(lobbyId)) {
    lobbyConnections.set(lobbyId, new Set());
  }
  lobbyConnections.get(lobbyId)?.add(ws);
  
  const safeLobby = {
    id: lobby.id,
    joinCode: lobby.joinCode,
    hostId: lobby.hostId,
    hostUsername: lobby.hostUsername,
    guestId: lobby.guestId,
    guestUsername: lobby.guestUsername,
    status: lobby.status,
    mode: lobby.mode,
    totalQuestions: lobby.totalQuestions,
    createdAt: lobby.createdAt,
  };
  
  broadcastToLobby(lobbyId, {
    type: "lobby_update",
    payload: safeLobby,
  });
  
  ws.send(JSON.stringify({ type: "joined_lobby", payload: { lobbyId } }));
}

async function handleLeaveLobbyWs(ws: WebSocket, payload: { lobbyId: string; userId: string }) {
  const { lobbyId, userId } = payload;
  
  const result = await matchService.leaveLobby(lobbyId, userId);
  
  const client = clients.get(ws);
  if (client) {
    client.lobbyId = undefined;
  }
  
  lobbyConnections.get(lobbyId)?.delete(ws);
  
  if (result) {
    broadcastToLobby(lobbyId, {
      type: "lobby_update",
      payload: result,
    });
  } else {
    broadcastToLobby(lobbyId, {
      type: "lobby_closed",
      payload: { lobbyId },
    });
    lobbyConnections.delete(lobbyId);
  }
}

async function handleStartMatch(ws: WebSocket, payload: { lobbyId: string; hostId: string }) {
  const { lobbyId, hostId } = payload;
  
  const client = clients.get(ws);
  if (!client || !client.isAuthenticated || client.userId !== hostId) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized: only authenticated host can start the match" }));
    return;
  }
  
  const lobby = await matchService.getLobby(lobbyId);
  if (!lobby || lobby.hostId !== hostId) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized: you are not the host of this lobby" }));
    return;
  }
  
  if (!client.membershipSecret || !matchService.verifyMembershipSecret(lobby, hostId, client.membershipSecret)) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized: invalid membership secret" }));
    return;
  }
  
  const matchState = await matchService.startMatch(lobbyId, hostId);
  
  if (!matchState) {
    ws.send(JSON.stringify({ type: "error", message: "Failed to start match" }));
    return;
  }
  
  const lobbyClients = lobbyConnections.get(lobbyId);
  if (lobbyClients) {
    Array.from(lobbyClients).forEach(client => {
      const clientInfo = clients.get(client);
      if (clientInfo) {
        clientInfo.matchId = matchState.matchId;
        clientInfo.lobbyId = undefined;
      }
      
      if (!matchConnections.has(matchState.matchId)) {
        matchConnections.set(matchState.matchId, new Set());
      }
      matchConnections.get(matchState.matchId)?.add(client);
    });
    lobbyConnections.delete(lobbyId);
  }
  
  const clientMatchState = sanitizeMatchStateForClient(matchState);
  broadcastToMatch(matchState.matchId, {
    type: "match_started",
    payload: clientMatchState,
  });
}

async function handleSubmitAnswer(ws: WebSocket, payload: { matchId: string; userId: string; questionIndex: number; selectedAnswer: string }) {
  const { matchId, userId, questionIndex, selectedAnswer } = payload;
  
  const client = clients.get(ws);
  if (!client || !client.isAuthenticated || client.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized: user ID mismatch or not authenticated" }));
    return;
  }
  
  if (client.matchId !== matchId) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized: you are not in this match" }));
    return;
  }
  
  const result = await matchService.submitAnswer(matchId, userId, questionIndex, selectedAnswer);
  
  if (!result) {
    ws.send(JSON.stringify({ type: "error", message: "Failed to submit answer" }));
    return;
  }
  
  ws.send(JSON.stringify({
    type: "answer_result",
    payload: {
      correct: result.correct,
      pointsEarned: result.pointsEarned,
      correctAnswer: result.matchState.questions[questionIndex].correctAnswer,
    },
  }));
  
  broadcastToMatch(matchId, {
    type: "participant_answered",
    payload: {
      userId,
      questionIndex,
      participants: result.matchState.participants.map(p => ({
        userId: p.userId,
        username: p.username,
        score: p.score,
        hasAnsweredCurrent: p.hasAnsweredCurrent,
      })),
    },
  });
  
  if (result.bothAnswered) {
    const advancedState = await matchService.advanceQuestion(matchId);
    if (advancedState) {
      const clientMatchState = sanitizeMatchStateForClient(advancedState);
      
      if (advancedState.status === "completed") {
        for (const participant of advancedState.participants) {
          try {
            const streakResult = await streakService.processMatchCompletion(participant.userId, matchId);
            if (streakResult.success && !streakResult.alreadyClaimed && streakResult.totalAwarded) {
              log(`[Streak] User ${participant.userId} earned ${streakResult.totalAwarded} PackPTS for day ${streakResult.streakInfo?.currentDays} streak`, "ws");
            }
          } catch (streakError) {
            console.error("Failed to process streak for participant:", streakError);
          }
        }

        broadcastToMatch(matchId, {
          type: "match_completed",
          payload: clientMatchState,
        });
      } else {
        broadcastToMatch(matchId, {
          type: "next_question",
          payload: clientMatchState,
        });
      }
    }
  }
}

async function handleReadyNext(ws: WebSocket, payload: { matchId: string }) {
  const { matchId } = payload;
  const matchState = matchService.getMatchState(matchId);
  
  if (matchState) {
    const clientMatchState = sanitizeMatchStateForClient(matchState);
    ws.send(JSON.stringify({
      type: "match_state",
      payload: clientMatchState,
    }));
  }
}

async function handleJoinMatch(ws: WebSocket, payload: { matchId: string; userId: string; username: string; membershipSecret: string }) {
  const { matchId, userId, username, membershipSecret } = payload;
  
  const existingClient = clients.get(ws);
  if (existingClient && existingClient.userId && existingClient.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Cannot change user identity mid-session" }));
    return;
  }
  
  const matchState = matchService.getMatchState(matchId);
  if (!matchState) {
    ws.send(JSON.stringify({ type: "error", message: "Match not found" }));
    return;
  }
  
  const lobby = await matchService.getLobby(matchState.lobbyId);
  if (!lobby) {
    ws.send(JSON.stringify({ type: "error", message: "Lobby not found" }));
    return;
  }
  
  if (!matchService.verifyMembershipSecret(lobby, userId, membershipSecret)) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid membership credentials" }));
    return;
  }
  
  const isParticipant = matchState.participants.some(p => p.userId === userId);
  if (!isParticipant) {
    ws.send(JSON.stringify({ type: "error", message: "You are not a participant in this match" }));
    return;
  }
  
  clients.set(ws, { userId, username, matchId, membershipSecret, isAuthenticated: true });
  
  if (!matchConnections.has(matchId)) {
    matchConnections.set(matchId, new Set());
  }
  matchConnections.get(matchId)?.add(ws);
  
  const clientMatchState = sanitizeMatchStateForClient(matchState);
  ws.send(JSON.stringify({
    type: "match_started",
    payload: clientMatchState,
  }));
  
  log(`${username} joined match ${matchId}`, "ws");
}

function sanitizeMatchStateForClient(matchState: MatchState): any {
  const currentQuestion = matchState.questions[matchState.currentQuestionIndex];
  
  return {
    matchId: matchState.matchId,
    lobbyId: matchState.lobbyId,
    status: matchState.status,
    currentQuestionIndex: matchState.currentQuestionIndex,
    totalQuestions: matchState.totalQuestions,
    currentQuestion: currentQuestion ? {
      card: {
        id: currentQuestion.card.id,
        imageUrl: currentQuestion.card.imageUrl,
        team: currentQuestion.card.team,
        year: currentQuestion.card.year,
        setName: currentQuestion.card.setName,
        cardNumber: currentQuestion.card.cardNumber,
      },
      options: currentQuestion.options,
      pointValue: currentQuestion.pointValue,
    } : null,
    participants: matchState.participants.map(p => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
      correctAnswers: p.correctAnswers,
      hasAnsweredCurrent: p.hasAnsweredCurrent,
    })),
    winner: matchState.winner,
  };
}

function broadcastToLobby(lobbyId: string, message: any) {
  const lobbyClients = lobbyConnections.get(lobbyId);
  if (!lobbyClients) return;
  
  const messageStr = JSON.stringify(message);
  Array.from(lobbyClients).forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

function broadcastToMatch(matchId: string, message: any) {
  const matchClients = matchConnections.get(matchId);
  if (!matchClients) return;
  
  const messageStr = JSON.stringify(message);
  Array.from(matchClients).forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

async function handleJoinQueue(ws: WebSocket, payload: { userId: string; username: string; totalQuestions?: number; gameSetId?: string | null }) {
  const { userId, username, totalQuestions = 10, gameSetId = null } = payload;
  
  const existingClient = clients.get(ws);
  if (existingClient && existingClient.userId && existingClient.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Cannot change user identity mid-session" }));
    return;
  }
  
  clients.set(ws, { userId, username, inQueue: true });
  
  const result = await matchmakingService.joinQueue(userId, username, ws, totalQuestions, gameSetId);
  
  ws.send(JSON.stringify({
    type: "queue_joined",
    payload: {
      position: result.position,
      queueSize: matchmakingService.getQueueSize(),
    },
  }));
  
  log(`${username} joined matchmaking queue (position: ${result.position})`, "ws");
}

async function handleLeaveQueue(ws: WebSocket, payload: { userId: string }) {
  const { userId } = payload;
  
  const client = clients.get(ws);
  if (client) {
    client.inQueue = false;
  }
  
  const removed = matchmakingService.leaveQueue(userId);
  
  ws.send(JSON.stringify({
    type: "queue_left",
    payload: { success: removed },
  }));
  
  log(`User ${userId} left matchmaking queue`, "ws");
}

async function handleDisconnectFromLobby(ws: WebSocket, client: ClientConnection) {
  const { lobbyId, userId } = client;
  if (!lobbyId || !userId) return;
  
  const lobbyClients = lobbyConnections.get(lobbyId);
  lobbyClients?.delete(ws);
  
  const lobby = await matchService.getLobby(lobbyId);
  if (!lobby) return;
  
  if (lobby.hostId === userId) {
    await matchService.leaveLobby(lobbyId, userId);
    broadcastToLobby(lobbyId, {
      type: "lobby_closed",
      payload: { reason: "Host disconnected" },
    });
    lobbyConnections.delete(lobbyId);
    log(`Host ${client.username} disconnected, lobby ${lobbyId} closed`, "ws");
  } else if (lobby.guestId === userId) {
    const updatedLobby = await matchService.leaveLobby(lobbyId, userId);
    if (updatedLobby) {
      broadcastToLobby(lobbyId, {
        type: "lobby_update",
        payload: updatedLobby,
      });
    }
    log(`Guest ${client.username} left lobby ${lobbyId}`, "ws");
  }
}

async function handleDisconnectFromMatch(ws: WebSocket, client: ClientConnection) {
  const { matchId, userId, username } = client;
  if (!matchId || !userId) return;
  
  const matchClients = matchConnections.get(matchId);
  matchClients?.delete(ws);
  
  const matchState = await matchService.forfeitMatch(matchId, userId);
  
  if (matchState) {
    const clientMatchState = sanitizeMatchStateForClient(matchState);
    broadcastToMatch(matchId, {
      type: "match_completed",
      payload: { ...clientMatchState, forfeit: true, forfeitedBy: username },
    });
    matchConnections.delete(matchId);
    log(`Player ${username} forfeited match ${matchId} by disconnecting`, "ws");
  } else {
    broadcastToMatch(matchId, {
      type: "participant_disconnected",
      payload: { userId, username },
    });
    log(`Player ${username} disconnected from match ${matchId}`, "ws");
  }
}
