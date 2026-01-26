import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer, IncomingMessage } from "http";
import { matchService } from "./services/matchService";
import { dbMatchmakingQueue } from "./services/matchmaking/dbQueue";
import { presenceService } from "./services/presenceService";
import { streakService } from "./services/streakService";
import { friendMatchInviteService } from "./services/friends/friendMatchInviteService";
import { log } from "./index";
import { MatchStatus, type MatchState } from "@shared/schema";
import { getSession } from "./replit_integrations/auth/replitAuth";
import { isMatchParticipantByState, isMatchParticipant } from "./services/auth/isMatchParticipant";
import passport from "passport";

const INVITE_EXPIRATION_INTERVAL = 10000; // 10 seconds
let inviteExpirationInterval: NodeJS.Timeout | null = null;

function startInviteExpirationJob() {
  if (inviteExpirationInterval) return;
  
  inviteExpirationInterval = setInterval(async () => {
    try {
      const expired = await friendMatchInviteService.expireOldInvites();
      if (expired.length > 0) {
        log(`[FriendMatchInvite] Expired ${expired.length} invite(s)`, "ws");
      }
    } catch (err) {
      console.error("[FriendMatchInvite] Expiration job error:", err);
    }
  }, INVITE_EXPIRATION_INTERVAL);
}

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds to respond

interface ClientConnection {
  userId: string;
  username: string;
  lobbyId?: string;
  matchId?: string;
  membershipSecret?: string;
  isAuthenticated?: boolean;
  inQueue?: boolean;
  lastHeartbeat?: number;
  heartbeatTimeout?: NodeJS.Timeout;
  socketId?: string;
  sessionUserId?: string;
}

interface ExtendedWebSocket extends WebSocket {
  sessionUserId?: string;
  sessionUsername?: string;
}

const clients = new Map<WebSocket, ClientConnection>();
const userSockets = new Map<string, WebSocket>(); // userId -> WebSocket for quick lookup
const lobbyConnections = new Map<string, Set<WebSocket>>();
const matchConnections = new Map<string, Set<WebSocket>>();

// Periodic heartbeat checker
let heartbeatChecker: NodeJS.Timeout | null = null;

function startHeartbeatChecker(wss: WebSocketServer) {
  if (heartbeatChecker) return;
  
  heartbeatChecker = setInterval(() => {
    const now = Date.now();
    wss.clients.forEach((ws) => {
      const client = clients.get(ws);
      if (client && client.lastHeartbeat) {
        const timeSinceHeartbeat = now - client.lastHeartbeat;
        if (timeSinceHeartbeat > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
          log(`Heartbeat timeout for user ${client.userId}, closing connection`, "ws");
          ws.terminate();
        }
      }
    });
  }, HEARTBEAT_INTERVAL);
}

function parseSessionFromUpgrade(req: IncomingMessage): Promise<{ userId?: string; username?: string }> {
  return new Promise((resolve) => {
    const sessionMiddleware = getSession();
    const mockRes = { 
      on: () => {}, 
      end: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
    } as any;
    
    sessionMiddleware(req as any, mockRes, () => {
      passport.initialize()(req as any, mockRes, () => {
        passport.session()(req as any, mockRes, () => {
          const user = (req as any).user;
          const session = (req as any).session;
          
          if (user?.claims?.sub) {
            resolve({ userId: user.claims.sub, username: user.claims.name || user.claims.preferred_username });
          } else if (session?.localUserId) {
            resolve({ userId: session.localUserId, username: session.localUsername });
          } else {
            resolve({});
          }
        });
      });
    });
  });
}

