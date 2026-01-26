import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, User, Check, X, Loader2, Home, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAuth } from "@/hooks/use-auth";

function getMatchSecret(): string | null {
  return localStorage.getItem("packpoints_match_secret");
}

function clearMatchSecret(): void {
  localStorage.removeItem("packpoints_match_secret");
}

interface Participant {
  userId: string;
  username: string;
  score: number;
  correctAnswers: number;
  hasAnsweredCurrent: boolean;
}

interface MatchState {
  matchId: string;
  lobbyId: string;
  status: "LOBBY" | "INITIALIZING" | "ACTIVE" | "FINISHED" | "CANCELLED";
  currentQuestionIndex: number;
  totalQuestions: number;
  currentQuestion: {
    card: {
      id: string;
      imageUrl: string;
      team: string;
      year: number;
      setName: string;
      cardNumber: string;
    };
    options: string[];
    pointValue: number;
  } | null;
  participants: Participant[];
  winner?: string;
  endReason?: string;
}

interface MatchEndEvent {
  matchId: string;
  reason: string;
  status: "FINISHED" | "CANCELLED";
  winner?: string;
  winnerUserId?: string;
  result?: "PENDING" | "HOST_WIN" | "GUEST_WIN" | "TIE";
  hostCorrect?: number;
  guestCorrect?: number;
  participants: {
    userId: string;
    username: string;
    score: number;
    correctAnswers: number;
  }[];
}

