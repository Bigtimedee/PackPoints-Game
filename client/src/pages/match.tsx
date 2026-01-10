import { useState, useEffect, useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, User, Check, X, Loader2, Home, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";

function getUserId(): string {
  return localStorage.getItem("packpoints_user_id") || "";
}

function getUsername(): string {
  return localStorage.getItem("packpoints_username") || "Player";
}

function getAndClearMatchSecret(): string | null {
  const secret = localStorage.getItem("packpoints_match_secret");
  if (secret) {
    localStorage.removeItem("packpoints_match_secret");
  }
  return secret;
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
  status: "waiting" | "active" | "completed";
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
}

export default function Match() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/match/:matchId");
  const matchId = params?.matchId;
  
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answerResult, setAnswerResult] = useState<{ correct: boolean; correctAnswer: string } | null>(null);
  const [imageError, setImageError] = useState(false);
  const { toast } = useToast();
  
  const userId = getUserId();
  
  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case "match_started":
      case "match_state":
      case "next_question":
        setMatchState(message.payload);
        setSelectedAnswer(null);
        setAnswerResult(null);
        setImageError(false);
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
        setMatchState(message.payload);
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
    if (!matchId) return;
    connect();
  }, [matchId, connect]);

  useEffect(() => {
    if (isConnected && matchId) {
      const matchSecret = getAndClearMatchSecret();
      if (matchSecret) {
        send("join_match", { 
          matchId, 
          userId, 
          username: getUsername(), 
          membershipSecret: matchSecret 
        });
      } else {
        send("ready_next", { matchId });
      }
    }
  }, [isConnected, matchId, send, userId]);

  const submitAnswer = (answer: string) => {
    if (selectedAnswer || !matchState || answerResult) return;
    
    setSelectedAnswer(answer);
    send("submit_answer", {
      matchId,
      userId,
      questionIndex: matchState.currentQuestionIndex,
      selectedAnswer: answer,
    });
  };

  const me = matchState?.participants.find((p) => p.userId === userId);
  const opponent = matchState?.participants.find((p) => p.userId !== userId);

  if (!matchState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting to match...</p>
        </div>
      </div>
    );
  }

  if (matchState.status === "completed") {
    const iWon = matchState.winner === me?.username;
    const isDraw = !matchState.winner;
    
    return (
      <div className="min-h-screen pb-20 md:pb-8 pt-8">
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
                  {isDraw ? "Both players finished with the same score" : `${matchState.winner} won the match!`}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                  <p className="text-sm text-muted-foreground">Your Score</p>
                  <p className="text-3xl font-bold font-mono" data-testid="text-my-final-score">{me?.score || 0}</p>
                  <p className="text-sm text-muted-foreground">{me?.correctAnswers}/{matchState.totalQuestions} correct</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 space-y-1">
                  <p className="text-sm text-muted-foreground">Opponent</p>
                  <p className="text-3xl font-bold font-mono" data-testid="text-opponent-final-score">{opponent?.score || 0}</p>
                  <p className="text-sm text-muted-foreground">{opponent?.correctAnswers}/{matchState.totalQuestions} correct</p>
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
    <div className="min-h-screen pb-20 md:pb-8 pt-4">
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
                const isSelected = selectedAnswer === option;
                const isCorrect = answerResult?.correctAnswer === option;
                const showResult = answerResult !== null;
                
                let variant: "default" | "outline" | "destructive" | "secondary" = "outline";
                if (showResult) {
                  if (isCorrect) variant = "default";
                  else if (isSelected && !isCorrect) variant = "destructive";
                }
                
                return (
                  <Button
                    key={option}
                    variant={variant}
                    className={`h-auto py-3 px-4 text-left justify-start ${isSelected ? "ring-2 ring-primary" : ""}`}
                    onClick={() => submitAnswer(option)}
                    disabled={!!selectedAnswer}
                    data-testid={`button-option-${index}`}
                  >
                    <span className="truncate">{option}</span>
                    {showResult && isCorrect && <Check className="h-4 w-4 ml-auto flex-shrink-0" />}
                    {showResult && isSelected && !isCorrect && <X className="h-4 w-4 ml-auto flex-shrink-0" />}
                  </Button>
                );
              })}
            </div>
            
            {answerResult && !opponent?.hasAnsweredCurrent && (
              <div className="text-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Waiting for opponent...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