export function setupWebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, path: "/ws" });
  
  httpServer.on("upgrade", async (req, socket, head) => {
    if (req.url !== "/ws" && !req.url?.startsWith("/ws?")) {
      return;
    }
    
    try {
      const sessionData = await parseSessionFromUpgrade(req);
      
      wss.handleUpgrade(req, socket, head, (ws) => {
        const extWs = ws as ExtendedWebSocket;
        extWs.sessionUserId = sessionData.userId;
        extWs.sessionUsername = sessionData.username;
        
        if (sessionData.userId) {
          log(`[WS Upgrade] Session authenticated: userId=${sessionData.userId}, username=${sessionData.username}`, "ws");
        } else {
          log(`[WS Upgrade] No session found, will rely on message-based auth`, "ws");
        }
        
        wss.emit("connection", extWs, req);
      });
    } catch (err) {
      console.error("[WS Upgrade] Error parsing session:", err);
      socket.destroy();
    }
  });

  // Start periodic heartbeat checker
  startHeartbeatChecker(wss);
  
  // Start friend match invite expiration job
  startInviteExpirationJob();

  wss.on("connection", (ws: ExtendedWebSocket) => {
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
        // Clear heartbeat timeout
        if (client.heartbeatTimeout) {
          clearTimeout(client.heartbeatTimeout);
        }
        
        // Update presence to offline
        if (client.userId) {
          userSockets.delete(client.userId);
          presenceService.setOffline(client.userId).catch((err: unknown) => {
            console.error("Failed to update presence:", err);
          });
        }
        
        if (client.inQueue) {
          dbMatchmakingQueue.handleDisconnect(client.userId);
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

// Export for other modules to send messages to specific users
export function sendToUser(userId: string, message: any): boolean {
  const ws = userSockets.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// Friend match invite notifications
export function notifyFriendMatchInvite(toUserId: string, invite: {
  inviteId: string;
  fromUserId: string;
  fromUsername: string;
  bucket: string;
  expiresAt: Date;
}) {
  return sendToUser(toUserId, {
    type: "FRIEND_MATCH_INVITE",
    payload: invite,
  });
}

export function notifyFriendMatchInviteCancelled(toUserId: string, inviteId: string) {
  return sendToUser(toUserId, {
    type: "FRIEND_MATCH_INVITE_CANCELLED",
    payload: { inviteId },
  });
}

export function notifyFriendMatchInviteExpired(toUserId: string, inviteId: string) {
  return sendToUser(toUserId, {
    type: "FRIEND_MATCH_INVITE_EXPIRED",
    payload: { inviteId },
  });
}

export function notifyFriendMatchAccepted(toUserId: string, data: {
  inviteId: string;
  matchId: string;
  lobbyId: string;
  membershipSecret: string;
}) {
  return sendToUser(toUserId, {
    type: "FRIEND_MATCH_ACCEPTED",
    payload: data,
  });
}

async function handleMessage(ws: WebSocket, message: any) {
  const { type, payload } = message;

  switch (type) {
    case "heartbeat":
      await handleHeartbeat(ws, payload);
      break;
    case "auth":
      await handleAuth(ws, payload);
      break;
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
    case "match_resync":
      await handleMatchResync(ws, payload);
      break;
    default:
      ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
  }
}

// Auth handler for initial connection
async function handleAuth(ws: WebSocket, payload: { userId: string; username: string }) {
  const { userId, username } = payload;
  
  if (!userId || !username) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid auth payload" }));
    return;
  }
  
  // Check if user already has a connection
  const existingWs = userSockets.get(userId);
  if (existingWs && existingWs !== ws && existingWs.readyState === WebSocket.OPEN) {
    // Disconnect the old connection
    existingWs.send(JSON.stringify({ type: "disconnected", message: "Connected from another location" }));
    existingWs.close();
  }
  
  const socketId = Math.random().toString(36).substring(7);
  clients.set(ws, { 
    userId, 
    username, 
    isAuthenticated: true,
    lastHeartbeat: Date.now(),
    socketId
  });
  userSockets.set(userId, ws);
  
  // Update presence in database
  await presenceService.setOnline(userId, socketId);
  
  ws.send(JSON.stringify({ 
    type: "auth_success", 
    payload: { userId, socketId }
  }));
  
  log(`User ${username} (${userId}) authenticated`, "ws");
}

// Heartbeat handler
async function handleHeartbeat(ws: WebSocket, payload: { userId: string }) {
  const client = clients.get(ws);
  
  if (!client || client.userId !== payload.userId) {
    ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
    return;
  }
  
  client.lastHeartbeat = Date.now();
  
  presenceService.updateLastSeen(client.userId).catch((err: unknown) => {
    console.error("Failed to update presence:", err);
  });
  
  if (client.inQueue) {
    dbMatchmakingQueue.updateHeartbeat(client.userId).catch((err: unknown) => {
      console.error("Failed to update matchmaking heartbeat:", err);
    });
  }
  
  ws.send(JSON.stringify({ type: "heartbeat_ack", timestamp: Date.now() }));
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
  
  log(`[StartMatch] Starting match for lobby ${lobbyId}, host=${hostId}`, "ws");
  
  const result = await matchService.startMatch(lobbyId, hostId);
  
  if (!result.matchState) {
    log(`[StartMatch] Failed to start match: ${result.error}`, "ws");
    ws.send(JSON.stringify({ type: "start_match_error", message: result.error || "Failed to start match" }));
    return;
  }
  
  const matchState = result.matchState;
  log(`[StartMatch] Match ${matchState.matchId} created with ${matchState.questions.length} questions`, "ws");
  
  const lobbyClients = lobbyConnections.get(lobbyId);
  const connectedPlayerCount = lobbyClients?.size || 0;
  log(`[StartMatch] Lobby has ${connectedPlayerCount} connected clients`, "ws");
  
  if (lobbyClients) {
    Array.from(lobbyClients).forEach(clientWs => {
      const clientInfo = clients.get(clientWs);
      if (clientInfo) {
        log(`[StartMatch] Moving client ${clientInfo.userId} from lobby to match`, "ws");
        clientInfo.matchId = matchState.matchId;
        clientInfo.lobbyId = undefined;
      }
      
      if (!matchConnections.has(matchState.matchId)) {
        matchConnections.set(matchState.matchId, new Set());
      }
      matchConnections.get(matchState.matchId)?.add(clientWs);
    });
    lobbyConnections.delete(lobbyId);
  }
  
  const matchClientCount = matchConnections.get(matchState.matchId)?.size || 0;
  log(`[StartMatch] Match now has ${matchClientCount} connected clients`, "ws");
  
  const clientMatchState = sanitizeMatchStateForClient(matchState);
  
  log(`[StartMatch] Broadcasting match_started to ${matchClientCount} clients, currentQuestion exists: ${!!clientMatchState.currentQuestion}`, "ws");
  
  broadcastToMatch(matchState.matchId, {
    type: "match_started",
    payload: clientMatchState,
  });
}

async function handleSubmitAnswer(ws: WebSocket, payload: { matchId: string; userId: string; questionIndex: number; selectedAnswer: string; clientMsgId?: string }) {
  const { matchId, questionIndex, selectedAnswer, clientMsgId } = payload;
  const extWs = ws as ExtendedWebSocket;
  
  const client = clients.get(ws);
  
  const serverUserId = client?.userId || extWs.sessionUserId;
  const isAuthenticated = client?.isAuthenticated || !!extWs.sessionUserId;
  
  log(`[SubmitAnswer] payload.userId=${payload.userId}, client.userId=${client?.userId}, sessionUserId=${extWs.sessionUserId}, isAuth=${isAuthenticated}, matchId=${matchId}, client.matchId=${client?.matchId}`, "ws");
  
  if (!serverUserId || !isAuthenticated) {
    log(`[SubmitAnswer] REJECTED missing_session: serverUserId=${serverUserId}, isAuthenticated=${isAuthenticated}`, "ws");
    ws.send(JSON.stringify({ 
      type: "answer_ack", 
      payload: { matchId, idx: questionIndex, clientMsgId, status: "REJECTED", reason: "missing_session" } 
    }));
    return;
  }
  
  if (client?.matchId && client.matchId !== matchId) {
    log(`[SubmitAnswer] REJECTED not_in_match: client.matchId=${client.matchId}, requested matchId=${matchId}`, "ws");
    ws.send(JSON.stringify({ 
      type: "answer_ack", 
      payload: { matchId, idx: questionIndex, clientMsgId, status: "REJECTED", reason: "not_in_match" } 
    }));
    return;
  }
  
  const matchState = await matchService.getMatchStateWithFallback(matchId);
  if (!matchState) {
    log(`[SubmitAnswer] REJECTED match_not_found: matchId=${matchId}`, "ws");
    ws.send(JSON.stringify({ 
      type: "answer_ack", 
      payload: { matchId, idx: questionIndex, clientMsgId, status: "REJECTED", reason: "match_not_found" } 
    }));
    return;
  }
  
  if (!isMatchParticipantByState(matchState, serverUserId)) {
    log(`[SubmitAnswer] REJECTED not_participant: serverUserId=${serverUserId}, participants=${matchState.participants.map(p => p.userId).join(",")}`, "ws");
    ws.send(JSON.stringify({ 
      type: "answer_ack", 
      payload: { matchId, idx: questionIndex, clientMsgId, status: "REJECTED", reason: "not_participant" } 
    }));
    return;
  }
  
  const result = await matchService.submitAnswer(matchId, serverUserId, questionIndex, selectedAnswer, clientMsgId);
  
  ws.send(JSON.stringify({
    type: "answer_ack",
    payload: {
      matchId,
      idx: questionIndex,
      clientMsgId: result.ack.clientMsgId,
      status: result.ack.status,
      reason: result.ack.reason,
    },
  }));
  
  if (result.ack.status === "REJECTED") {
    return;
  }
  
  ws.send(JSON.stringify({
    type: "answer_result",
    payload: {
      correct: result.correct,
      pointsEarned: result.pointsEarned,
      correctAnswer: result.correctAnswer,
    },
  }));
  
  if (result.matchState) {
    broadcastToMatch(matchId, {
      type: "participant_answered",
      payload: {
        userId: serverUserId,
        questionIndex,
        participants: result.matchState.participants.map(p => ({
          userId: p.userId,
          username: p.username,
          score: p.score,
          hasAnsweredCurrent: p.hasAnsweredCurrent,
        })),
      },
    });
  }
  
  if (result.bothAnswered) {
    const { matchState: advancedState, matchEnd } = await matchService.advanceQuestion(matchId);
    if (advancedState) {
      if (matchEnd) {
        for (const participant of matchEnd.participants) {
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
          type: "match_end",
          payload: matchEnd,
        });
      } else {
        const clientMatchState = sanitizeMatchStateForClient(advancedState);
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
  const matchState = await matchService.getMatchStateWithFallback(matchId);
  
  if (matchState) {
    const clientMatchState = sanitizeMatchStateForClient(matchState);
    ws.send(JSON.stringify({
      type: "match_state",
      payload: clientMatchState,
    }));
  }
}

async function handleMatchResync(ws: WebSocket, payload: { matchId: string }) {
  const { matchId } = payload;
  log(`[MatchResync] Resync requested for match ${matchId}`, "ws");
  
  const matchState = await matchService.getMatchStateWithFallback(matchId);
  
  if (!matchState) {
    ws.send(JSON.stringify({ 
      type: "error", 
      message: "Match not found or has ended",
    }));
    return;
  }
  
  if (matchState.status === MatchStatus.FINISHED || matchState.status === MatchStatus.CANCELLED) {
    ws.send(JSON.stringify({
      type: "match_end",
      payload: {
        matchId,
        reason: matchState.endReason || (matchState.status === MatchStatus.FINISHED ? "completed" : "unknown"),
        status: matchState.status,
        winner: matchState.winner,
        participants: matchState.participants.map(p => ({
          userId: p.userId,
          username: p.username,
          score: p.score,
          correctAnswers: p.correctAnswers,
        })),
      },
    }));
    return;
  }
  
  const clientMatchState = sanitizeMatchStateForClient(matchState);
  ws.send(JSON.stringify({
    type: "match_state",
    payload: clientMatchState,
  }));
  
  log(`[MatchResync] Sent resync for match ${matchId}, status=${matchState.status}, questionIndex=${matchState.currentQuestionIndex}`, "ws");
}

async function handleJoinMatch(ws: WebSocket, payload: { matchId: string; userId: string; username: string; membershipSecret?: string }) {
  const { matchId, membershipSecret } = payload;
  const extWs = ws as ExtendedWebSocket;
  
  const sessionUserId = extWs.sessionUserId;
  const sessionUsername = extWs.sessionUsername;
  
  const userId = payload.userId || sessionUserId;
  const username = payload.username || sessionUsername || "Unknown";
  
  log(`[JoinMatch] User ${username} (${userId}) attempting to join match ${matchId}, sessionUserId=${sessionUserId}`, "ws");
  
  if (!userId) {
    log(`[JoinMatch] REJECTED: No userId available (payload or session)`, "ws");
    ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
    return;
  }
  
  const existingClient = clients.get(ws);
  if (existingClient && existingClient.userId && existingClient.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Cannot change user identity mid-session" }));
    return;
  }
  
  const matchState = await matchService.getMatchStateWithFallback(matchId);
  if (!matchState) {
    log(`[JoinMatch] Match ${matchId} not found in memory or database`, "ws");
    ws.send(JSON.stringify({ type: "error", message: "Match not found or has expired" }));
    return;
  }
  
  log(`[JoinMatch] Match ${matchId} found with ${matchState.questions.length} questions, status=${matchState.status}`, "ws");
  
  const lobby = await matchService.getLobby(matchState.lobbyId);
  if (!lobby) {
    ws.send(JSON.stringify({ type: "error", message: "Lobby not found" }));
    return;
  }
  
  const hasValidSecret = membershipSecret && matchService.verifyMembershipSecret(lobby, userId, membershipSecret);
  const hasSessionAuth = sessionUserId === userId && isMatchParticipant(lobby, userId);
  
  if (!hasValidSecret && !hasSessionAuth) {
    log(`[JoinMatch] REJECTED: No valid auth - hasValidSecret=${hasValidSecret}, hasSessionAuth=${hasSessionAuth}, sessionUserId=${sessionUserId}, userId=${userId}, lobbyHostId=${lobby.hostId}, lobbyGuestId=${lobby.guestId}`, "ws");
    ws.send(JSON.stringify({ type: "error", message: "Invalid membership credentials" }));
    return;
  }
  
  if (!isMatchParticipantByState(matchState, userId)) {
    log(`[JoinMatch] REJECTED: not_participant - userId=${userId}, participants=${matchState.participants.map(p => p.userId).join(",")}`, "ws");
    ws.send(JSON.stringify({ type: "error", message: "You are not a participant in this match" }));
    return;
  }
  
  clients.set(ws, { userId, username, matchId, membershipSecret, isAuthenticated: true, sessionUserId });
  
  if (!matchConnections.has(matchId)) {
    matchConnections.set(matchId, new Set());
  }
  matchConnections.get(matchId)?.add(ws);
  
  const clientMatchState = sanitizeMatchStateForClient(matchState);
  
  log(`[JoinMatch] Sending match_started to ${username}, currentQuestion exists: ${!!clientMatchState.currentQuestion}`, "ws");
  
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
  
  if (existingClient && existingClient.isAuthenticated && existingClient.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Cannot change user identity mid-session" }));
    return;
  }
  
  const socketId = existingClient?.socketId || Math.random().toString(36).substring(7);
  
  clients.set(ws, { 
    userId, 
    username, 
    inQueue: true, 
    isAuthenticated: true,
    lastHeartbeat: Date.now(),
    socketId
  });
  userSockets.set(userId, ws);
  
  const result = await dbMatchmakingQueue.joinQueue(userId, username, ws, socketId, totalQuestions, gameSetId);
  
  ws.send(JSON.stringify({
    type: "queue_joined",
    payload: {
      position: result.position,
      ticketId: result.ticketId,
      queueSize: result.queueSize,
    },
  }));
  
  log(`${username} joined matchmaking queue (position: ${result.position}, ticket: ${result.ticketId.slice(0, 8)}...)`, "ws");
}

async function handleLeaveQueue(ws: WebSocket, payload: { userId: string }) {
  const { userId } = payload;
  
  const client = clients.get(ws);
  if (!client || client.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Not authenticated or user mismatch" }));
    return;
  }
  
  client.inQueue = false;
  
  const socketId = client.socketId || Math.random().toString(36).substring(7);
  await presenceService.setOnline(userId, socketId);
  
  const removed = await dbMatchmakingQueue.leaveQueue(userId);
  
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
  
  const { matchEnd } = await matchService.forfeitMatch(matchId, userId);
  
  if (matchEnd) {
    broadcastToMatch(matchId, {
      type: "match_end",
      payload: matchEnd,
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
