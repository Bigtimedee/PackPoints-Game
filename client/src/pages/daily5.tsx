import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { SignupModal } from "@/components/signup-modal";
import { ANON_GATE_CODE, type PublicAnonGate } from "@shared/anonGate";
import { applySetDisplayTitle, applySetYearLabel, setDisplayOverride } from "@shared/setDisplayOverride";
import { AnonGatePlaque, EscrowHeldChip } from "@/components/anon-gate-plaque";
import { DAILY_PROGRESS_QUERY_KEY } from "@/hooks/use-daily-progress";
import { GameCard } from "@/components/GameCard";
import { ShareAssetCard } from "@/components/ShareAssetCard";
import { statTileValueFontPx } from "@/lib/statTileValue";
import {
  BEAT_ME_COPY,
  dismissBeatMeBanner,
  formatBeatMeBanner,
  formatBeatMeCompare,
  formatBeatMeShareCaption,
  isBeatMeBannerDismissed,
  isBeatMeShareUrl,
  mapBeatMeApiResult,
  parseBeatMeToken,
  persistBeatMeChallenge,
  readPersistedBeatMeChallenge,
  type DailyBeatMeChallenge,
} from "@/lib/dailyBeatMe";
import {
  isDaily5PositionAnswered,
  nextUnansweredDaily5Position,
  resolveDaily5Resume,
  type Daily5ResumeEntry,
} from "@/lib/daily5Resume";
import {
  Calendar, Trophy, ArrowLeft, Check, X, Loader2,
  Play, Award, Crown, Compass
} from "lucide-react";
import { DAILY5_NEXT_PLAY, PLAY_AGAIN_BUTTON_CLASS } from "@/lib/playAgain";
import { prefetchMaskedPlayCards, prefetchRevealPlayCard } from "@/lib/prefetchPlayCardImages";
import { gameCardMountKey } from "@/lib/gameCardImageState";
import { setStaleBuildActivity } from "@/lib/staleBuildActivity";

interface Daily5Status {
  challenge: {
    id: string;
    date: string;
    status: "SCHEDULED" | "ACTIVE" | "CLOSED";
    startsAt: string;
    endsAt: string;
    setId?: string | null;
  } | null;
  hasPlayed: boolean;
  entry: {
    id: string;
    score: number;
    correctCount: number;
    completedAt: string | null;
    answers: { position: number; selected: string; correct: boolean }[];
  } | null;
  timeUntilStart: number;
  timeUntilEnd: number;
  anonGate?: PublicAnonGate | null;
}

interface Daily5Card {
  position: number;
  imageUrl: string;
  choices: string[];
  pointValue: number;
  maskPlan?: import("@shared/schema").PublicMaskPlan | null;
}

interface AnswerResult {
  correct: boolean;
  pointsEarned: number;
  score: number;
  correctCount: number;
  revealUrl?: string | null;
}

interface FinishResult {
  score: number;
  correctCount: number;
  totalTime: number;
  rank: number;
  flagged?: boolean;
  correctAnswers?: { position: number; correctAnswer: string }[];
  pointsCredited?: number;
  shareImageUrl?: string;
  anonGate?: PublicAnonGate | null;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
  correctCount: number;
  timeMs: number | null;
}

function formatTime(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function BeatMeBanner({
  challenge,
  onDismiss,
}: {
  challenge: DailyBeatMeChallenge;
  onDismiss?: () => void;
}) {
  const stale = challenge.status !== "active";
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-lg border px-4 py-3"
      style={{
        backgroundColor: "#161B24",
        borderColor: "#2A303C",
        borderLeftWidth: 3,
        borderLeftColor: stale ? "#8F96A3" : "#F5C518",
      }}
      data-testid="text-d5-beat-me"
      data-status={challenge.status}
      role="status"
    >
      <div className="min-w-0 flex-1 text-left">
        <p className="text-sm font-medium" style={{ color: stale ? "#8F96A3" : "#F0F2F5" }}>
          {formatBeatMeBanner(challenge)}
        </p>
        {!stale && (
          <p className="text-xs mt-0.5" style={{ color: "#8F96A3" }}>
            {BEAT_ME_COPY.sameFive}
          </p>
        )}
      </div>
      {!stale && onDismiss && (
        <button
          type="button"
          aria-label="Dismiss challenge"
          className="shrink-0 text-lg leading-none px-1"
          style={{ color: "#8F96A3" }}
          onClick={onDismiss}
          data-testid="button-d5-beat-me-dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

async function pngFileFromUrl(url: string, filename: string): Promise<File | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || "image/png" });
  } catch {
    return null;
  }
}