export default function Match() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/match/:matchId");
  const matchId = params?.matchId;
  const { user, isLoading: authLoading } = useAuth();
  
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedIn, setLockedIn] = useState(false);
  const [answerResult, setAnswerResult] = useState<{ correct: boolean; correctAnswer: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingClientMsgId, setPendingClientMsgId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [matchEnded, setMatchEnded] = useState<MatchEndEvent | null>(null);
  const { toast } = useToast();
  
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const submittingRef = useRef(false);
  const lockedInRef = useRef(false);
  const pendingClientMsgIdRef = useRef<string | null>(null);
  const hasJoinedMatchRef = useRef(false);
  
  const userId = user?.id || "";
  const username = user?.username || user?.firstName || "Player";
  
  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case "match_started":
      case "match_state":
      case "next_question":
        setMatchState(message.payload);
        setSelectedChoice(null);
        setSubmitting(false);
        submittingRef.current = false;
        setLockedIn(false);
        lockedInRef.current = false;
        setAnswerResult(null);
        setSubmitError(null);
        setPendingClientMsgId(null);
        pendingClientMsgIdRef.current = null;
        setImageError(false);
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
        break;
      case "answer_ack":
        if (message.payload.clientMsgId === pendingClientMsgIdRef.current) {
          if (fallbackTimeoutRef.current) {
            clearTimeout(fallbackTimeoutRef.current);
            fallbackTimeoutRef.current = null;
          }
          
          if (message.payload.status === "ACCEPTED") {
            setLockedIn(true);
            lockedInRef.current = true;
            setSubmitting(false);
            submittingRef.current = false;
            setSubmitError(null);
            setPendingClientMsgId(null);
            pendingClientMsgIdRef.current = null;
          } else {
            setSubmitting(false);
            submittingRef.current = false;
            setLockedIn(false);
            lockedInRef.current = false;
            setPendingClientMsgId(null);
            pendingClientMsgIdRef.current = null;
            
            const { reason, serverStatus } = message.payload;
            
            if (reason === "match_cancelled" || reason === "match_finished" || 
                serverStatus === "CANCELLED" || serverStatus === "FINISHED") {
              setSubmitError("Match has ended");
              return;
            }
            
            if (reason === "stale_index" || reason === "match_initializing" || reason === "match_not_started") {
              setSubmitError("Out of sync. Tap Resync.");
              return;
            }
            
            const errorMessages: Record<string, string> = {
              match_not_found: "Match not found",
              not_participant: "You are not a participant in this match",
              unauthorized: "Session expired. Please refresh the page.",
              missing_session: "Session expired. Please refresh and try again.",
              not_in_match: "You are not in this match",
              bad_payload: "Invalid submission. Please try again.",
            };
            setSubmitError(errorMessages[reason] || reason || "Failed to submit");
          }
        }
        break;
      case "answer_result":
        setAnswerResult(message.payload);
        break;
      case "participant_answered":
        setMatchState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: message.payload.participants,
          };
        });
        break;
      case "match_completed":
      case "match_end":
        setMatchEnded(message.payload);
        setMatchState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: message.payload.status,
            winner: message.payload.winner,
            endReason: message.payload.reason,
            participants: message.payload.participants.map((p: any) => ({
              ...prev.participants.find((pp) => pp.userId === p.userId) || {},
              ...p,
            })),
          };
        });
        break;
      case "participant_disconnected":
        toast({ 
          title: "Opponent Disconnected", 
          description: `${message.payload.username} has left the match.`,
          variant: "destructive" 
        });
        break;
      case "error":
        toast({ title: "Error", description: message.message, variant: "destructive" });
        break;
    }
  }, [toast]);
  
  const { isConnected, connect, send, on } = useWebSocket({ onMessage: handleMessage });

  useEffect(() => {
    if (!matchId || !userId || authLoading) return;
    connect();
  }, [matchId, userId, authLoading, connect]);

  useEffect(() => {
    if (isConnected && matchId && userId && !hasJoinedMatchRef.current) {
      const matchSecret = getMatchSecret();
      console.log("[Match] Attempting join_match:", { matchId, userId, hasSecret: !!matchSecret });
      if (matchSecret) {
        hasJoinedMatchRef.current = true;
        clearMatchSecret();
        console.log("[Match] Sending join_match with membershipSecret");
        send("join_match", { 
          matchId, 
          userId, 
          username, 
          membershipSecret: matchSecret 
        });
      } else {
        console.log("[Match] No secret, sending ready_next");
        send("ready_next", { matchId });
      }
    }
  }, [isConnected, matchId, send, userId, username]);

  useEffect(() => {
    if (!isConnected || !matchId || matchEnded) return;
    
    if (matchState && !matchState.currentQuestion && matchState.status === "ACTIVE") {
      const resyncTimeout = setTimeout(() => {
        send("match_resync", { matchId });
      }, 5000);
      
      return () => clearTimeout(resyncTimeout);
    }
  }, [isConnected, matchId, matchState, matchEnded, send]);

  const handleSelectChoice = (choice: string) => {
    if (lockedIn || submitting || answerResult) return;
    setSelectedChoice(choice);
    setSubmitError(null);
  };

  const submitAnswer = async () => {
    if (!selectedChoice || !matchState || lockedInRef.current || submittingRef.current || pendingClientMsgIdRef.current) return;
    
    setSubmitting(true);
    submittingRef.current = true;
    setSubmitError(null);
    
    const clientMsgId = crypto.randomUUID();
    setPendingClientMsgId(clientMsgId);
    pendingClientMsgIdRef.current = clientMsgId;
    
    const currentIdx = matchState.currentQuestionIndex;
    const currentChoice = selectedChoice;
    
    try {
      send("submit_answer", {
        matchId,
        userId,
        questionIndex: currentIdx,
        selectedAnswer: currentChoice,
        clientMsgId,
      });
      
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }
      
      fallbackTimeoutRef.current = setTimeout(async () => {
        if (submittingRef.current && !lockedInRef.current) {
          try {
            const response = await fetch(`/api/matches/${matchId}/answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                idx: currentIdx,
                selected: currentChoice,
                clientMsgId,
              }),
            });
            const data = await response.json();
            if (data.ok) {
              setLockedIn(true);
              lockedInRef.current = true;
              setSubmitting(false);
              submittingRef.current = false;
              setPendingClientMsgId(null);
              pendingClientMsgIdRef.current = null;
              setAnswerResult({ correct: data.correct, correctAnswer: data.correctAnswer });
            } else {
              setSubmitError(data.reason || "Failed to submit");
              setSubmitting(false);
              submittingRef.current = false;
              setPendingClientMsgId(null);
              pendingClientMsgIdRef.current = null;
            }
          } catch (error) {
            setSubmitError("Network error, please try again");
            setSubmitting(false);
            submittingRef.current = false;
            setPendingClientMsgId(null);
            pendingClientMsgIdRef.current = null;
          }
        }
        fallbackTimeoutRef.current = null;
      }, 3000);
      
    } catch (error) {
      setSubmitError("Failed to send answer");
      setSubmitting(false);
      submittingRef.current = false;
      setPendingClientMsgId(null);
      pendingClientMsgIdRef.current = null;
    }
  };

  const me = matchState?.participants.find((p) => p.userId === userId);
  const opponent = matchState?.participants.find((p) => p.userId !== userId);

  if (!matchState) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting to match...</p>
        </div>
      </div>
    );
  }

  if (matchEnded && matchEnded.status === "CANCELLED") {
    const cancelReasonText: Record<string, string> = {
      no_ack: "A player failed to acknowledge the match",
      deck_empty: "Not enough cards available for this match",
      timeout: "Match timed out",
      forfeit: "A player forfeited the match",
      disconnect: "A player disconnected",
    };
    
    return (
      <div className="min-h-[100dvh] pb-20 md:pb-8 pt-8">
        <div className="container mx-auto px-4 max-w-lg">
          <Card>
            <CardContent className="p-8 text-center space-y-6">
              <div className="mx-auto p-4 rounded-full w-fit bg-destructive/20">
                <X className="h-12 w-12 text-destructive" />
              </div>
              
              <div>
                <h1 className="text-3xl font-bold mb-2" data-testid="text-match-result">
                  Match Cancelled
                </h1>
                <p className="text-muted-foreground">
                  {cancelReasonText[matchEnded.reason] || matchEnded.reason}
                </p>
              </div>
              
              <div className="flex flex-col gap-3">
                <Button onClick={() => navigate("/lobby")} className="gap-2" data-testid="button-return-lobby">
                  <RotateCcw className="h-4 w-4" />
                  Return to Lobby
                </Button>
                <Button variant="outline" onClick={() => navigate("/")} className="gap-2" data-testid="button-home">
                  <Home className="h-4 w-4" />
                  Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (matchEnded && matchEnded.status === "FINISHED") {
    const meResult = matchEnded.participants.find((p) => p.userId === userId);
    const opponentResult = matchEnded.participants.find((p) => p.userId !== userId);
    const iWon = matchEnded.winnerUserId === userId;
    const isDraw = matchEnded.result === "TIE" || (!matchEnded.winnerUserId && !matchEnded.winner);
    
    return (
      <div className="min-h-[100dvh] pb-20 md:pb-8 pt-8">
        <div className="container mx-auto px-4 max-w-lg">
          <Card>
            <CardContent className="p-8 text-center space-y-6">
              <div className={`mx-auto p-4 rounded-full w-fit ${iWon ? "bg-yellow-500/20" : isDraw ? "bg-muted" : "bg-muted"}`}>
                <Trophy className={`h-12 w-12 ${iWon ? "text-yellow-500" : "text-muted-foreground"}`} />
              </div>
              
              <div>
                <h1 className="text-3xl font-bold mb-2" data-testid="text-match-result">
                  {iWon ? "You Win!" : isDraw ? "It's a Draw!" : "You Lose"}
                </h1>
                <p className="text-muted-foreground">
                  {isDraw ? "Both players got the same number correct" : `${matchEnded.winner} got more correct!`}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                  <p className="text-sm text-muted-foreground">Your Score</p>
                  <p className="text-3xl font-bold font-mono" data-testid="text-my-final-score">{meResult?.score || 0}</p>
                  <p className="text-sm text-muted-foreground">{meResult?.correctAnswers}/{matchState.totalQuestions} correct</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                  <p className="text-sm text-muted-foreground">Opponent</p>
                  <p className="text-3xl font-bold font-mono" data-testid="text-opponent-final-score">{opponentResult?.score || 0}</p>
                  <p className="text-sm text-muted-foreground">{opponentResult?.correctAnswers}/{matchState.totalQuestions} correct</p>
                </div>
              </div>
              
              <div className="flex flex-col gap-3">
                <Button onClick={() => navigate("/lobby")} className="gap-2" data-testid="button-play-again">
                  <RotateCcw className="h-4 w-4" />
                  Play Again
                </Button>
                <Button variant="outline" onClick={() => navigate("/")} className="gap-2" data-testid="button-home">
                  <Home className="h-4 w-4" />
                  Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const currentQuestion = matchState.currentQuestion;
  const progress = ((matchState.currentQuestionIndex + 1) / matchState.totalQuestions) * 100;

  return (
    <div className="min-h-[100dvh] pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>
      <div className="container mx-auto px-4 max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium" data-testid="text-my-username">{me?.username}</p>
              <p className="text-lg font-bold font-mono" data-testid="text-my-score">{me?.score}</p>
            </div>
            {me?.hasAnsweredCurrent && (
              <Badge variant="secondary" className="ml-2">
                <Check className="h-3 w-3 mr-1" />
                Answered
              </Badge>
            )}
          </div>
          
          <div className="text-center">
            <Badge variant="outline">
              {matchState.currentQuestionIndex + 1} / {matchState.totalQuestions}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            {opponent?.hasAnsweredCurrent && (
              <Badge variant="secondary" className="mr-2">
                <Check className="h-3 w-3 mr-1" />
                Answered
              </Badge>
            )}
            <div className="text-right">
              <p className="text-sm font-medium" data-testid="text-opponent-username">{opponent?.username}</p>
              <p className="text-lg font-bold font-mono" data-testid="text-opponent-score">{opponent?.score}</p>
            </div>
            <div className="h-8 w-8 rounded-full bg-secondary/20 flex items-center justify-center">
              <User className="h-4 w-4" />
            </div>
          </div>
        </div>
        
        <Progress value={progress} className="mb-4" />
        
        {currentQuestion && (
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <div className="relative aspect-[3/4] bg-muted">
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 z-10" />
                {!imageError ? (
                  <img
                    src={currentQuestion.card.imageUrl}
                    alt="Baseball card"
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                    data-testid="img-card"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-100 to-amber-200">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-800">1987 TOPPS</p>
                      <p className="text-lg text-amber-700">#{currentQuestion.card.cardNumber}</p>
                      <p className="text-sm text-amber-600 mt-2">{currentQuestion.card.team}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
            
            <div className="flex items-center justify-between">
              <Badge variant="outline">{currentQuestion.card.team}</Badge>
              <Badge>{currentQuestion.pointValue} pts</Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedChoice === option;
                const isCorrect = answerResult?.correctAnswer === option;
                const showResult = answerResult !== null;
                
                let variant: "default" | "outline" | "destructive" | "secondary" = "outline";
                if (showResult) {
                  if (isCorrect) variant = "default";
                  else if (isSelected && !isCorrect) variant = "destructive";
                } else if (isSelected) {
                  variant = "secondary";
                }
                
                return (
                  <Button
                    key={option}
                    variant={variant}
                    className={`h-auto py-3 px-4 text-left justify-start ${isSelected && !showResult ? "ring-2 ring-primary" : ""}`}
                    onClick={() => handleSelectChoice(option)}
                    disabled={lockedIn || submitting || showResult}
                    data-testid={`button-option-${index}`}
                  >
                    <span className="truncate">{option}</span>
                    {showResult && isCorrect && <Check className="h-4 w-4 ml-auto flex-shrink-0" />}
                    {showResult && isSelected && !isCorrect && <X className="h-4 w-4 ml-auto flex-shrink-0" />}
                  </Button>
                );
              })}
            </div>
            
          </div>
        )}
      </div>
      
      {currentQuestion && (
        <div className="fixed left-0 right-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="mx-auto max-w-lg px-4 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
            {!answerResult && !lockedIn && (
              <Button
                onClick={submitAnswer}
                disabled={!selectedChoice || submitting}
                size="lg"
                className="w-full"
                data-testid="button-submit-answer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Submitting...
                  </>
                ) : (
                  "Submit Answer"
                )}
              </Button>
            )}
            {lockedIn && !answerResult && (
              <div className="text-center text-muted-foreground py-2">
                <Check className="h-4 w-4 inline mr-2 text-green-500" />
                Answer locked in! Waiting for result...
              </div>
            )}
            {answerResult && !opponent?.hasAnsweredCurrent && (
              <div className="text-center text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Waiting for opponent...
              </div>
            )}
            {answerResult && opponent?.hasAnsweredCurrent && (
              <div className="text-center text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Loading next question...
              </div>
            )}
            {submitError && (
              <div className="mt-2 text-center text-destructive text-sm">
                {submitError}
              </div>
            )}
            {submitError && (
              <Button
                variant="outline"
                onClick={() => {
                  setSubmitError(null);
                  send("match_resync", { matchId });
                }}
                className="w-full mt-2"
                data-testid="button-resync"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Resync
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
