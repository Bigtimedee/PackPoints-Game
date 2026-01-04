import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Zap, Check, X, Clock, Trophy, ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import type { GameSession, GameQuestion } from "@shared/schema";

function AnswerButton({
  option,
  isSelected,
  isCorrect,
  isRevealed,
  onSelect,
  disabled,
}: {
  option: string;
  isSelected: boolean;
  isCorrect: boolean;
  isRevealed: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  let variant: "default" | "outline" | "secondary" | "destructive" = "outline";
  let className = "w-full justify-start gap-3 text-left h-auto py-4 px-5 text-base";

  if (isRevealed) {
    if (isCorrect) {
      className += " bg-accent text-accent-foreground border-accent";
    } else if (isSelected) {
      className += " bg-destructive/10 text-destructive border-destructive";
    }
  } else if (isSelected) {
    variant = "default";
  }

  return (
    <Button
      variant={variant}
      className={className}
      onClick={onSelect}
      disabled={disabled || isRevealed}
      data-testid={`button-answer-${option.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className="flex-1">{option}</div>
      {isRevealed && isCorrect && <Check className="h-5 w-5 text-accent-foreground" />}
      {isRevealed && isSelected && !isCorrect && <X className="h-5 w-5" />}
    </Button>
  );
}

function GameCard({ imageUrl, isRevealed }: { imageUrl: string; isRevealed: boolean }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <div className="relative aspect-[2.5/3.5] w-full max-w-xs mx-auto overflow-hidden rounded-md border-4 border-card-border shadow-lg bg-card">
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="text-center text-muted-foreground">
            <div className="text-4xl mb-2">?</div>
            <span className="text-sm">1987 Topps Card</span>
          </div>
        </div>
      )}
      <img
        src={imageUrl}
        alt="Baseball card"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: imageLoaded && !imageError ? 1 : 0,
        }}
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
        referrerPolicy="no-referrer"
      />
      {/* Name plate mask - covers bottom portion where 1987 Topps cards show the player name */}
      {!isRevealed && (
        <div 
          className="absolute bottom-0 left-0 right-0 transition-opacity duration-500"
          style={{ height: "18%" }}
        >
          <div className="w-full h-full bg-gradient-to-t from-primary via-primary to-primary/80 flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground tracking-wide">NAME HIDDEN</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PointsAnimation({ points, show }: { points: number; show: boolean }) {
  if (!show) return null;

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-bounce">
      <div className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-md shadow-lg">
        <Zap className="h-5 w-5" />
        <span className="font-bold font-mono text-xl">+{points}</span>
      </div>
    </div>
  );
}

export default function Game() {
  const { mode } = useParams<{ mode: string }>();
  const { toast } = useToast();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<GameSession>({
    queryKey: ["/api/game/session", sessionId],
    enabled: !!sessionId,
  });

  const startGameMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/game/start", {
        mode: mode || "solo",
        userId: "guest",
        totalQuestions: 10,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSessionId(data.id);
      setSelectedAnswer(null);
      setIsRevealed(false);
      setEarnedPoints(0);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start game. Please try again.",
        variant: "destructive",
      });
    },
  });

  const submitAnswerMutation = useMutation({
    mutationFn: async (answer: string) => {
      const res = await apiRequest("POST", "/api/game/answer", {
        sessionId,
        questionIndex: session?.currentQuestionIndex ?? 0,
        selectedAnswer: answer,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.correct) {
        setEarnedPoints(data.pointsEarned);
        setShowPointsAnimation(true);
        setTimeout(() => setShowPointsAnimation(false), 1500);
      }
      if (data.session) {
        queryClient.setQueryData(["/api/game/session", sessionId], data.session);
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit answer. Please try again.",
        variant: "destructive",
      });
    },
  });

  const nextQuestionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/game/next", { sessionId });
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedAnswer(null);
      setIsRevealed(false);
      if (data) {
        queryClient.setQueryData(["/api/game/session", sessionId], data);
      }
    },
  });

  useEffect(() => {
    if (!sessionId) {
      startGameMutation.mutate();
    }
  }, []);

  const handleSelectAnswer = (answer: string) => {
    if (isRevealed) return;
    setSelectedAnswer(answer);
  };

  const handleSubmit = () => {
    if (!selectedAnswer) return;
    setIsRevealed(true);
    submitAnswerMutation.mutate(selectedAnswer);
  };

  const handleNextQuestion = () => {
    nextQuestionMutation.mutate();
  };

  const handlePlayAgain = () => {
    setSessionId(null);
    startGameMutation.mutate();
  };

  if (startGameMutation.isPending || sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pb-20 md:pb-8">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading game...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center pb-20 md:pb-8">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="p-6 text-center space-y-4">
            <X className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold">Failed to Start Game</h2>
            <p className="text-muted-foreground">Something went wrong. Please try again.</p>
            <Button onClick={() => startGameMutation.mutate()} data-testid="button-retry-game">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQuestion = session.questions[session.currentQuestionIndex];
  const isGameOver = session.status === "completed";
  const progress = ((session.currentQuestionIndex + (isRevealed ? 1 : 0)) / session.totalQuestions) * 100;

  if (isGameOver) {
    const accuracy = session.totalQuestions > 0 
      ? Math.round((session.correctAnswers / session.totalQuestions) * 100) 
      : 0;

    return (
      <div className="min-h-screen flex items-center justify-center pb-20 md:pb-8 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-6">
            <div className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Trophy className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold" data-testid="text-game-over-title">Game Complete!</h2>
              <p className="text-muted-foreground">Here's how well you know your 1987 Topps cards</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-md bg-muted">
                <p className="text-3xl font-bold font-mono text-primary" data-testid="text-final-score">{session.score}</p>
                <p className="text-sm text-muted-foreground">Total Points</p>
              </div>
              <div className="p-4 rounded-md bg-muted">
                <p className="text-3xl font-bold font-mono" data-testid="text-accuracy">{accuracy}%</p>
                <p className="text-sm text-muted-foreground">Accuracy</p>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {session.correctAnswers} of {session.totalQuestions} players identified correctly
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={handlePlayAgain} className="gap-2" data-testid="button-play-again">
                <RefreshCw className="h-4 w-4" />
                Play Again
              </Button>
              <Link href="/">
                <Button variant="outline" className="w-full gap-2" data-testid="button-back-home">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="flex items-center justify-between gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1.5 font-mono" data-testid="badge-question-count">
              <Clock className="h-3 w-3" />
              {session.currentQuestionIndex + 1} / {session.totalQuestions}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 font-mono" data-testid="badge-score">
              <Zap className="h-3 w-3" />
              {session.score} pts
            </Badge>
          </div>
        </div>

        <Progress value={progress} className="h-2 mb-8" data-testid="progress-game" />

        <div className="space-y-8">
          <div className="relative">
            <GameCard 
              imageUrl={currentQuestion.card.imageUrl} 
              isRevealed={isRevealed} 
            />
            <PointsAnimation points={earnedPoints} show={showPointsAnimation} />
          </div>

          {currentQuestion && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm text-muted-foreground">Who is on this 1987 Topps card?</p>
                <Badge variant="outline" className="font-mono" data-testid="badge-point-value">
                  Worth {currentQuestion.pointValue} pts
                </Badge>
              </div>

              <div className="space-y-3">
                {currentQuestion.options.map((option) => (
                  <AnswerButton
                    key={option}
                    option={option}
                    isSelected={selectedAnswer === option}
                    isCorrect={option === currentQuestion.correctAnswer}
                    isRevealed={isRevealed}
                    onSelect={() => handleSelectAnswer(option)}
                    disabled={submitAnswerMutation.isPending}
                  />
                ))}
              </div>

              <div className="pt-4">
                {!isRevealed ? (
                  <Button
                    onClick={handleSubmit}
                    disabled={!selectedAnswer || submitAnswerMutation.isPending}
                    className="w-full gap-2"
                    size="lg"
                    data-testid="button-submit-answer"
                  >
                    {submitAnswerMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Submit Answer
                  </Button>
                ) : (
                  <Button
                    onClick={handleNextQuestion}
                    disabled={nextQuestionMutation.isPending}
                    className="w-full gap-2"
                    size="lg"
                    data-testid="button-next-question"
                  >
                    {nextQuestionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Next Question"
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
