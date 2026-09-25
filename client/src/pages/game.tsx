import { useState, useEffect, useRef } from "react";
import { useParams, Link, useSearch } from "wouter";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { SignupModal } from "@/components/signup-modal";
import { Check, X, Clock, Trophy, ArrowLeft, RefreshCw, Loader2, Share2, Copy, CheckCircle, Play, Monitor, ShoppingBag, Flag, AlertTriangle, Download, UserPlus, Image } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CardSetPicker } from "@/components/CardSetPicker";
import { MobileSelect } from "@/components/MobileSelect";
import { SiX, SiFacebook } from "react-icons/si";
import type { ClientGameSession, GameSet, PlayableSet } from "@shared/schema";
import { GameCard } from "@/components/GameCard";
import { DAILY_PROGRESS_QUERY_KEY } from "@/hooks/use-daily-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareAssetCard } from "@/components/ShareAssetCard";
import {
  PLAY_AGAIN_BUTTON_CLASS,
  replayCardCountFromSession,
  replaySetIdFromSession,
} from "@/lib/playAgain";
import { ANON_GATE_CODE, ANON_GATE_COPY, type PublicAnonGate } from "@shared/anonGate";
import { AnonGatePlaque, EscrowHeldChip } from "@/components/anon-gate-plaque";
import {
  prefetchMaskedPlayCards,
  prefetchRevealPlayCard,
  remainingPlayCardUrls,
} from "@/lib/prefetchPlayCardImages";
import { gameCardMountKey } from "@/lib/gameCardImageState";
import {
  reduceSoloReplacePhase,
  soloAnswersLocked,
  SOLO_REPLACE_HARD_CAP_MS,
  type SoloReplacePhase,
} from "@/lib/soloImageReplace";
import { setStaleBuildActivity } from "@/lib/staleBuildActivity";
import { notifyLeavingResults } from "@/lib/staleBuildClient";

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
  let className = "w-full justify-start gap-3 text-left h-auto py-2.5 sm:py-4 px-4 sm:px-5 text-sm sm:text-base";

  if (isRevealed) {
    // Stay full strength. disabled:opacity-50 reads as a scrim over the row.
    className += " disabled:opacity-100";
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
      aria-label={`Answer option: ${option}`}
      data-testid={`button-answer-${option.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className="flex-1">{option}</div>
      {isRevealed && isCorrect && <Check className="h-5 w-5 text-accent-foreground" />}
      {isRevealed && isSelected && !isCorrect && <X className="h-5 w-5" />}
    </Button>
  );
}


export default function Game() {
  const { mode } = useParams<{ mode: string }>();
  const search = useSearch();
  const incomingSession = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).get("session");
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [sessionId, setSessionId] = useState<string | null>(incomingSession);
  const [shareImageUrl, setShareImageUrl] = useState<string | undefined>(undefined);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [revealedCorrectAnswer, setRevealedCorrectAnswer] = useState<string | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [gateOpenOn, setGateOpenOn] = useState<"plaque" | "signup" | "login">("plaque");
  const [hasSeenSignupPrompt, setHasSeenSignupPrompt] = useState(false);
  const [anonGate, setAnonGate] = useState<PublicAnonGate | null>(null);
  const [pointsUpdatedForSession, setPointsUpdatedForSession] = useState<{ id: string; score: number } | null>(null);
  const [selectedCardCount, setSelectedCardCount] = useState("10");
  const [hasStartedGame, setHasStartedGame] = useState(!!incomingSession);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<ClientGameSession>({
    queryKey: ["/api/game/session", sessionId],
    enabled: !!sessionId,
  });

  
  const { data: anonStatus } = useQuery<PublicAnonGate | { anonymous: false; phase: string; canStart: boolean }>({
    queryKey: ["/api/anon/status"],
    enabled: !isAuthenticated,
    staleTime: 10_000,
  });
  const guestGate: PublicAnonGate | null = anonGate
    ?? (anonStatus && "anonymous" in anonStatus && anonStatus.anonymous === true ? anonStatus : null);

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

  useEffect(() => {
    if (!session) return;
    const setId = replaySetIdFromSession(session);
    if (setId) setSelectedSetId(setId);
    const count = replayCardCountFromSession(session);
    if (count != null) setSelectedCardCount(String(count));
  }, [session?.id]);

  const [startError, setStartError] = useState<{ isRateLimit: boolean; message: string } | null>(null);

  const startGameMutation = useMutation({
    mutationFn: async ({ cardCount, setId }: { cardCount: number; setId?: string | null }) => {
      const res = await apiRequest("POST", "/api/game/start", {
        mode: mode || "solo",
        totalQuestions: cardCount,
        setId: setId || selectedSetId || currentGameSet?.id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSessionId(data.id);
      setSelectedAnswer(null);
      setIsRevealed(false);
      setRevealedCorrectAnswer(null);
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
      if (error instanceof ApiError && error.code === ANON_GATE_CODE) {
        setAnonGate({
          phase: "hard",
          canStart: false,
          prompt: "hard",
          reason: error.reason === "next_day" ? "next_day" : "game_cap",
          escrowPoints: error.escrowPoints ?? 0,
          gamesCompleted: error.gamesCompleted ?? 2,
          anonymous: true,
        });
        setHasStartedGame(false);
        setShowSignupModal(true);
        setStartError(null);
        return;
      }
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
      if (!sessionId) {
        throw new Error("Cannot submit answer: game session has not started.");
      }
      const freshSession = queryClient.getQueryData<ClientGameSession>(["/api/game/session", sessionId]);
      const questionIndex = freshSession?.currentQuestionIndex ?? session?.currentQuestionIndex ?? 0;
      const res = await apiRequest("POST", "/api/game/answer", {
        sessionId,
        questionIndex,
        selectedAnswer: answer,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setIsRevealed(true);
      setRevealedCorrectAnswer(data.correctAnswer ?? null);
      if (data.correct) {
        // Trigger marketplace listing fetch for user-created sets
        const freshSession = queryClient.getQueryData<ClientGameSession>(["/api/game/session", sessionId]);
        const card = freshSession?.questions?.[freshSession.currentQuestionIndex]?.card;
        const setId = card?.gameSetId;
        const cardId = data.cardId as string | undefined;
        if (setId && cardId && currentGameSet?.isUserCreated) {
          setListingTarget({ setId, cardId });
        }
      }
      if (data.session) {
        queryClient.setQueryData(["/api/game/session", sessionId], data.session);
      }
      // Invalidate daily progress to update the header badge
      queryClient.invalidateQueries({ queryKey: DAILY_PROGRESS_QUERY_KEY });
    },
    onError: (error: Error) => {
      setIsRevealed(false); // BUG-15: roll back optimistic state on submission error
      setRevealedCorrectAnswer(null);
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
    mutationFn: async (reason?: string) => {
      const res = await apiRequest("POST", "/api/game/next", { sessionId, reason });
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedAnswer(null);
      setIsRevealed(false);
      setRevealedCorrectAnswer(null);
      setListingTarget(null);
      if (data?.shareImageUrl) {
        setShareImageUrl(data.shareImageUrl);
      }
      if (data?.anonGate?.anonymous) {
        setAnonGate(data.anonGate);
        queryClient.invalidateQueries({ queryKey: ["/api/anon/status"] });
      }
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
      void refetchSession();
    },
  });

  // Card image report state and mutation
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("wrong_sport");
  const [reportedCardIds, setReportedCardIds] = useState<Set<string>>(new Set());

  // Commerce: track which card to show listings for after a correct answer on a user-created set
  const [listingTarget, setListingTarget] = useState<{ setId: string; cardId: string } | null>(null);

  const { data: listingsData } = useQuery<{ listings: { listingId: string; title: string; price: string | null; platform: string; url: string }[] }>({
    queryKey: ["/api/sets/listings", listingTarget?.setId, listingTarget?.cardId],
    queryFn: async () => {
      const res = await fetch(`/api/sets/${listingTarget!.setId}/cards/${listingTarget!.cardId}/listings`);
      return res.json();
    },
    enabled: !!listingTarget,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const reportCardMutation = useMutation({
    mutationFn: async ({ questionIndex, reason }: { questionIndex: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/game/session/${sessionId}/report-image`, {
        reason,
        questionIndex,
      });
      return res.json();
    },
    onSuccess: (_, variables) => {
      setReportedCardIds(prev => new Set(prev).add(String(variables.questionIndex)));
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
        logger.debug(`[Game] Card auto-flagged after ${data.failureCount} failures`);
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
  const [replacePhase, setReplacePhase] = useState<SoloReplacePhase>("idle");
  const replaceStartedForIndex = useRef<number | null>(null);

  // Replace card when image fails to load - user doesn't lose PackPTS opportunity
  const replaceCardMutation = useMutation({
    mutationFn: async (questionIndex: number) => {
      const res = await apiRequest("POST", `/api/game/session/${sessionId}/replace-card`, {
        questionIndex,
      }, { timeoutMs: SOLO_REPLACE_HARD_CAP_MS });
      return res.json();
    },
    onSuccess: (data, questionIndex) => {
      if (data?.success && data.question?.card?.imageUrl) {
        queryClient.setQueryData(["/api/game/session", sessionId], (oldData: any) => {
          if (!oldData) return oldData;
          if (questionIndex < 0 || questionIndex >= oldData.questions.length) return oldData;
          const newQuestions = [...oldData.questions];
          newQuestions[questionIndex] = data.question;
          return { ...oldData, questions: newQuestions };
        });
        setReplacedQuestionIndices(prev => new Set(prev).add(questionIndex));
        setReplacePhase((phase) => reduceSoloReplacePhase(phase, { type: "replace-succeeded" }));
        logger.debug(`[Game] Card replaced successfully`);
        prefetchMaskedPlayCards([data.question.card.imageUrl]);
        return;
      }
      setReplacedQuestionIndices(prev => new Set(prev).add(questionIndex));
      setReplacePhase((phase) => reduceSoloReplacePhase(phase, { type: "replace-empty" }));
      setShowSkipButton(true);
    },
    onError: (error, questionIndex) => {
      logger.debug(`[Game] Card replacement failed:`, error);
      setReplacedQuestionIndices(prev => new Set(prev).add(questionIndex));
      const noReplacement = error instanceof Error &&
        error.message.includes("No replacement card available");
      setReplacementAttempts(prev => {
        const newMap = new Map(prev);
        newMap.set(questionIndex, noReplacement ? 2 : (newMap.get(questionIndex) || 0) + 1);
        return newMap;
      });
      setReplacePhase((phase) => reduceSoloReplacePhase(phase, { type: "replace-failed" }));
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

  useEffect(() => {
    replaceStartedForIndex.current = null;
    setReplacePhase("idle");
  }, [session?.currentQuestionIndex]);

  useEffect(() => {
    if (replacePhase !== "replacing") return;
    const timer = window.setTimeout(() => {
      setReplacePhase((phase) => reduceSoloReplacePhase(phase, { type: "replace-timeout" }));
    }, SOLO_REPLACE_HARD_CAP_MS);
    return () => window.clearTimeout(timer);
  }, [replacePhase, session?.currentQuestionIndex]);
  
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
      logger.debug(`[Game] Multiple replacement failures, skipping to next question`);
      nextQuestionMutation.mutate("image_failure");
      return;
    }
    
    // Otherwise try to get a replacement card
    if (!replaceCardMutation.isPending && currentIdx >= 0) {
      setShowSkipButton(false);
      replaceCardMutation.mutate(currentIdx);
    }
  };

  // Handle image error - one automatic replace, then an honest retry/skip. Never a stuck spinner.
  const handleCardImageError = () => {
    const currentIndex = session?.currentQuestionIndex ?? -1;
    if (isRevealed || currentIndex < 0) return;

    const allowReplace = !replacedQuestionIndices.has(currentIndex)
      && replacePhase !== "replacing"
      && replacePhase !== "failed"
      && replacePhase !== "revealed";
    const nextPhase = reduceSoloReplacePhase(replacePhase, { type: "image-rejected", allowReplace });
    setReplacePhase(nextPhase);
    if (nextPhase !== "replacing") {
      setShowSkipButton(true);
      return;
    }
    if (replaceStartedForIndex.current === currentIndex) return;
    replaceStartedForIndex.current = currentIndex;
    replaceCardMutation.mutate(currentIndex);
  };

  const handleSkipBrokenCard = () => {
    if (nextQuestionMutation.isPending) return;
    nextQuestionMutation.mutate("image_failure");
  };

  const handleRetryBrokenCard = () => {
    const currentIndex = session?.currentQuestionIndex ?? -1;
    if (currentIndex >= 0) {
      setReplacedQuestionIndices(prev => new Set(prev).add(currentIndex));
    }
    setReplacePhase((phase) => reduceSoloReplacePhase(phase, { type: "retry" }));
  };

  // No longer auto-start - user selects card count first

  const isGameOver = session?.status === "completed" || session?.status === "expired";
  useEffect(() => {
    const live = Boolean(session && !isGameOver);
    setStaleBuildActivity({
      holdPlay: Boolean(session),
      inProgressCard: live,
      pageSubmitting: submitAnswerMutation.isPending,
    });
    return () => setStaleBuildActivity({ holdPlay: false, inProgressCard: false, pageSubmitting: false });
  }, [session, isGameOver, submitAnswerMutation.isPending]);

  useEffect(() => {
    if (!isGameOver || isAuthenticated || !anonGate) return;
    if (anonGate.phase === "hard") return;
    if (anonGate.prompt === "soft" && !hasSeenSignupPrompt && !showSignupModal) {
      setGateOpenOn("plaque");
      const timer = setTimeout(() => setShowSignupModal(true), 500);
      return () => clearTimeout(timer);
    }
  }, [isGameOver, isAuthenticated, anonGate, hasSeenSignupPrompt, showSignupModal]);

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

  const remainingMaskedUrls = remainingPlayCardUrls(
    (session?.questions ?? []).map((q) => q.card?.imageUrl),
    session?.currentQuestionIndex ?? 0,
  );
  useEffect(() => {
    if (remainingMaskedUrls.length === 0) return;
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    prefetchMaskedPlayCards(remainingMaskedUrls);
    if (typeof performance !== "undefined") {
      console.debug(
        `[Prefetch] solo remaining=${remainingMaskedUrls.length} queued in ${Math.round(performance.now() - started)}ms`,
      );
    }
  }, [session?.id, session?.currentQuestionIndex, remainingMaskedUrls.join(",")]);

  const currentRevealUrl = isRevealed
    ? session?.questions?.[session?.currentQuestionIndex ?? 0]?.card?.revealUrl
    : null;
  useEffect(() => {
    if (isRevealed && currentRevealUrl) {
      prefetchRevealPlayCard(currentRevealUrl);
      setReplacePhase((phase) => reduceSoloReplacePhase(phase, { type: "reveal" }));
    }
  }, [isRevealed, currentRevealUrl]);

  useEffect(() => {
    const current = session?.questions?.[session.currentQuestionIndex ?? 0];
    if (current?.answered && current.card?.revealUrl) setIsRevealed(true);
  }, [session?.id, session?.currentQuestionIndex, session?.questions]);

  const answersLocked = soloAnswersLocked(replacePhase);

  const handleSelectAnswer = (answer: string) => {
    if (isRevealed || answersLocked) return;
    setSelectedAnswer(answer);
  };

  const handleSubmit = () => {
    if (!selectedAnswer || answersLocked) return;
    submitAnswerMutation.mutate(selectedAnswer);
  };

  const handleNextQuestion = () => {
    if (session && sessionId && session.currentQuestionIndex < session.totalQuestions - 1) {
      const nextIndex = session.currentQuestionIndex + 1;
      setSelectedAnswer(null);
      setIsRevealed(false);
      setRevealedCorrectAnswer(null);
      setListingTarget(null);
      queryClient.setQueryData(["/api/game/session", sessionId], {
        ...session,
        currentQuestionIndex: nextIndex,
      });
    }
    nextQuestionMutation.mutate(undefined);
  };

  const startPlayAgain = () => {
    const setId = replaySetIdFromSession(session) || selectedSetId || currentGameSet?.id || null;
    const parsedCount = replayCardCountFromSession(session) ?? parseInt(selectedCardCount, 10);
    const cardCount = Number.isFinite(parsedCount) ? parsedCount : 10;
    if (setId) setSelectedSetId(setId);
    if (cardCount) setSelectedCardCount(String(cardCount));
    setSessionId(null);
    setHasStartedGame(true);
    setStartError(null);
    setPointsUpdatedForSession(null);
    setShareImageUrl(undefined);
    setFailedCardIds([]);
    setReplacedQuestionIndices(new Set());
    setReplacementAttempts(new Map());
    setShowSkipButton(false);
    setReplacementStartTime(null);
    startGameMutation.mutate({ cardCount, setId });
  };

  const handlePlayAgain = () => {
    void notifyLeavingResults().then((reloading) => {
      if (reloading) return;
      startPlayAgain();
    });
  };

  const handleStartGame = () => {
    setHasStartedGame(true);
    startGameMutation.mutate({ cardCount: parseInt(selectedCardCount, 10), setId: selectedSetId });
  };

  if (startGameMutation.isPending || sessionLoading) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 max-w-lg mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 w-full">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
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
              
              {!isAuthenticated && guestGate?.phase === "hard" ? (
                <div data-testid="wall-anon-hard-gate">
                  <AnonGatePlaque
                    variant="hard"
                    escrowPoints={guestGate.escrowPoints}
                    onCreate={() => {
                      setGateOpenOn("signup");
                      setShowSignupModal(true);
                    }}
                    onSignIn={() => {
                      setGateOpenOn("login");
                      setShowSignupModal(true);
                    }}
                  />
                </div>
              ) : (
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
              )}
            </CardContent>
          </Card>
          <SignupModal
            open={showSignupModal}
            onOpenChange={setShowSignupModal}
            variant={guestGate?.phase === "hard" ? "hard" : "optional"}
            gateReason={guestGate?.reason}
            openOn={gateOpenOn}
            pendingPoints={guestGate?.escrowPoints ?? 0}
          />
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
                <Button onClick={() => startGameMutation.mutate({ cardCount: parseInt(selectedCardCount, 10), setId: selectedSetId })} data-testid="button-retry-game">
                  Try Again
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isGameOver) {
    const effectiveTotal = session.totalQuestions - (session.skippedQuestions ?? 0);
    const accuracy = effectiveTotal > 0 
      ? Math.round((session.correctAnswers / effectiveTotal) * 100) 
      : 0;

    const setName = currentGameSet ? getSetDisplayName(currentGameSet) : "classic";
    const skipNote = (session.skippedQuestions ?? 0) > 0
      ? ` (${session.skippedQuestions} skipped)`
      : "";
    const shareText = `I identified ${session.correctAnswers}/${effectiveTotal} ${setName} cards${skipNote} on PackPTS with ${accuracy}% accuracy.`;
    const shareUrl = typeof window !== "undefined" ? window.location.origin : "";
    
    const logShareEvent = async (shareType: string, target: string, contentAssetId?: string) => {
      try {
        await apiRequest("POST", "/api/share-events", { shareType, target, contentAssetId });
      } catch {}
    };

    const handleShare = async (platform: "twitter" | "facebook" | "native" | "copy") => {
      const encodedText = encodeURIComponent(shareText);
      const encodedUrl = encodeURIComponent(shareUrl);
      const target = platform === "twitter" ? "X" : platform === "facebook" ? "DISCORD" : platform === "native" ? "NATIVE_SHARE" : "COPY_LINK";
      
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
              return;
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
            return;
          }
          break;
      }
      logShareEvent("SCORE_CARD", target);
    };

    const handleDownloadScoreCard = async () => {
      try {
        const res = await fetch(`/api/content-assets/latest?matchId=${session.id}`);
        if (res.ok) {
          const data = await res.json();
          const asset = data.assets?.[0];
          if (asset?.metadata?.imageUrl) {
            const link = document.createElement("a");
            link.href = asset.metadata.imageUrl;
            link.download = `packpts-score-${session.id.slice(0, 8)}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            logShareEvent("SCORE_CARD", "COPY_LINK", asset.id);
            toast({ title: "Downloading!", description: "Score card image downloading" });
            return;
          }
        }
        toast({ title: "Not ready", description: "Score card is being generated, try again shortly", variant: "destructive" });
      } catch {
        toast({ title: "Error", description: "Failed to download score card", variant: "destructive" });
      }
    };

    const handleChallengeInvite = async () => {
      try {
        const res = await apiRequest("POST", "/api/referrals/create", {
          purpose: "SCORE_SHARE",
          destinationPath: "/",
        });
        const data = await res.json();
        if (data.url) {
          const challengeText = `I identified ${session.correctAnswers}/${effectiveTotal} ${setName} cards${skipNote} on PackPTS. ${data.url}`;
          await navigator.clipboard.writeText(challengeText);
          logShareEvent("CHALLENGE_INVITE", "COPY_LINK");
          toast({ title: "Challenge link copied!", description: "Share it with a friend" });
        }
      } catch {
        toast({ title: "Error", description: "Failed to create challenge link", variant: "destructive" });
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
              <h2 className="text-2xl font-bold" data-testid="text-game-over-title">Game Complete</h2>
              {!isAuthenticated && <EscrowHeldChip points={anonGate?.escrowPoints ?? 0} />}
              <p className="text-muted-foreground uppercase tracking-wider text-sm">
                {`Here's how well you know your ${currentGameSet ? getSetDisplayName(currentGameSet) : "classic"} cards`}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 items-stretch" data-testid="grid-final-stats">
              <div className="h-full p-4 rounded-md bg-muted flex flex-col">
                <p className="text-3xl font-bold font-mono whitespace-nowrap" data-testid="text-final-score">{session.score}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">PTS</p>
              </div>
              <div className="h-full p-4 rounded-md bg-muted flex flex-col">
                <p className="text-3xl font-bold font-mono whitespace-nowrap" data-testid="text-accuracy">{accuracy}%</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Accuracy</p>
              </div>
              <div className="h-full p-4 rounded-md bg-muted flex flex-col">
                <p className="text-3xl font-bold font-mono whitespace-nowrap" data-testid="text-final-correct">{session.correctAnswers}/{effectiveTotal}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Score</p>
              </div>
            </div>
            {(session.skippedQuestions ?? 0) > 0 && (
              <div className="text-sm text-muted-foreground">
                {session.skippedQuestions} card{session.skippedQuestions === 1 ? "" : "s"} skipped
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              {!isAuthenticated && anonGate?.phase === "hard" ? (
                <div data-testid="wall-anon-hard-gate">
                  <AnonGatePlaque
                    variant="hard"
                    escrowPoints={anonGate.escrowPoints}
                    onCreate={() => {
                      setGateOpenOn("signup");
                      setShowSignupModal(true);
                    }}
                    onSignIn={() => {
                      setGateOpenOn("login");
                      setShowSignupModal(true);
                    }}
                  />
                </div>
              ) : (
                <Button
                  onClick={handlePlayAgain}
                  size="lg"
                  className={PLAY_AGAIN_BUTTON_CLASS}
                  data-testid="button-play-again"
                >
                  <RefreshCw className="h-4 w-4" />
                  Play Again
                </Button>
              )}
              <Link href="/">
                <Button variant="outline" className={PLAY_AGAIN_BUTTON_CLASS} data-testid="button-back-home">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
            
            {isAuthenticated && (
              <ShareAssetCard
                matchId={session.id}
                initialImageUrl={shareImageUrl}
                downloadFilename={`packpts-score-${session.id.slice(0, 8)}.png`}
                shareUrl="https://packpts.com"
                shareText={shareText}
                maskedCardUrls={(session.questions ?? []).filter((q) => q.answered).map((q) => q.card?.imageUrl)}
              />
            )}

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
              {isAuthenticated && (
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleChallengeInvite}
                    data-testid="button-challenge-friend"
                  >
                    <UserPlus className="h-4 w-4" />
                    Challenge a Friend
                  </Button>
                </div>
              )}
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
            
            {!isAuthenticated && !anonGate && !hasSeenSignupPrompt && session.score > 0 && (
              <div className="pt-2">
                <Button 
                  onClick={() => setShowSignupModal(true)} 
                  variant="secondary" 
                  className={PLAY_AGAIN_BUTTON_CLASS}
                  data-testid="button-save-points"
                >
                  {ANON_GATE_COPY.softCta}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <SignupModal 
          open={showSignupModal} 
          onOpenChange={(open) => {
            setShowSignupModal(open);
            if (!open && anonGate?.phase !== "hard") {
              setHasSeenSignupPrompt(true);
            }
          }}
          variant={anonGate?.phase === "hard" ? "hard" : anonGate?.prompt === "soft" ? "soft" : "optional"}
          gateReason={anonGate?.reason}
          openOn={anonGate?.phase === "hard" ? gateOpenOn : "plaque"}
          pendingPoints={anonGate?.escrowPoints ?? 0}
          onPlayAgain={handlePlayAgain}
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

  const currentQuestion = session.questions?.[session.currentQuestionIndex];
  const currentQuestionAnswered = (currentQuestion as any)?.answered === true;
  const progress = ((session.currentQuestionIndex + (isRevealed ? 1 : 0)) / session.totalQuestions) * 100;

  // Defensive check for missing question data (should not normally occur)
  if (!currentQuestion || !currentQuestion.card) {
    return (
      <div className="min-h-screen flex items-center justify-center pb-20 md:pb-8">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="p-6 text-center space-y-4">
            <X className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold">Game Error</h2>
            <p className="text-muted-foreground">Unable to load the current card. Please try again.</p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => startGameMutation.mutate({ cardCount: parseInt(selectedCardCount, 10), setId: selectedSetId })} data-testid="button-retry-game">
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

  return (
    <div data-testid="game-active-viewport" className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto max-w-2xl mx-auto w-full px-3 sm:px-4">
        {/* Zone 1: Header */}
        <div className="pt-2 pb-1">
          <div className="flex items-center justify-between gap-4 mb-2">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="gap-1.5 font-mono" data-testid="badge-question-count">
                <Clock className="h-3 w-3" />
                {session.currentQuestionIndex + 1} / {session.totalQuestions}
              </Badge>
            </div>
          </div>
          <Progress value={progress} className="h-1.5" data-testid="progress-game" />
        </div>

        {/* Zone 2: Card — same in-flow slot before and after submit. No dialog, no zoom. */}
        <div className="flex items-center justify-center py-1 relative" data-testid="solo-card-slot">
          <div className="w-full max-w-[280px] sm:max-w-[340px] md:max-w-[380px]">
              <GameCard 
                key={gameCardMountKey(session.id, session.currentQuestionIndex, currentQuestion.card.imageUrl)}
                imageUrl={currentQuestion.card.imageUrl}
                revealUrl={isRevealed ? currentQuestion.card.revealUrl : undefined}
                maskPlan={currentQuestion.card.maskPlan}
                plaqueEyebrow={currentGameSet ? `${currentGameSet.year} ${currentGameSet.brand.toUpperCase()}` : undefined}
                answerStaged={!!selectedAnswer && !isRevealed}
                revealedPlayerName={isRevealed ? revealedCorrectAnswer ?? undefined : undefined}
                isRevealed={isRevealed}
                setKey={currentGameSet?.id}
                imageRotation={currentQuestion.card.imageRotation}
                showSkipButton={showSkipButton}
                skipPending={replaceCardMutation.isPending || nextQuestionMutation.isPending}
                skipButtonMode={(replacementAttempts.get(session.currentQuestionIndex) ?? 0) >= 2 ? 'skip' : 'replace'}
                onImageError={() => {
                  handleCardImageError();
                }}
                replacePhase={replacePhase}
                onRetryImage={handleRetryBrokenCard}
                onSkip={replacePhase === "failed" ? handleSkipBrokenCard : handleManualSkip}
                sessionId={session?.id}
                playScope="solo"
                questionIndex={session.currentQuestionIndex}
              />
          </div>
        </div>

        {/* Zone 3: Answers */}
        {currentQuestion && (
          <div className="pb-4">
            {currentGameSet?.isUserCreated && currentGameSet?.makerNote && (
              <p className="text-xs text-muted-foreground/60 italic mb-1 line-clamp-1">"{currentGameSet.makerNote}"</p>
            )}
            <p className="text-xs sm:text-sm text-muted-foreground mb-1.5">Who is on this {currentGameSet ? `${currentGameSet.year} ${currentGameSet.brand}` : ""} card?</p>

            <div>
              <div className="space-y-1.5" role="group" aria-label="Answer choices">
                {currentQuestion.options.map((option) => (
                  <AnswerButton
                    key={option}
                    option={option}
                    isSelected={selectedAnswer === option}
                    isCorrect={option === revealedCorrectAnswer}
                    isRevealed={isRevealed}
                    onSelect={() => handleSelectAnswer(option)}
                    disabled={submitAnswerMutation.isPending || answersLocked}
                  />
                ))}
              </div>

              <div className="pt-2">
                {!isRevealed && !currentQuestionAnswered ? (
                  <Button
                    onClick={handleSubmit}
                    disabled={!selectedAnswer || !sessionId || submitAnswerMutation.isPending || nextQuestionMutation.isPending || currentQuestionAnswered || answersLocked}
                    className="w-full gap-2"
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
                  <div className="space-y-2">
                    <Button
                      onClick={handleNextQuestion}
                      disabled={nextQuestionMutation.isPending}
                      className="w-full gap-2"
                      data-testid="button-next-question"
                    >
                      {nextQuestionMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Next Question"
                      )}
                    </Button>

                    {/* Commerce: "Find this card" tiles after a correct answer on a user-created set */}
                    {listingTarget && listingsData && listingsData.listings.length > 0 && (
                      <div className="rounded-lg border bg-card p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                          <ShoppingBag className="h-3.5 w-3.5" />
                          Find this card
                        </p>
                        <div className="space-y-1.5">
                          {listingsData.listings.map((listing) => (
                            <a
                              key={listing.listingId}
                              href={listing.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => {
                                apiRequest("POST", `/api/sets/${listingTarget.setId}/cards/${listingTarget.cardId}/log-click`, {
                                  listingId: listing.listingId,
                                  destinationUrl: listing.url,
                                  platform: listing.platform,
                                }).catch(() => {});
                              }}
                              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
                            >
                              <span className="truncate flex-1 text-foreground">{listing.title}</span>
                              <span className="shrink-0 font-mono font-semibold text-primary">
                                {listing.price ?? "—"}
                              </span>
                              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{listing.platform}</Badge>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {session && !reportedCardIds.has(String(session.currentQuestionIndex)) && (
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
                                reportCardMutation.mutate({
                                  questionIndex: session.currentQuestionIndex,
                                  reason: reportReason,
                                });
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
                    {session && reportedCardIds.has(String(session.currentQuestionIndex)) && (
                      <p className="text-center text-xs text-muted-foreground" data-testid="text-report-submitted">
                        <CheckCircle className="h-3 w-3 inline mr-1" />
                        Report submitted
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
