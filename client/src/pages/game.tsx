import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { SignupModal } from "@/components/signup-modal";
import { Zap, Check, X, Clock, Trophy, ArrowLeft, RefreshCw, Loader2, Share2, Copy, CheckCircle, Play, Monitor, ShoppingBag } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SiX, SiFacebook } from "react-icons/si";
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

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth < 50 || img.naturalHeight < 50) {
      setImageError(true);
    } else {
      setImageLoaded(true);
    }
  };

  return (
    <div className="relative aspect-[2.5/3.5] w-full max-w-xs mx-auto overflow-hidden rounded-md border-4 border-card-border shadow-lg bg-card">
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {imageError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "linear-gradient(135deg, #d4a574 0%, #c4956a 50%, #b48560 100%)" }}>
          <div className="w-full h-full flex flex-col">
            <div className="h-[18%] bg-gradient-to-b from-slate-800 via-slate-700 to-slate-600/90 flex items-center justify-center border-b-2 border-slate-900">
              <span className="text-xs font-bold text-slate-200 tracking-widest">1987 TOPPS</span>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-4">
                <div className="w-24 h-32 mx-auto mb-3 rounded bg-slate-600/30 flex items-center justify-center">
                  <span className="text-4xl text-slate-700">?</span>
                </div>
                <p className="text-sm font-medium text-slate-700">Mystery Player</p>
              </div>
            </div>
            <div className="h-[20%] bg-gradient-to-t from-amber-800 via-amber-700 to-amber-600/90 flex items-center justify-center border-t-2 border-amber-900">
              <span className="text-sm font-bold text-amber-100 tracking-widest drop-shadow-md">WHO IS THIS PLAYER?</span>
            </div>
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
        onLoad={handleImageLoad}
        onError={() => setImageError(true)}
        referrerPolicy="no-referrer"
      />
      {/* Top mask - covers PSA slab label where player name appears */}
      {!isRevealed && imageLoaded && !imageError && (
        <div 
          className="absolute top-0 left-0 right-0 transition-opacity duration-500"
          style={{ height: "18%" }}
        >
          <div className="w-full h-full bg-gradient-to-b from-slate-800 via-slate-700 to-slate-600/90 flex items-center justify-center border-b-2 border-slate-900">
            <span className="text-xs font-bold text-slate-200 tracking-widest">1987 TOPPS</span>
          </div>
        </div>
      )}
      {/* Bottom mask - covers bottom nameplate area */}
      {!isRevealed && imageLoaded && !imageError && (
        <div 
          className="absolute bottom-0 left-0 right-0 transition-opacity duration-500"
          style={{ height: "20%" }}
        >
          <div className="w-full h-full bg-gradient-to-t from-amber-800 via-amber-700 to-amber-600/90 flex items-center justify-center border-t-2 border-amber-900">
            <span className="text-sm font-bold text-amber-100 tracking-widest drop-shadow-md">WHO IS THIS PLAYER?</span>
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
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [showPointsAnimation, setShowPointsAnimation] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [hasSeenSignupPrompt, setHasSeenSignupPrompt] = useState(false);
  const [pointsUpdatedForSession, setPointsUpdatedForSession] = useState<{ id: string; score: number } | null>(null);
  const [selectedCardCount, setSelectedCardCount] = useState("10");
  const [hasStartedGame, setHasStartedGame] = useState(false);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<GameSession>({
    queryKey: ["/api/game/session", sessionId],
    enabled: !!sessionId,
  });

  const [startError, setStartError] = useState<{ isRateLimit: boolean; message: string } | null>(null);

  const startGameMutation = useMutation({
    mutationFn: async (cardCount: number) => {
      const res = await apiRequest("POST", "/api/game/start", {
        mode: mode || "solo",
        totalQuestions: cardCount,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSessionId(data.id);
      setSelectedAnswer(null);
      setIsRevealed(false);
      setEarnedPoints(0);
      setStartError(null);
      setHasStartedGame(true);
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "";
      const lowerMessage = errorMessage.toLowerCase();
      // apiRequest throws Error with format "status: responseText"
      // Check for rate limit/quota by looking for 429 status or relevant keywords
      const isRateLimit = errorMessage.includes("429") || 
        lowerMessage.includes("rate limit") || 
        lowerMessage.includes("quota") ||
        lowerMessage.includes("limit reached") ||
        lowerMessage.includes("maximum");
      const displayMessage = isRateLimit 
        ? "You've reached your match limit. Please wait before playing again."
        : "Failed to start game. Please try again.";
      // Reset hasStartedGame so user can return to card count selection
      setHasStartedGame(false);
      setStartError({ isRateLimit, message: displayMessage });
      toast({
        title: isRateLimit ? "Match Limit Reached" : "Error",
        description: displayMessage,
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

  // No longer auto-start - user selects card count first

  // Show signup modal after game completion for unauthenticated users with points
  // Only show once per session - track with hasSeenSignupPrompt
  const isGameOver = session?.status === "completed";
  useEffect(() => {
    if (isGameOver && !isAuthenticated && !hasSeenSignupPrompt && session && session.score > 0 && !showSignupModal) {
      const timer = setTimeout(() => setShowSignupModal(true), 500);
      return () => clearTimeout(timer);
    }
  }, [isGameOver, isAuthenticated, hasSeenSignupPrompt, session?.score, showSignupModal]);

  // Update cached user points when game completes to update points display in header
  // Track session ID and score we've added to prevent double-counting
  useEffect(() => {
    if (isGameOver && isAuthenticated && session?.id && session?.score) {
      // Only update if we haven't already added these exact points for this session
      const alreadyUpdated = pointsUpdatedForSession?.id === session.id && pointsUpdatedForSession?.score === session.score;
      if (!alreadyUpdated) {
        // Calculate the delta to add (difference from what we previously added for this session)
        const previouslyAdded = pointsUpdatedForSession?.id === session.id ? pointsUpdatedForSession.score : 0;
        const pointsToAdd = session.score - previouslyAdded;
        
        if (pointsToAdd > 0) {
          setPointsUpdatedForSession({ id: session.id, score: session.score });
          queryClient.setQueryData(["/api/auth/user"], (oldData: any) => {
            if (oldData && typeof oldData.points === "number") {
              return {
                ...oldData,
                points: oldData.points + pointsToAdd,
                gamesPlayed: previouslyAdded === 0 ? (oldData.gamesPlayed || 0) + 1 : oldData.gamesPlayed,
              };
            }
            return oldData;
          });
        }
      }
    }
  }, [isGameOver, isAuthenticated, session?.id, session?.score, pointsUpdatedForSession]);

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
    // Reset to pre-game state to allow card count selection
    setSessionId(null);
    setHasStartedGame(false);
    setStartError(null);
    setPointsUpdatedForSession(null);
  };

  const handleStartGame = () => {
    setHasStartedGame(true);
    startGameMutation.mutate(parseInt(selectedCardCount));
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

  // Show pre-game selection screen for Solo mode
  if (!hasStartedGame && !session) {
    return (
      <div className="min-h-screen pb-20 md:pb-8 pt-8">
        <div className="container mx-auto px-4 max-w-lg">
          <Link href="/">
            <Button variant="ghost" className="mb-4 gap-2" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-2">
                <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
                  <Monitor className="h-8 w-8 text-primary" />
                </div>
                <h1 className="text-2xl font-bold" data-testid="text-solo-title">1v Computer</h1>
                <p className="text-muted-foreground">
                  Test your knowledge of 1987 Topps baseball cards. Earn points for each correct guess!
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="card-count">Number of Cards</Label>
                <Select value={selectedCardCount} onValueChange={setSelectedCardCount}>
                  <SelectTrigger id="card-count" data-testid="select-card-count">
                    <SelectValue placeholder="Select cards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 Cards</SelectItem>
                    <SelectItem value="10">10 Cards</SelectItem>
                    <SelectItem value="15">15 Cards</SelectItem>
                    <SelectItem value="20">20 Cards</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Button 
                className="w-full gap-2" 
                size="lg" 
                onClick={handleStartGame}
                data-testid="button-start-game"
              >
                <Play className="h-5 w-5" />
                Start Game
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!session) {
    const isRateLimited = startError?.isRateLimit === true;
    return (
      <div className="min-h-screen flex items-center justify-center pb-20 md:pb-8">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="p-6 text-center space-y-4">
            {isRateLimited ? (
              <>
                <Clock className="h-12 w-12 text-warning mx-auto" />
                <h2 className="text-xl font-bold">Match Limit Reached</h2>
                <p className="text-muted-foreground">You've reached your hourly match limit. Please wait before playing again.</p>
                <Link href="/">
                  <Button variant="outline" data-testid="button-go-home">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Go Home
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <X className="h-12 w-12 text-destructive mx-auto" />
                <h2 className="text-xl font-bold">Failed to Start Game</h2>
                <p className="text-muted-foreground">Something went wrong. Please try again.</p>
                <Button onClick={() => startGameMutation.mutate(parseInt(selectedCardCount))} data-testid="button-retry-game">
                  Try Again
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQuestion = session.questions[session.currentQuestionIndex];
  const progress = ((session.currentQuestionIndex + (isRevealed ? 1 : 0)) / session.totalQuestions) * 100;

  if (isGameOver) {
    const accuracy = session.totalQuestions > 0 
      ? Math.round((session.correctAnswers / session.totalQuestions) * 100) 
      : 0;

    const shareText = `I scored ${session.score} points on PackPoints! I identified ${session.correctAnswers}/${session.totalQuestions} classic 1987 Topps baseball cards with ${accuracy}% accuracy. Can you beat my score?`;
    const shareUrl = typeof window !== "undefined" ? window.location.origin : "";
    
    const handleShare = async (platform: "twitter" | "facebook" | "native" | "copy") => {
      const encodedText = encodeURIComponent(shareText);
      const encodedUrl = encodeURIComponent(shareUrl);
      
      switch (platform) {
        case "twitter":
          window.open(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, "_blank", "noopener,noreferrer");
          break;
        case "facebook":
          window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`, "_blank", "noopener,noreferrer");
          break;
        case "native":
          if (navigator.share) {
            try {
              await navigator.share({
                title: "PackPoints Score",
                text: shareText,
                url: shareUrl,
              });
            } catch (err) {
              // User cancelled or share failed
            }
          }
          break;
        case "copy":
          try {
            await navigator.clipboard.writeText(`${shareText}\n\n${shareUrl}`);
            toast({
              title: "Copied!",
              description: "Score copied to clipboard",
            });
          } catch (err) {
            toast({
              title: "Error",
              description: "Failed to copy to clipboard",
              variant: "destructive",
            });
          }
          break;
      }
    };

    const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

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
            
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-muted-foreground">Share your score</p>
              <div className="flex items-center justify-center gap-3">
                <Button 
                  size="icon" 
                  variant="outline" 
                  onClick={() => handleShare("twitter")}
                  data-testid="button-share-twitter"
                >
                  <SiX className="h-4 w-4" />
                </Button>
                <Button 
                  size="icon" 
                  variant="outline" 
                  onClick={() => handleShare("facebook")}
                  data-testid="button-share-facebook"
                >
                  <SiFacebook className="h-4 w-4" />
                </Button>
                <Button 
                  size="icon" 
                  variant="outline" 
                  onClick={() => handleShare("copy")}
                  data-testid="button-share-copy"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {canNativeShare && (
                  <Button 
                    size="icon" 
                    variant="outline" 
                    onClick={() => handleShare("native")}
                    data-testid="button-share-native"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            
            <div className="pt-2 border-t">
              <Link href="/marketplace?setId=d98e37f3-a6ae-427e-aac0-8f6e54bae3a5">
                <Button variant="outline" className="w-full gap-2" data-testid="button-browse-cards">
                  <ShoppingBag className="h-4 w-4" />
                  Browse 1987 Topps Cards for Sale
                </Button>
              </Link>
            </div>
            
            {!isAuthenticated && !hasSeenSignupPrompt && session.score > 0 && (
              <div className="pt-2">
                <Button 
                  onClick={() => setShowSignupModal(true)} 
                  variant="secondary" 
                  className="w-full gap-2"
                  data-testid="button-save-points"
                >
                  <Zap className="h-4 w-4" />
                  Save Your {session.score} Points - Create Account
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
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

        <SignupModal 
          open={showSignupModal} 
          onOpenChange={(open) => {
            setShowSignupModal(open);
            if (!open) {
              setHasSeenSignupPrompt(true);
            }
          }}
          pendingPoints={session.score}
          onSuccess={() => {
            setHasSeenSignupPrompt(true);
            toast({
              title: "Account Created!",
              description: `Your ${session.score} points have been saved. Starting a new game!`,
            });
            handlePlayAgain();
          }}
        />
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
