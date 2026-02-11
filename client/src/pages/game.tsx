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
import { Zap, Check, X, Clock, Trophy, ArrowLeft, RefreshCw, Loader2, Share2, Copy, CheckCircle, Play, Monitor, ShoppingBag, Flag, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CardSetPicker } from "@/components/CardSetPicker";
import { MobileSelect } from "@/components/MobileSelect";
import { SiX, SiFacebook } from "react-icons/si";
import type { GameSession, GameQuestion, GameSet, PlayableSet } from "@shared/schema";
import { GameCard } from "@/components/GameCard";
import { DAILY_PROGRESS_QUERY_KEY } from "@/hooks/use-daily-progress";

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


interface RewardDetails {
  basePts: number;
  finalPts: number;
  fameScore: number;
  vintageMultiplier: number;
  rarityMultiplier: number;
  capped: boolean;
  cappedReason?: string;
}

function PointsAnimation({ points, show, reward }: { points: number; show: boolean; reward?: RewardDetails | null }) {
  if (!show) return null;

  const getFameLabel = (score: number) => {
    if (score <= 0.2) return "Obscure";
    if (score <= 0.5) return "Lesser Known";
    if (score <= 0.8) return "Well Known";
    return "Famous";
  };

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
      <div className="flex flex-col items-center gap-2 animate-bounce">
        <div className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-md shadow-lg">
          <Zap className="h-5 w-5" />
          <span className="font-bold font-mono text-xl" data-testid="text-points-earned">+{points}</span>
        </div>
        {reward && (
          <div className="bg-card/95 backdrop-blur text-card-foreground px-3 py-2 rounded-md shadow-lg text-xs space-y-1 animate-fade-in" data-testid="reward-breakdown">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Player:</span>
              <span className="font-medium">{getFameLabel(reward.fameScore)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Base:</span>
              <span className="font-mono">{reward.basePts} pts</span>
            </div>
            {reward.vintageMultiplier !== 1.0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Vintage:</span>
                <span className="font-mono text-green-500">x{reward.vintageMultiplier.toFixed(2)}</span>
              </div>
            )}
            {reward.rarityMultiplier !== 1.0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Rarity:</span>
                <span className="font-mono text-blue-500">x{reward.rarityMultiplier.toFixed(2)}</span>
              </div>
            )}
            {reward.capped && (
              <div className="text-amber-500 text-center pt-1 border-t border-border">
                {reward.cappedReason?.includes("daily") ? "Daily cap reached" : "Match cap reached"}
              </div>
            )}
          </div>
        )}
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
  const [rewardDetails, setRewardDetails] = useState<{
    basePts: number;
    finalPts: number;
    fameScore: number;
    vintageMultiplier: number;
    rarityMultiplier: number;
    capped: boolean;
    cappedReason?: string;
  } | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [hasSeenSignupPrompt, setHasSeenSignupPrompt] = useState(false);
  const [pointsUpdatedForSession, setPointsUpdatedForSession] = useState<{ id: string; score: number } | null>(null);
  const [selectedCardCount, setSelectedCardCount] = useState("10");
  const [hasStartedGame, setHasStartedGame] = useState(false);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<GameSession>({
    queryKey: ["/api/game/session", sessionId],
    enabled: !!sessionId,
  });
  
  const { data: playableSets, isLoading: setsLoading, error: setsError, refetch: refetchSets } = useQuery<PlayableSet[]>({
    queryKey: ["/api/playable-sets"],
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
  
  // Filter to only show sets with imported cards
  const availableSets = playableSets?.filter(s => s.cardsImportedCount > 0) || [];
  
  const currentGameSet = availableSets.find(s => s.id === selectedSetId) || availableSets[0];
  
  useEffect(() => {
    if (availableSets.length && !selectedSetId) {
      setSelectedSetId(availableSets[0].id);
    }
  }, [availableSets, selectedSetId]);

  const [startError, setStartError] = useState<{ isRateLimit: boolean; message: string } | null>(null);

  const startGameMutation = useMutation({
    mutationFn: async (cardCount: number) => {
      const res = await apiRequest("POST", "/api/game/start", {
        mode: mode || "solo",
        totalQuestions: cardCount,
        setId: selectedSetId || currentGameSet?.id,
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
      // Reset replacement tracking for new session
      setFailedCardIds([]);
      setReplacedQuestionIndices(new Set());
      setReplacementAttempts(new Map());
      setShowSkipButton(false);
      setReplacementStartTime(null);
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
      
      // Check for no cards available error
      const isNoCards = errorMessage.includes("503") || 
        lowerMessage.includes("no cards available") ||
        lowerMessage.includes("no_cards_available");
      
      let displayMessage: string;
      let toastTitle: string;
      
      if (isNoCards) {
        displayMessage = "This card set has no cards available. Please try a different set.";
        toastTitle = "No Cards Available";
      } else if (isRateLimit) {
        displayMessage = "You've reached your match limit. Please wait before playing again.";
        toastTitle = "Match Limit Reached";
      } else {
        displayMessage = "Failed to start game. Please try again.";
        toastTitle = "Error";
      }
      
      // Reset hasStartedGame so user can return to card count selection
      setHasStartedGame(false);
      setStartError({ isRateLimit: isRateLimit || isNoCards, message: displayMessage });
      toast({
        title: toastTitle,
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
        setRewardDetails(data.reward || null);
        setShowPointsAnimation(true);
        setTimeout(() => setShowPointsAnimation(false), 2000);
        
        // Show toast when daily cap is reached
        if (data.reward?.capped && data.reward?.cappedReason?.includes("daily_cap_reached")) {
          toast({
            title: "Daily Limit Reached",
            description: "You've earned the maximum PackPTS for today. Keep playing for practice - your limit resets at midnight!",
          });
        } else if (data.reward?.capped && data.reward?.cappedReason?.includes("daily_cap_partial")) {
          toast({
            title: "Approaching Daily Limit",
            description: "You're close to your daily PackPTS limit. Points may be reduced.",
          });
        }
      } else {
        setRewardDetails(null);
      }
      if (data.session) {
        queryClient.setQueryData(["/api/game/session", sessionId], data.session);
      }
      // Invalidate daily progress to update the header badge
      queryClient.invalidateQueries({ queryKey: DAILY_PROGRESS_QUERY_KEY });
    },
    onError: (error: Error) => {
      const isSessionExpired = error.message?.includes("404") || error.message?.includes("Session not found");
      if (isSessionExpired) {
        toast({
          title: "Session Expired",
          description: "Your game session has ended. Starting a new game...",
          variant: "destructive",
        });
        setHasStartedGame(false);
        setSessionId(null);
        return;
      }
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
    onError: (error: Error) => {
      const isSessionExpired = error.message?.includes("404") || error.message?.includes("Session not found");
      if (isSessionExpired) {
        toast({
          title: "Session Expired",
          description: "Your game session has ended. Starting a new game...",
          variant: "destructive",
        });
        setHasStartedGame(false);
        setSessionId(null);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to load next question. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Card image report state and mutation
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("wrong_sport");
  const [reportedCardIds, setReportedCardIds] = useState<Set<string>>(new Set());

  const reportCardMutation = useMutation({
    mutationFn: async ({ cardId, reason }: { cardId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/cards/${cardId}/report`, {
        reason,
        sessionId,
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      setReportedCardIds(prev => new Set(prev).add(variables.cardId));
      setReportDialogOpen(false);
      toast({
        title: "Report Submitted",
        description: "Thanks for helping us improve card quality!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit report. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Report image load failures (for auto-flagging)
  const reportImageFailureMutation = useMutation({
    mutationFn: async (cardId: string) => {
      const res = await apiRequest("POST", `/api/cards/${cardId}/image-failure`, {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.autoFlagged) {
        console.log(`[Game] Card auto-flagged after ${data.failureCount} failures`);
      }
    },
  });

  // Track failed card IDs this session to exclude from replacements
  const [failedCardIds, setFailedCardIds] = useState<string[]>([]);
  
  // Track question indices that have already had a replacement attempted
  // This prevents auto-skipping when replacement card's image also fails
  const [replacedQuestionIndices, setReplacedQuestionIndices] = useState<Set<number>>(new Set());
  
  // Track replacement attempt counts per question index
  // After 2+ failed attempts, allow user to truly skip to next question
  const [replacementAttempts, setReplacementAttempts] = useState<Map<number, number>>(new Map());
  
  // Track when to show skip button (after timeout or replacement failure)
  const [showSkipButton, setShowSkipButton] = useState(false);

  // Replace card when image fails to load - user doesn't lose PackPTS opportunity
  const replaceCardMutation = useMutation({
    mutationFn: async (failedCardId: string) => {
      const res = await apiRequest("POST", `/api/game/session/${sessionId}/replace-card`, {
        failedCardId,
        excludeCardIds: failedCardIds
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && data.question) {
        // Update the session with the replacement question
        queryClient.setQueryData(["/api/game/session", sessionId], (oldData: any) => {
          if (!oldData) return oldData;
          const newQuestions = [...oldData.questions];
          newQuestions[oldData.currentQuestionIndex] = data.question;
          // Mark this question index as having been replaced
          setReplacedQuestionIndices(prev => new Set(prev).add(oldData.currentQuestionIndex));
          return { ...oldData, questions: newQuestions };
        });
        console.log(`[Game] Card replaced successfully with ${data.question.card.id}`);
      }
    },
    onError: (error) => {
      console.log(`[Game] Card replacement failed:`, error);
      // Mark this question as having had a replacement attempt
      if (session) {
        const currentIdx = session.currentQuestionIndex;
        setReplacedQuestionIndices(prev => new Set(prev).add(currentIdx));
        // Increment the attempt counter for this question
        setReplacementAttempts(prev => {
          const newMap = new Map(prev);
          newMap.set(currentIdx, (newMap.get(currentIdx) || 0) + 1);
          return newMap;
        });
      }
      // Show the skip button again so user can try again or skip entirely
      setShowSkipButton(true);
    }
  });

  // Track if we're in a replacement loading state (image failed and replacement is being attempted)
  const [replacementStartTime, setReplacementStartTime] = useState<number | null>(null);
  
  // Track when replacement starts
  useEffect(() => {
    if (replaceCardMutation.isPending && !replacementStartTime) {
      setReplacementStartTime(Date.now());
    } else if (!replaceCardMutation.isPending) {
      setReplacementStartTime(null);
    }
  }, [replaceCardMutation.isPending, replacementStartTime]);
  
  // Show skip button after timeout OR when replacement has already been attempted
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    const currentIndex = session?.currentQuestionIndex ?? -1;
    
    // If we've already attempted a replacement for this question, show skip immediately
    if (replacedQuestionIndices.has(currentIndex)) {
      setShowSkipButton(true);
      return;
    }
    
    // If replacement is pending, start a 5-second timeout
    if (replaceCardMutation.isPending) {
      setShowSkipButton(false);
      timeoutId = setTimeout(() => {
        setShowSkipButton(true);
      }, 5000);
    } else if (failedCardIds.length > 0 && !replaceCardMutation.isPending) {
      // Card failed but replacement isn't pending - this means replacement failed or wasn't possible
      // Show skip button after a short delay to avoid flash
      timeoutId = setTimeout(() => {
        setShowSkipButton(true);
      }, 2000);
    } else {
      setShowSkipButton(false);
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [replaceCardMutation.isPending, session?.currentQuestionIndex, replacedQuestionIndices, failedCardIds.length]);
  
  // Handle manual skip when user clicks "Try Different Card" button
  // This requests a replacement card from Card Hedge API, NOT advancing to next question
  // The user stays on the same question index but gets a different card to identify
  // After 2+ failed attempts, truly skip to next question as a last resort
  const handleManualSkip = () => {
    if (!showSkipButton) return;
    
    const currentIdx = session?.currentQuestionIndex ?? -1;
    const attempts = replacementAttempts.get(currentIdx) || 0;
    
    // If we've failed 2+ times to get a replacement, allow true skip to next question
    if (attempts >= 2 && !nextQuestionMutation.isPending) {
      console.log(`[Game] Multiple replacement failures, skipping to next question`);
      nextQuestionMutation.mutate();
      return;
    }
    
    // Otherwise try to get a replacement card
    if (!replaceCardMutation.isPending) {
      const currentCardId = currentQuestion?.card?.playableCardId || currentQuestion?.card?.id;
      if (currentCardId) {
        // Reset the skip button state while we try to get a replacement
        setShowSkipButton(false);
        replaceCardMutation.mutate(currentCardId);
      }
    }
  };

  // Handle image error - try to replace card first, only skip if replacement unavailable
  const handleCardImageError = (failedCardId: string) => {
    // Track this failed card to exclude from future replacements
    setFailedCardIds(prev => [...prev, failedCardId]);
    
    const currentIndex = session?.currentQuestionIndex ?? -1;
    
    // Check if we've already attempted a replacement for this question
    // If so, increment the attempt counter (image failed after replacement succeeded)
    // and show skip button rather than trying again automatically
    if (replacedQuestionIndices.has(currentIndex)) {
      console.log(`[Game] Replacement card image also failed at question ${currentIndex + 1}, incrementing attempts`);
      // Count this as another failed attempt toward the skip threshold
      setReplacementAttempts(prev => {
        const newMap = new Map(prev);
        newMap.set(currentIndex, (newMap.get(currentIndex) || 0) + 1);
        return newMap;
      });
      setShowSkipButton(true);
      return;
    }
    
    // Try to get a replacement card
    if (!isRevealed && !replaceCardMutation.isPending) {
      replaceCardMutation.mutate(failedCardId);
    }
  };

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

  // Refresh daily progress tracker when game completes (regardless of score)
  useEffect(() => {
    if (isGameOver && isAuthenticated) {
      queryClient.invalidateQueries({ queryKey: DAILY_PROGRESS_QUERY_KEY });
    }
  }, [isGameOver, isAuthenticated]);

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
    // Reset replacement tracking for new game
    setFailedCardIds([]);
    setReplacedQuestionIndices(new Set());
    setReplacementAttempts(new Map());
    setShowSkipButton(false);
    setReplacementStartTime(null);
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

  const getSetDisplayName = (set: PlayableSet | undefined) => {
    if (!set) return "Card Set";
    return `${set.year} ${set.brand} ${set.sport}`;
  };

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
                  Test your knowledge of {currentGameSet ? getSetDisplayName(currentGameSet) : "classic"} cards. Earn points for each correct guess!
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="card-set">Card Set</Label>
                {setsError ? (
                  <div className="flex items-center gap-2 min-h-9 w-full rounded-md border border-destructive bg-background text-sm px-3">
                    <span className="text-destructive text-sm">Failed to load sets</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => refetchSets()}
                      className="ml-auto"
                      data-testid="button-retry-sets"
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Retry
                    </Button>
                  </div>
                ) : (
                  <CardSetPicker
                    sets={availableSets}
                    value={selectedSetId || ""}
                    onValueChange={setSelectedSetId}
                    placeholder="Select a card set"
                    id="card-set"
                    data-testid="select-card-set"
                    isLoading={setsLoading}
                  />
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="card-count">Number of Cards</Label>
                <MobileSelect
                  options={[
                    { value: "5", label: "5 Cards" },
                    { value: "10", label: "10 Cards" },
                    { value: "15", label: "15 Cards" },
                    { value: "20", label: "20 Cards" },
                  ]}
                  value={selectedCardCount}
                  onValueChange={setSelectedCardCount}
                  placeholder="Select cards"
                  id="card-count"
                  data-testid="select-card-count"
                />
              </div>
              
              <Button 
                className="w-full gap-2" 
                size="lg" 
                onClick={handleStartGame}
                disabled={!selectedSetId || setsLoading}
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

  const currentQuestion = session.questions?.[session.currentQuestionIndex];
  const progress = ((session.currentQuestionIndex + (isRevealed ? 1 : 0)) / session.totalQuestions) * 100;

  // Defensive check for missing question data
  if (!currentQuestion || !currentQuestion.card) {
    return (
      <div className="min-h-screen flex items-center justify-center pb-20 md:pb-8">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="p-6 text-center space-y-4">
            <X className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold">Game Error</h2>
            <p className="text-muted-foreground">Unable to load the current card. Please try again.</p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => startGameMutation.mutate(parseInt(selectedCardCount))} data-testid="button-retry-game">
                Start New Game
              </Button>
              <Link href="/">
                <Button variant="outline" className="w-full" data-testid="button-go-home">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Go Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isGameOver) {
    const accuracy = session.totalQuestions > 0 
      ? Math.round((session.correctAnswers / session.totalQuestions) * 100) 
      : 0;

    const setName = currentGameSet ? getSetDisplayName(currentGameSet) : "classic";
    const shareText = `I scored ${session.score} points on PackPTS! I identified ${session.correctAnswers}/${session.totalQuestions} ${setName} cards with ${accuracy}% accuracy. Can you beat my score?`;
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
                title: "PackPTS Score",
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
              <p className="text-muted-foreground">Here's how well you know your {currentGameSet ? getSetDisplayName(currentGameSet) : "classic"} cards</p>
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
            
            {currentGameSet && (
              <div className="pt-2 border-t">
                <Link href={`/marketplace?setId=${currentGameSet.id}`}>
                  <Button variant="outline" className="w-full gap-2" data-testid="button-browse-cards">
                    <ShoppingBag className="h-4 w-4" />
                    Browse {currentGameSet.setName} Cards for Sale
                  </Button>
                </Link>
              </div>
            )}
            
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
              key={`${session.id}-${session.currentQuestionIndex}-${currentQuestion.card.id}`}
              imageUrl={currentQuestion.card.imageUrl} 
              isRevealed={isRevealed}
              setLabel={currentGameSet ? `${currentGameSet.year} ${currentGameSet.brand.toUpperCase()}` : undefined}
              setKey={currentGameSet?.id}
              imageRotation={currentQuestion.card.imageRotation}
              showSkipButton={showSkipButton}
              skipPending={replaceCardMutation.isPending || nextQuestionMutation.isPending}
              onSkip={handleManualSkip}
              skipButtonMode={(replacementAttempts.get(session.currentQuestionIndex) ?? 0) >= 2 ? 'skip' : 'replace'}
              onImageError={() => {
                // Get the failed card ID (prefer playableCardId for accurate tracking)
                const failedCardId = currentQuestion?.card?.playableCardId || currentQuestion?.card?.id;
                if (failedCardId) {
                  // Try to replace with a new card instead of skipping
                  handleCardImageError(failedCardId);
                }
              }}
              cardId={currentQuestion.card.playableCardId || currentQuestion.card.id}
              sessionId={session?.id}
            />
            <PointsAnimation points={earnedPoints} show={showPointsAnimation} reward={rewardDetails} />
          </div>

          {currentQuestion && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm text-muted-foreground">Who is on this {currentGameSet ? `${currentGameSet.year} ${currentGameSet.brand}` : ""} card?</p>
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
                  <div className="space-y-3">
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
                    
                    {currentQuestion?.card?.id && !reportedCardIds.has(currentQuestion.card.id) && (
                      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full gap-2 text-muted-foreground"
                            data-testid="button-report-image"
                          >
                            <Flag className="h-3 w-3" />
                            Report Wrong Image
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-amber-500" />
                              Report Card Image Issue
                            </DialogTitle>
                            <DialogDescription>
                              Help us improve by reporting cards with incorrect or mismatched images.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <Label>What's wrong with this image?</Label>
                            <RadioGroup value={reportReason} onValueChange={setReportReason}>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="wrong_sport" id="wrong_sport" />
                                <Label htmlFor="wrong_sport" className="font-normal">Wrong sport (e.g., football instead of baseball)</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="wrong_player" id="wrong_player" />
                                <Label htmlFor="wrong_player" className="font-normal">Wrong player shown</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="wrong_set" id="wrong_set" />
                                <Label htmlFor="wrong_set" className="font-normal">Wrong card set/year</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="bad_image" id="bad_image" />
                                <Label htmlFor="bad_image" className="font-normal">Blurry/corrupted image</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="upside_down" id="upside_down" />
                                <Label htmlFor="upside_down" className="font-normal">Image is upside down or rotated</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="multi_player" id="multi_player" />
                                <Label htmlFor="multi_player" className="font-normal">Multiple players on card</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="other" id="other" />
                                <Label htmlFor="other" className="font-normal">Other issue</Label>
                              </div>
                            </RadioGroup>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              onClick={() => {
                                if (currentQuestion?.card?.id) {
                                  reportCardMutation.mutate({
                                    cardId: currentQuestion.card.id,
                                    reason: reportReason,
                                  });
                                }
                              }}
                              disabled={reportCardMutation.isPending}
                              data-testid="button-submit-report"
                            >
                              {reportCardMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : null}
                              Submit Report
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                    {currentQuestion?.card?.id && reportedCardIds.has(currentQuestion.card.id) && (
                      <p className="text-center text-xs text-muted-foreground" data-testid="text-report-submitted">
                        <CheckCircle className="h-3 w-3 inline mr-1" />
                        Report submitted
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
