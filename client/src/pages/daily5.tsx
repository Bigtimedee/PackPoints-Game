import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { GameCard } from "@/components/GameCard";
import {
  Calendar, Clock, Trophy, ArrowLeft, Check, X, Loader2,
  Play, Award, Timer, Users, Crown, Share2
} from "lucide-react";

interface Daily5Status {
  challenge: {
    id: string;
    date: string;
    status: "SCHEDULED" | "ACTIVE" | "CLOSED";
    startsAt: string;
    endsAt: string;
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
}

interface Daily5Card {
  position: number;
  cardId: string;
  imageUrl: string;
  choices: string[];
  pointValue: number;
}

interface AnswerResult {
  correct: boolean;
  pointsEarned: number;
  score: number;
  correctCount: number;
}

interface FinishResult {
  score: number;
  correctCount: number;
  totalTime: number;
  rank: number;
  flagged?: boolean;
  correctAnswers?: { position: number; correctAnswer: string }[];
  pointsCredited?: number;
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

function ShareResultCard({ score, correctCount, rank, date }: {
  score: number;
  correctCount: number;
  rank?: number;
  date?: string;
}) {
  const { toast } = useToast();
  const [shared, setShared] = useState(false);

  const dateStr = date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const shareGrid = Array.from({ length: 5 }, (_, i) =>
    i < correctCount ? "[+]" : "[-]"
  ).join(" ");

  const shareText = [
    `PackPTS Daily 5 - ${dateStr}`,
    shareGrid,
    `Score: ${score} pts | ${correctCount}/5 correct`,
    rank && rank > 0 ? `Rank: #${rank}` : null,
    "",
    "Play at packpts.com",
  ].filter(Boolean).join("\n");

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        setShared(true);
        setTimeout(() => setShared(false), 3000);
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setShared(true);
      toast({ title: "Copied to clipboard", description: "Share your result with friends!" });
      setTimeout(() => setShared(false), 3000);
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  const resultIcons = Array.from({ length: 5 }, (_, i) => i < correctCount);

  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="text-center space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">PackPTS Daily 5 - {dateStr}</p>
          <div className="flex justify-center gap-2" data-testid="text-d5-share-grid">
            {resultIcons.map((correct, i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded-md flex items-center justify-center ${
                  correct ? "bg-green-500/20 text-green-600 dark:text-green-400" : "bg-destructive/20 text-destructive"
                }`}
                data-testid={`icon-d5-result-${i}`}>
                {correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-4">
            <div>
              <span className="font-bold font-mono">{score}</span>
              <span className="text-xs text-muted-foreground ml-1">pts</span>
            </div>
            <div>
              <span className="font-bold font-mono">{correctCount}/5</span>
              <span className="text-xs text-muted-foreground ml-1">correct</span>
            </div>
            {rank && rank > 0 && (
              <div>
                <span className="font-bold font-mono">#{rank}</span>
                <span className="text-xs text-muted-foreground ml-1">rank</span>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="gap-2"
            data-testid="button-d5-share">
            {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {shared ? "Shared" : "Share Result"}
          </Button>
        </div>
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
  const { user } = useAuth();
  const [gameState, setGameState] = useState<"loading" | "preview" | "playing" | "results">("loading");
  const [cards, setCards] = useState<Daily5Card[]>([]);
  const [currentPosition, setCurrentPosition] = useState(1);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [challengeId, setChallengeId] = useState<string>("");
  const [entryId, setEntryId] = useState<string>("");

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

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/daily5/start"),
    onSuccess: async (res) => {
      const data = await res.json();
      setCards(data.cards);
      setChallengeId(data.entry.dailyChallengeId);
      setEntryId(data.entry.id);
      setCurrentPosition(1);
      setScore(0);
      setCorrectCount(0);
      setGameState("playing");
    },
    onError: (err: any) => {
      toast({ title: "Cannot start", description: err.message || "Failed to start Daily 5", variant: "destructive" });
    },
  });

  const answerMutation = useMutation({
    mutationFn: (data: { challengeId: string; position: number; selectedAnswer: string }) =>
      apiRequest("POST", "/api/daily5/answer", data),
    onSuccess: async (res) => {
      const data: AnswerResult = await res.json();
      setAnswerResult(data);
      setIsRevealed(true);
      setScore(data.score);
      setCorrectCount(data.correctCount);
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
      setGameState("results");
      queryClient.invalidateQueries({ queryKey: ["/api/daily5/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily5/leaderboard"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to finish", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    const status = statusQuery.data;
    if (status.hasPlayed && status.entry?.completedAt) {
      setFinishResult({
        score: status.entry.score,
        correctCount: status.entry.correctCount,
        totalTime: 0,
        rank: 0,
      });
      setGameState("results");
    } else if (status.entry && !status.entry.completedAt && status.challenge?.status === "ACTIVE") {
      setGameState("playing");
      if (cards.length === 0) {
        startMutation.mutate();
      }
    } else {
      setGameState("preview");
    }
  }, [statusQuery.data]);

  const handleSubmitAnswer = useCallback(() => {
    if (!selectedAnswer || !challengeId) return;
    answerMutation.mutate({ challengeId, position: currentPosition, selectedAnswer });
  }, [selectedAnswer, challengeId, currentPosition]);

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

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (gameState === "playing" && currentCard) {
    return (
      <div className="min-h-screen pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-4 max-w-2xl">
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <Badge variant="outline" className="gap-1.5">
              <Calendar className="h-3 w-3" />
              Daily 5
            </Badge>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" data-testid="text-d5-score">{score} pts</Badge>
              <span className="text-sm text-muted-foreground" data-testid="text-d5-progress">
                {currentPosition}/5
              </span>
            </div>
          </div>
          <Progress value={(currentPosition - 1) / 5 * 100 + (isRevealed ? 20 : 0)} className="mb-4" />

          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-full max-w-xs aspect-[3/4] relative">
                <GameCard
                  imageUrl={currentCard.imageUrl}
                  isRevealed={isRevealed}
                  imageRotation={0}
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
                  disabled={!selectedAnswer || answerMutation.isPending}
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
    return (
      <div className="min-h-screen pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="text-center space-y-4 mb-8">
            <div className="inline-flex p-4 rounded-full bg-primary/10">
              <Trophy className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-3xl font-bold" data-testid="text-d5-complete">Daily 5 Complete</h1>
            <div className="flex justify-center gap-6">
              <div className="text-center">
                <p className="text-3xl font-bold font-mono" data-testid="text-d5-final-score">
                  {finishResult?.score ?? status?.entry?.score ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Points</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold font-mono" data-testid="text-d5-final-correct">
                  {finishResult?.correctCount ?? status?.entry?.correctCount ?? 0}/5
                </p>
                <p className="text-sm text-muted-foreground">Correct</p>
              </div>
              {finishResult?.rank && finishResult.rank > 0 && (
                <div className="text-center">
                  <p className="text-3xl font-bold font-mono" data-testid="text-d5-rank">
                    #{finishResult.rank}
                  </p>
                  <p className="text-sm text-muted-foreground">Rank</p>
                </div>
              )}
            </div>
            {finishResult?.totalTime && finishResult.totalTime > 0 && (
              <p className="text-sm text-muted-foreground">
                Time: {formatDuration(finishResult.totalTime)}
              </p>
            )}
          </div>

          <ShareResultCard
            score={finishResult?.score ?? status?.entry?.score ?? 0}
            correctCount={finishResult?.correctCount ?? status?.entry?.correctCount ?? 0}
            rank={finishResult?.rank}
            date={status?.challenge?.date}
          />

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
              <Button variant="outline" className="w-full gap-2" data-testid="button-d5-home">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Button>
            </Link>
            <Link href="/leaderboard" className="flex-1">
              <Button variant="outline" className="w-full gap-2" data-testid="button-d5-leaderboard">
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
                    {!user ? (
                      <div className="text-center space-y-2">
                        <p className="text-sm text-muted-foreground">Sign in to play the Daily 5</p>
                        <Link href="/auth">
                          <Button data-testid="button-d5-signin">Sign In to Play</Button>
                        </Link>
                      </div>
                    ) : (
                      <Button
                        className="w-full gap-2"
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
      </div>
    </div>
  );
}