function ShareResultCard({ correctCount, date, challengeId, shareImageUrl, maskedCardUrls }: {
  correctCount: number;
  date?: string;
  challengeId?: string;
  shareImageUrl?: string;
  maskedCardUrls?: readonly (string | null | undefined)[];
}) {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [busy, setBusy] = useState(false);
  const [beatMeUrl, setBeatMeUrl] = useState<string | null>(null);
  const [challengeImageUrl, setChallengeImageUrl] = useState<string | null>(null);
  const [sessionImageUrl, setSessionImageUrl] = useState<string | undefined>(shareImageUrl);

  const dateStr = date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const shareCaption = formatBeatMeShareCaption(correctCount);
  const sessionFilename = `packpts-daily5-${dateStr}.png`;

  const logShareEvent = async (shareType: string, target: string) => {
    try {
      await apiRequest("POST", "/api/share-events", { shareType, target });
    } catch {}
  };

  const issueBeatMe = async (): Promise<{ url: string; path: string; shareImageUrl?: string } | null> => {
    const created = await apiRequest("POST", "/api/daily5/beat-me").then((res) => res.json()) as {
      url?: string;
      path?: string;
      shareImageUrl?: string;
    };
    if (!created.url || !created.path || !isBeatMeShareUrl(created.url)) return null;
    setBeatMeUrl(created.url);
    if (created.shareImageUrl) setChallengeImageUrl(created.shareImageUrl);
    try {
      await apiRequest("POST", "/api/referrals/create", {
        purpose: "SCORE_SHARE",
        destinationPath: created.path,
      });
    } catch {
      // attribution is optional — the signed challenge URL is the product loop
    }
    return { url: created.url, path: created.path, shareImageUrl: created.shareImageUrl };
  };

  const handleBeatMe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = beatMeUrl
        ? { url: beatMeUrl, path: "", shareImageUrl: challengeImageUrl ?? undefined }
        : await issueBeatMe();
      if (!created?.url || !isBeatMeShareUrl(created.url)) {
        toast({ title: "Not ready", description: "Finish today's Daily 5 to challenge a friend.", variant: "destructive" });
        return;
      }
      const imageUrl = created.shareImageUrl || sessionImageUrl;
      const file = imageUrl ? await pngFileFromUrl(imageUrl, "packpts-daily5-challenge.png") : null;
      if (navigator.share) {
        try {
          if (file && navigator.canShare?.({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: BEAT_ME_COPY.primary,
              text: `${shareCaption}\n${created.url}`,
            });
          } else {
            await navigator.share({ title: BEAT_ME_COPY.primary, text: shareCaption, url: created.url });
          }
          logShareEvent("CHALLENGE_INVITE", "NATIVE_SHARE");
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(`${shareCaption}\n${created.url}`);
      logShareEvent("CHALLENGE_INVITE", "COPY_LINK");
      toast({ title: "Challenge link copied", description: "Opens today's Daily 5 with your score" });
    } catch {
      toast({ title: "Error", description: "Failed to create challenge link", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleShareCard = async () => {
    const file = sessionImageUrl ? await pngFileFromUrl(sessionImageUrl, sessionFilename) : null;
    const text = beatMeUrl ? `${shareCaption}\n${beatMeUrl}` : shareCaption;
    try {
      if (navigator.share) {
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "PackPTS Daily 5", text });
          logShareEvent("SCORE_CARD", "NATIVE_SHARE");
          return;
        }
        if (beatMeUrl) {
          await navigator.share({ title: "PackPTS Daily 5", text: shareCaption, url: beatMeUrl });
          logShareEvent("SCORE_CARD", "NATIVE_SHARE");
          return;
        }
        await navigator.share({ title: "PackPTS Daily 5", text: shareCaption });
        logShareEvent("SCORE_CARD", "NATIVE_SHARE");
        return;
      }
      await navigator.clipboard.writeText(text);
      logShareEvent("SCORE_CARD", "COPY_LINK");
      toast({ title: "Copied", description: beatMeUrl ? "Challenge link copied" : "Score caption copied" });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast({ title: "Could not share", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    const href = sessionImageUrl;
    if (!href) {
      toast({ title: "Not ready", description: "Score card is being generated, try again shortly", variant: "destructive" });
      return;
    }
    try {
      const imgRes = await fetch(href, { credentials: "include" });
      if (!imgRes.ok) throw new Error("download failed");
      const blob = await imgRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = sessionFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      toast({ title: "Downloading", description: "Score card image saving to your device" });
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  if (!isAuthenticated || !challengeId) return null;

  return (
    <Card className="mb-6 overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <ShareAssetCard
          challengeId={challengeId}
          initialImageUrl={shareImageUrl}
          downloadFilename={sessionFilename}
          shareText={shareCaption}
          previewOnly
          maskedCardUrls={maskedCardUrls}
          onImageUrl={setSessionImageUrl}
          resolveShareUrl={async () => {
            const created = beatMeUrl ? { url: beatMeUrl } : await issueBeatMe();
            return created?.url ?? null;
          }}
        />
        <Button
          className="w-full min-h-11 border-0 text-base font-semibold hover:opacity-95"
          style={{ backgroundColor: "#F5C518", color: "#0b0f16" }}
          onClick={handleBeatMe}
          disabled={busy}
          data-testid="button-d5-beat-me"
        >
          {BEAT_ME_COPY.primary}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            style={{ backgroundColor: "#161B24", borderColor: "#2A303C", color: "#F0F2F5" }}
            onClick={handleShareCard}
            data-testid="button-d5-share"
          >
            {BEAT_ME_COPY.share}
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            style={{ backgroundColor: "#161B24", borderColor: "#2A303C", color: "#F0F2F5" }}
            onClick={handleSave}
            data-testid="button-d5-save"
          >
            {BEAT_ME_COPY.save}
          </Button>
        </div>
        <p className="text-sm text-center" style={{ color: "#8F96A3" }} data-testid="text-d5-beat-me-helper">
          {BEAT_ME_COPY.helper}
        </p>
      </CardContent>
    </Card>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function CountdownTimer({ targetMs, label }: { targetMs: number; label: string }) {
  const [remaining, setRemaining] = useState(targetMs);

  useEffect(() => {
    setRemaining(targetMs);
    const interval = setInterval(() => {
      setRemaining(prev => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  return (
    <div className="text-center space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-mono font-bold" data-testid="text-countdown">
        {formatTime(remaining)}
      </p>
    </div>
  );
}

function AnswerButton({
  option, isSelected, wasCorrectAnswer, isRevealed, onSelect, disabled,
}: {
  option: string; isSelected: boolean; wasCorrectAnswer: boolean;
  isRevealed: boolean; onSelect: () => void; disabled: boolean;
}) {
  let variant: "default" | "outline" | "secondary" | "destructive" = "outline";
  let className = "w-full justify-start gap-3 text-left h-auto py-2.5 sm:py-4 px-4 sm:px-5 text-sm sm:text-base";
  if (isRevealed) {
    className += " disabled:opacity-100";
    if (isSelected && wasCorrectAnswer) className += " bg-accent text-accent-foreground border-accent";
    else if (isSelected && !wasCorrectAnswer) className += " bg-destructive/10 text-destructive border-destructive";
  } else if (isSelected) {
    variant = "default";
  }
  return (
    <Button variant={variant} className={className} onClick={onSelect}
      disabled={disabled || isRevealed}
      data-testid={`button-d5-answer-${option.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="flex-1">{option}</div>
      {isRevealed && isSelected && wasCorrectAnswer && <Check className="h-5 w-5 text-accent-foreground" />}
      {isRevealed && isSelected && !wasCorrectAnswer && <X className="h-5 w-5" />}
    </Button>
  );
}

export default function Daily5Page() {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [guestGate, setGuestGate] = useState<PublicAnonGate | null>(null);
  const [showGuestGate, setShowGuestGate] = useState(false);
  const [gateOpenOn, setGateOpenOn] = useState<"plaque" | "signup" | "login">("plaque");
  const searchString = useSearch();
  const [beatMe, setBeatMe] = useState<DailyBeatMeChallenge | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [gameState, setGameState] = useState<"loading" | "preview" | "playing" | "results">("loading");
  const [cards, setCards] = useState<Daily5Card[]>([]);
  const [currentPosition, setCurrentPosition] = useState(1);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [challengeId, setChallengeId] = useState<string>("");
  const [entryId, setEntryId] = useState<string>("");
  const [challengeSetId, setChallengeSetId] = useState<string | undefined>();
  const [answeredPositions, setAnsweredPositions] = useState<number[]>([]);
  const hydratedEntryIdRef = useRef<string | null>(null);
  const autoFinishKeyRef = useRef<string | null>(null);

  const statusQuery = useQuery<Daily5Status>({
    queryKey: ["/api/daily5/status"],
    refetchInterval: 30000,
  });

  const leaderboardQuery = useQuery<{
    entries: LeaderboardEntry[];
    date: string;
    totalEntries: number;
  }>({
    queryKey: ["/api/daily5/leaderboard"],
    refetchInterval: 60000,
  });

  const applyResume = useCallback((
    entry: Daily5ResumeEntry | null | undefined,
    ids?: { challengeId?: string; entryId?: string },
  ) => {
    const resume = resolveDaily5Resume(entry);
    if (ids?.challengeId) setChallengeId(ids.challengeId);
    if (ids?.entryId) setEntryId(ids.entryId);
    setCorrectCount(resume.correctCount);
    setAnsweredPositions(resume.answeredPositions);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setIsRevealed(false);

    if (resume.phase === "complete") {
      setFinishResult((prev) => prev ?? {
        score: resume.score,
        correctCount: resume.correctCount,
        totalTime: 0,
        rank: 0,
      });
      setGameState("results");
      return resume;
    }

    setCurrentPosition(resume.currentPosition);
    setGameState("playing");
    return resume;
  }, []);

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/daily5/start"),
    onSuccess: async (res) => {
      const data = await res.json();
      setCards(data.cards);
      if (data.setId) setChallengeSetId(data.setId);
      applyResume(data.entry, {
        challengeId: data.entry.dailyChallengeId,
        entryId: data.entry.id,
      });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.code === ANON_GATE_CODE) {
        setGuestGate({
          phase: "hard",
          canStart: false,
          prompt: "hard",
          reason: err.reason === "next_day" ? "next_day" : "game_cap",
          escrowPoints: err.escrowPoints ?? 0,
          gamesCompleted: err.gamesCompleted ?? 2,
          anonymous: true,
        });
        setShowGuestGate(true);
        setGameState("preview");
        return;
      }
      setGameState("preview");
      toast({ title: "Cannot start", description: err.message || "Failed to start Daily 5", variant: "destructive" });
    },
  });

  const answerMutation = useMutation({
    mutationFn: (data: { challengeId: string; position: number; selectedAnswer: string }) =>
      apiRequest("POST", "/api/daily5/answer", data),
    onSuccess: async (res, variables) => {
      const data: AnswerResult = await res.json();
      setAnswerResult(data);
      setIsRevealed(true);
      setCorrectCount(data.correctCount);
      setAnsweredPositions((prev) => (
        prev.includes(variables.position) ? prev : [...prev, variables.position]
      ));
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to submit answer", variant: "destructive" });
    },
  });

  const finishMutation = useMutation({
    mutationFn: (data: { challengeId: string }) => apiRequest("POST", "/api/daily5/finish", data),
    onSuccess: async (res) => {
      const data: FinishResult = await res.json();
      setFinishResult(data);
      if (data.anonGate?.anonymous) {
        setGuestGate(data.anonGate);
        if (data.anonGate.prompt === "soft") {
          setGateOpenOn("plaque");
          setShowGuestGate(true);
        }
        queryClient.invalidateQueries({ queryKey: ["/api/anon/status"] });
      }
      setGameState("results");
      queryClient.invalidateQueries({ queryKey: ["/api/daily5/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily5/leaderboard"] });
      queryClient.invalidateQueries({ queryKey: DAILY_PROGRESS_QUERY_KEY });
    },
    onError: (err: any) => {
      if (String(err.message || "").includes("Already completed")) {
        setGameState("results");
        return;
      }
      toast({ title: "Error", description: err.message || "Failed to finish", variant: "destructive" });
    },
  });

  useEffect(() => {
    const token = parseBeatMeToken(searchString) ?? readPersistedBeatMeChallenge()?.token;
    if (!token) {
      setBeatMe(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/daily5/beat-me?challenge=${encodeURIComponent(token)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const mapped = mapBeatMeApiResult(token, data);
        if (mapped) {
          persistBeatMeChallenge(mapped);
          setBeatMe(mapped);
        } else {
          setBeatMe(null);
        }
      })
      .catch(() => {
        if (!cancelled) setBeatMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [searchString]);

  useEffect(() => {
    setBannerHidden(beatMe ? isBeatMeBannerDismissed(beatMe.token) : false);
  }, [beatMe]);

  const hideBeatMeBanner = useCallback(() => {
    if (!beatMe) return;
    dismissBeatMeBanner(beatMe.token);
    setBannerHidden(true);
  }, [beatMe]);

  useEffect(() => {
    if (!statusQuery.data) return;
    const status = statusQuery.data;
    if (status.challenge?.setId) setChallengeSetId(status.challenge.setId);
    const resume = resolveDaily5Resume(status.entry);

    if (status.hasPlayed && status.entry?.completedAt) {
      setFinishResult({
        score: status.entry.score,
        correctCount: status.entry.correctCount,
        totalTime: 0,
        rank: 0,
      });
      setGameState("results");
      return;
    }

    if (status.entry && status.challenge?.status === "ACTIVE" && resume.phase === "complete") {
      if (hydratedEntryIdRef.current !== status.entry.id) {
        hydratedEntryIdRef.current = status.entry.id;
        applyResume(status.entry, {
          challengeId: status.challenge.id,
          entryId: status.entry.id,
        });
      } else {
        setGameState("results");
      }
      const finishKey = status.entry.id;
      if (!status.entry.completedAt && autoFinishKeyRef.current !== finishKey && !finishMutation.isPending) {
        autoFinishKeyRef.current = finishKey;
        finishMutation.mutate({ challengeId: status.challenge.id });
      }
      return;
    }

    if (status.entry && !status.entry.completedAt && status.challenge?.status === "ACTIVE") {
      if (hydratedEntryIdRef.current !== status.entry.id) {
        hydratedEntryIdRef.current = status.entry.id;
        applyResume(status.entry, {
          challengeId: status.challenge.id,
          entryId: status.entry.id,
        });
      } else {
        setGameState("playing");
      }
      if (cards.length === 0 && !startMutation.isPending) {
        startMutation.mutate();
      }
      return;
    }

    setGameState("preview");
  }, [statusQuery.data]);

  const handleSubmitAnswer = useCallback(() => {
    if (!selectedAnswer || !challengeId) return;
    if (isDaily5PositionAnswered(answeredPositions, currentPosition)) {
      const next = nextUnansweredDaily5Position(answeredPositions);
      if (next == null) {
        finishMutation.mutate({ challengeId });
        return;
      }
      setCurrentPosition(next);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setIsRevealed(false);
      return;
    }
    answerMutation.mutate({ challengeId, position: currentPosition, selectedAnswer });
  }, [selectedAnswer, challengeId, currentPosition, answeredPositions]);

  const handleNext = useCallback(() => {
    if (currentPosition >= 5) {
      finishMutation.mutate({ challengeId });
    } else {
      setCurrentPosition(prev => prev + 1);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setIsRevealed(false);
    }
  }, [currentPosition, challengeId]);

  const status = statusQuery.data;
  const currentCard = cards.find(c => c.position === currentPosition);

  useEffect(() => {
    const playing = gameState === "playing";
    const onResults = gameState === "results";
    setStaleBuildActivity({
      daily5Playing: playing,
      inProgressCard: playing,
      holdPlay: playing || onResults,
    });
    return () => setStaleBuildActivity({ daily5Playing: false, inProgressCard: false, holdPlay: false });
  }, [gameState]);

  useEffect(() => {
    const remaining = cards.filter((card) => card.position >= currentPosition).map((card) => card.imageUrl);
    if (remaining.length === 0) return;
    prefetchMaskedPlayCards(remaining);
  }, [cards, currentPosition]);

  useEffect(() => {
    if (isRevealed && answerResult?.revealUrl) {
      prefetchRevealPlayCard(answerResult.revealUrl);
    }
  }, [isRevealed, answerResult?.revealUrl]);

  if (
    statusQuery.isLoading
    || (gameState === "playing" && !currentCard)
    || (finishMutation.isPending && gameState !== "results")
  ) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (gameState === "playing" && currentCard) {
    return (
      <div>
        <div className="container mx-auto px-4 py-4 max-w-2xl">
          {beatMe && !bannerHidden && (
            <BeatMeBanner challenge={beatMe} onDismiss={beatMe.status === "active" ? hideBeatMeBanner : undefined} />
          )}
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <Badge variant="outline" className="gap-1.5">
              <Calendar className="h-3 w-3" />
              Daily 5
            </Badge>
            {setDisplayOverride(challengeSetId ?? statusQuery.data?.challenge?.setId) ? (
              <span className="text-sm text-muted-foreground" data-testid="text-d5-set-label">
                {applySetDisplayTitle(challengeSetId ?? statusQuery.data?.challenge?.setId, "")}
                {" · "}
                {applySetYearLabel(challengeSetId ?? statusQuery.data?.challenge?.setId, null)}
              </span>
            ) : null}
            <span className="text-sm text-muted-foreground" data-testid="text-d5-progress">
              {currentPosition}/5
            </span>
          </div>
          <Progress value={(currentPosition - 1) / 5 * 100 + (isRevealed ? 20 : 0)} className="mb-4" />

          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-full max-w-xs aspect-[2.5/3.5] relative">
                <GameCard
                  key={gameCardMountKey(challengeId || "daily5", currentCard.position, currentCard.imageUrl)}
                  imageUrl={currentCard.imageUrl}
                  revealUrl={isRevealed ? answerResult?.revealUrl ?? undefined : undefined}
                  maskPlan={currentCard.maskPlan}
                  plaqueEyebrow="DAILY 5"
                  answerStaged={!!selectedAnswer && !isRevealed}
                  isRevealed={isRevealed}
                  imageRotation={0}
                  setKey={challengeSetId ?? statusQuery.data?.challenge?.setId ?? undefined}
                  allowClientImageReject={false}
                  sessionId={challengeId}
                  playScope="d5"
                  questionIndex={currentCard.position}
                />
              </div>
            </div>

            <div className="space-y-2" data-testid="d5-answer-options">
              {currentCard.choices.map((option) => (
                <AnswerButton
                  key={option}
                  option={option}
                  isSelected={selectedAnswer === option}
                  wasCorrectAnswer={isRevealed && selectedAnswer === option && (answerResult?.correct ?? false)}
                  isRevealed={isRevealed}
                  onSelect={() => !isRevealed && setSelectedAnswer(option)}
                  disabled={answerMutation.isPending}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {!isRevealed ? (
                <Button
                  className="w-full"
                  disabled={!selectedAnswer || answerMutation.isPending || isDaily5PositionAnswered(answeredPositions, currentPosition)}
                  onClick={handleSubmitAnswer}
                  data-testid="button-d5-submit"
                >
                  {answerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Submit Answer
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={handleNext}
                  disabled={finishMutation.isPending}
                  data-testid="button-d5-next"
                >
                  {finishMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {currentPosition >= 5 ? "See Results" : "Next Card"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === "results") {
    const lb = leaderboardQuery.data;
    const d5Points = finishResult?.score ?? status?.entry?.score ?? 0;
    const d5Correct = finishResult?.correctCount ?? status?.entry?.correctCount ?? 0;
    const d5Accuracy = `${Math.round((d5Correct / 5) * 100)}%`;
    const d5Fraction = `${d5Correct}/5`;
    return (
      <div>
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          {beatMe && !bannerHidden && beatMe.status !== "active" && (
            <BeatMeBanner challenge={beatMe} />
          )}
          <div className="text-center space-y-4 mb-8">
            <div className="inline-flex p-4 rounded-full bg-primary/10">
              <Trophy className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-3xl font-bold" data-testid="text-d5-complete">Game Complete</h1>
            <p className="text-muted-foreground uppercase tracking-wider text-sm">DAILY 5</p>
            {setDisplayOverride(challengeSetId ?? status?.challenge?.setId) ? (
              <p className="text-sm text-muted-foreground" data-testid="text-d5-set-label">
                {applySetDisplayTitle(challengeSetId ?? status?.challenge?.setId, "")}
                {" · "}
                {applySetYearLabel(challengeSetId ?? status?.challenge?.setId, null)}
              </p>
            ) : null}
            <div className="grid grid-cols-3 gap-3 items-stretch max-w-md mx-auto" data-testid="grid-d5-final-stats">
              <div className="stat-tile h-full py-4 rounded-md bg-muted flex flex-col text-center">
                <p className="font-bold font-mono whitespace-nowrap leading-9" style={{ fontSize: statTileValueFontPx(d5Points) }} data-testid="text-d5-final-score">
                  {d5Points}
                </p>
                <p className="stat-tile-label text-muted-foreground whitespace-nowrap">PTS</p>
              </div>
              <div className="stat-tile h-full py-4 rounded-md bg-muted flex flex-col text-center">
                <p className="font-bold font-mono whitespace-nowrap leading-9" style={{ fontSize: statTileValueFontPx(d5Accuracy) }}>
                  {d5Accuracy}
                </p>
                <p className="stat-tile-label text-muted-foreground whitespace-nowrap">Accuracy</p>
              </div>
              <div className="stat-tile h-full py-4 rounded-md bg-muted flex flex-col text-center">
                <p className="font-bold font-mono whitespace-nowrap leading-9" style={{ fontSize: statTileValueFontPx(d5Fraction) }} data-testid="text-d5-final-correct">
                  {d5Fraction}
                </p>
                <p className="stat-tile-label text-muted-foreground whitespace-nowrap">Score</p>
              </div>
            </div>
            {beatMe?.status === "active" && (
              <div className="space-y-3 max-w-md mx-auto pt-2" data-testid="block-d5-beat-me-compare">
                <p className="text-base font-medium" data-testid="text-d5-beat-me-compare" style={{ color: "#F0F2F5" }}>
                  {formatBeatMeCompare(
                    finishResult?.correctCount ?? status?.entry?.correctCount ?? 0,
                    beatMe.correctCount,
                  )}
                </p>
                <p className="text-sm" style={{ color: "#8F96A3" }}>{BEAT_ME_COPY.wantMore}</p>
                <Link href={BEAT_ME_COPY.browseHref}>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    style={{ backgroundColor: "#161B24", borderColor: "#2A303C", color: "#F0F2F5" }}
                    data-testid="button-d5-beat-me-browse"
                  >
                    {BEAT_ME_COPY.browseSets}
                  </Button>
                </Link>
              </div>
            )}
            {finishResult?.rank && finishResult.rank > 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-d5-rank">
                Rank #{finishResult.rank}
              </p>
            )}
            {finishResult?.totalTime && finishResult.totalTime > 0 && (
              <p className="text-sm text-muted-foreground">
                Time: {formatDuration(finishResult.totalTime)}
              </p>
            )}
          </div>

          <ShareResultCard
            correctCount={finishResult?.correctCount ?? status?.entry?.correctCount ?? 0}
            date={status?.challenge?.date}
            challengeId={status?.challenge?.id}
            shareImageUrl={finishResult?.shareImageUrl}
            maskedCardUrls={[...cards].sort((a, b) => a.position - b.position).map((card) => card.imageUrl)}
          />

          <div className="space-y-3 mb-8 max-w-md mx-auto">
            {!isAuthenticated && <div className="flex justify-center"><EscrowHeldChip points={(guestGate ?? status?.anonGate)?.escrowPoints ?? 0} /></div>}
            <p className="text-sm text-muted-foreground text-center" data-testid="text-d5-next-play">
              {(guestGate ?? status?.anonGate)?.phase === "hard" ? null : DAILY5_NEXT_PLAY.doneNote}
            </p>
            {!isAuthenticated && (guestGate ?? status?.anonGate)?.phase === "hard" ? (
              <div data-testid="wall-anon-hard-gate">
                <AnonGatePlaque
                  variant="hard"
                  escrowPoints={(guestGate ?? status?.anonGate)?.escrowPoints ?? 0}
                  onCreate={() => {
                    setGateOpenOn("signup");
                    setShowGuestGate(true);
                  }}
                  onSignIn={() => {
                    setGateOpenOn("login");
                    setShowGuestGate(true);
                  }}
                />
              </div>
            ) : (
              <Link href={DAILY5_NEXT_PLAY.primary.href}>
                <Button size="lg" className={PLAY_AGAIN_BUTTON_CLASS} data-testid={DAILY5_NEXT_PLAY.primary.testId}>
                  <Play className="h-4 w-4" />
                  {DAILY5_NEXT_PLAY.primary.label}
                </Button>
              </Link>
            )}
            <Link href={DAILY5_NEXT_PLAY.secondary.href}>
              <Button variant="outline" size="lg" className={PLAY_AGAIN_BUTTON_CLASS} data-testid={DAILY5_NEXT_PLAY.secondary.testId}>
                <Compass className="h-4 w-4" />
                {DAILY5_NEXT_PLAY.secondary.label}
              </Button>
            </Link>
          </div>
          {!isAuthenticated && (
            <SignupModal
              open={showGuestGate}
              onOpenChange={setShowGuestGate}
              variant={(guestGate ?? status?.anonGate)?.phase === "hard" ? "hard" : "soft"}
              gateReason={(guestGate ?? status?.anonGate)?.reason}
              openOn={(guestGate ?? status?.anonGate)?.phase === "hard" ? gateOpenOn : "plaque"}
              pendingPoints={(guestGate ?? status?.anonGate)?.escrowPoints ?? 0}
            />
          )}

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                Today's Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lb && lb.entries.length > 0 ? (
                <div className="space-y-2">
                  {lb.entries.slice(0, 10).map((entry) => (
                    <div
                      key={entry.userId}
                      className={`flex items-center justify-between gap-2 p-2 rounded-md ${
                        entry.userId === user?.id ? "bg-primary/10" : ""
                      }`}
                      data-testid={`row-d5-lb-${entry.rank}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono w-6 text-muted-foreground">
                          {entry.rank <= 3 ? (
                            <Award className={`h-4 w-4 ${
                              entry.rank === 1 ? "text-yellow-500" :
                              entry.rank === 2 ? "text-gray-400" :
                              "text-amber-600"
                            }`} />
                          ) : (
                            `#${entry.rank}`
                          )}
                        </span>
                        <span className="font-medium">{entry.username}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{entry.correctCount}/5</span>
                        <span className="font-mono font-bold">{entry.score}</span>
                        {entry.timeMs && (
                          <span className="text-xs text-muted-foreground">{formatDuration(entry.timeMs)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No entries yet. Be the first!
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Link href="/" className="flex-1">
              <Button variant="outline" className="w-full min-h-11 gap-2" data-testid="button-d5-home">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Button>
            </Link>
            <Link href="/leaderboard" className="flex-1">
              <Button variant="outline" className="w-full min-h-11 gap-2" data-testid="button-d5-leaderboard">
                <Trophy className="h-4 w-4" />
                Leaderboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1 mb-4" data-testid="button-d5-back">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>

        {beatMe && !bannerHidden && (
          <BeatMeBanner challenge={beatMe} onDismiss={beatMe.status === "active" ? hideBeatMeBanner : undefined} />
        )}

        <Card className="mb-6">
          <CardHeader className="text-center">
            <div className="inline-flex p-4 rounded-full bg-primary/10 mx-auto mb-2">
              <Calendar className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-2xl" data-testid="text-d5-title">Daily 5 Challenge</CardTitle>
            <CardDescription>
              Same 5 cards for everyone. Once per day. How do you stack up?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status?.challenge ? (
              <>
                <div className="flex justify-center gap-6 text-center">
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-mono font-bold">{status.challenge.date}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={
                      status.challenge.status === "ACTIVE" ? "default" :
                      status.challenge.status === "CLOSED" ? "secondary" : "outline"
                    }>
                      {status.challenge.status}
                    </Badge>
                  </div>
                </div>

                {status.challenge.status === "SCHEDULED" && status.timeUntilStart > 0 && (
                  <CountdownTimer
                    targetMs={status.timeUntilStart}
                    label="Challenge starts in"
                  />
                )}

                {status.challenge.status === "ACTIVE" && !status.hasPlayed && (
                  <div className="space-y-4">
                    {status.timeUntilEnd > 0 && (
                      <CountdownTimer
                        targetMs={status.timeUntilEnd}
                        label="Time remaining"
                      />
                    )}
                    {!user && (guestGate ?? status.anonGate)?.phase === "hard" ? (
                      <div data-testid="wall-anon-hard-gate">
                        <AnonGatePlaque
                          variant="hard"
                          escrowPoints={(guestGate ?? status.anonGate)?.escrowPoints ?? 0}
                          onCreate={() => {
                            setGateOpenOn("signup");
                            setShowGuestGate(true);
                          }}
                          onSignIn={() => {
                            setGateOpenOn("login");
                            setShowGuestGate(true);
                          }}
                        />
                      </div>
                    ) : (
                      <>
                      <Button
                        className="w-full gap-2 min-h-11"
                        onClick={() => startMutation.mutate()}
                        disabled={startMutation.isPending}
                        data-testid="button-d5-start"
                      >
                        {startMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Start Challenge
                      </Button>
                      </>
                    )}
                  </div>
                )}

                {status.challenge.status === "CLOSED" && (
                  <p className="text-center text-sm text-muted-foreground">
                    Today's challenge has ended. Come back tomorrow!
                  </p>
                )}
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                No challenge available. Check back later!
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Leaderboard
            </CardTitle>
            <CardDescription>
              {leaderboardQuery.data?.totalEntries || 0} players today
            </CardDescription>
          </CardHeader>
          <CardContent>
            {leaderboardQuery.isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : leaderboardQuery.data && leaderboardQuery.data.entries.length > 0 ? (
              <div className="space-y-2">
                {leaderboardQuery.data.entries.slice(0, 20).map((entry) => (
                  <div
                    key={entry.userId}
                    className={`flex items-center justify-between gap-2 p-2 rounded-md ${
                      entry.userId === user?.id ? "bg-primary/10" : ""
                    }`}
                    data-testid={`row-d5-preview-lb-${entry.rank}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono w-6 text-muted-foreground">
                        {entry.rank <= 3 ? (
                          <Award className={`h-4 w-4 ${
                            entry.rank === 1 ? "text-yellow-500" :
                            entry.rank === 2 ? "text-gray-400" :
                            "text-amber-600"
                          }`} />
                        ) : (
                          `#${entry.rank}`
                        )}
                      </span>
                      <span className="font-medium">{entry.username}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">{entry.correctCount}/5</span>
                      <span className="font-mono font-bold">{entry.score}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No entries yet today.
              </p>
            )}
          </CardContent>
        </Card>
        {!isAuthenticated && (
          <SignupModal
            open={showGuestGate}
            onOpenChange={setShowGuestGate}
            variant="hard"
            gateReason={(guestGate ?? status?.anonGate)?.reason}
            openOn={gateOpenOn}
            pendingPoints={(guestGate ?? status?.anonGate)?.escrowPoints ?? 0}
          />
        )}
      </div>
    </div>
  );
}