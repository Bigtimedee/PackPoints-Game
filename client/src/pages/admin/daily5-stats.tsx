import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, AlertTriangle, Trophy, Timer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

interface Daily5Stats {
  todayParticipants: number;
  todayFlagged: number;
  flaggedEntries: {
    userId: string;
    username: string;
    date: string;
    score: number;
    correctCount: number;
    timeMs: number | null;
    flagReason: string | null;
  }[];
  perfectStreaks: {
    userId: string;
    username: string;
    streak: number;
  }[];
  fastestCompletions: {
    userId: string;
    username: string;
    date: string;
    timeMs: number;
    correctCount: number;
  }[];
}

function formatTime(ms: number | null): string {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export default function AdminDaily5Stats() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const { data, isLoading } = useQuery<Daily5Stats>({
    queryKey: ["/api/admin/daily5/stats"],
    enabled: isAuthenticated && user?.isAdmin,
    refetchInterval: 60000,
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loader-daily5-stats" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="admin-daily5-stats">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")} data-testid="button-back-dashboard">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">Daily 5 Monitoring</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Participants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-d5-today-participants">{data.todayParticipants}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Flagged</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-d5-today-flagged">
              {data.todayFlagged}
              {data.todayFlagged > 0 && (
                <Badge variant="destructive" className="ml-2">Needs Review</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Flagged Entries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.flaggedEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-d5-no-flags">No flagged entries</p>
          ) : (
            <div className="space-y-2">
              {data.flaggedEntries.map((entry, i) => (
                <div key={`${entry.userId}-${entry.date}`} className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50 flex-wrap" data-testid={`row-d5-flagged-${i}`}>
                  <div className="space-y-1">
                    <div className="font-medium text-sm">{entry.username}</div>
                    <div className="text-xs text-muted-foreground">{entry.date}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="outline">{entry.correctCount}/5</Badge>
                    <Badge variant="outline">{entry.score} pts</Badge>
                    <Badge variant="outline">{formatTime(entry.timeMs)}</Badge>
                    <Badge variant="destructive" className="text-xs">{entry.flagReason}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Perfect Score Streaks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.perfectStreaks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notable streaks</p>
            ) : (
              <div className="space-y-2">
                {data.perfectStreaks.map((s, i) => (
                  <div key={s.userId} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50" data-testid={`row-d5-streak-${i}`}>
                    <span className="text-sm font-medium">{s.username}</span>
                    <Badge variant="secondary">{s.streak} perfect games (last 10)</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              Fastest Completions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.fastestCompletions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completions yet</p>
            ) : (
              <div className="space-y-2">
                {data.fastestCompletions.map((f, i) => (
                  <div key={`${f.userId}-${f.date}`} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50" data-testid={`row-d5-fast-${i}`}>
                    <div>
                      <span className="text-sm font-medium">{f.username}</span>
                      <span className="text-xs text-muted-foreground ml-2">{f.date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{f.correctCount}/5</Badge>
                      <Badge variant="secondary">{formatTime(f.timeMs)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
