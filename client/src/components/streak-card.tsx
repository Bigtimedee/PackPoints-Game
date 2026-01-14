import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Flame, Snowflake, Clock, Trophy, Gift } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StreakInfo {
  currentDays: number;
  longestDays: number;
  lastActiveLocalDate: string | null;
  status: string;
  freezesAvailable: number;
  todayClaimed: boolean;
  nextReward: number;
  nextMilestone: { day: number; bonus: number } | null;
  timeUntilReset: number;
  recentDays: { date: string; claimed: boolean }[];
}

function formatTimeUntilReset(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function StreakCard() {
  const { data: streak, isLoading, error } = useQuery<StreakInfo>({
    queryKey: ["/api/streak"],
  });

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (error || !streak) {
    return (
      <Card className="w-full" data-testid="card-streak-error">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold text-muted-foreground">Daily Streak</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Play a game to start your streak!</p>
        </CardContent>
      </Card>
    );
  }

  const progressToNextMilestone = streak.nextMilestone
    ? ((streak.currentDays % 7) / 7) * 100
    : 0;

  return (
    <Card className="w-full" data-testid="card-streak">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-lg font-semibold">Daily Streak</CardTitle>
        </div>
        {streak.freezesAvailable > 0 && (
          <Badge variant="secondary" className="flex items-center gap-1" data-testid="badge-freezes">
            <Snowflake className="h-3 w-3" />
            {streak.freezesAvailable}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-mono text-orange-500" data-testid="text-current-streak">
              {streak.currentDays}
            </span>
            <span className="text-muted-foreground text-sm">day{streak.currentDays !== 1 ? "s" : ""}</span>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <Trophy className="h-3 w-3" />
              <span>Best: {streak.longestDays}</span>
            </div>
          </div>
        </div>

        {streak.todayClaimed ? (
          <Badge variant="default" className="w-full justify-center py-1" data-testid="badge-today-claimed">
            Today's streak claimed
          </Badge>
        ) : (
          <Badge variant="outline" className="w-full justify-center py-1 border-dashed" data-testid="badge-play-now">
            <Gift className="h-3 w-3 mr-1" />
            Play a match for +{streak.nextReward} PackPTS
          </Badge>
        )}

        {streak.nextMilestone && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Next milestone: Day {streak.nextMilestone.day}</span>
              <span className="text-primary font-medium">+{streak.nextMilestone.bonus.toLocaleString()} bonus</span>
            </div>
            <Progress value={progressToNextMilestone} className="h-2" data-testid="progress-milestone" />
          </div>
        )}

        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground pt-1">
          <Clock className="h-3 w-3" />
          <span>Resets in {formatTimeUntilReset(streak.timeUntilReset)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function StreakCalendar() {
  const { data: streak, isLoading } = useQuery<StreakInfo>({
    queryKey: ["/api/streak"],
  });

  if (isLoading || !streak) {
    return null;
  }

  return (
    <div className="flex items-center gap-1" data-testid="streak-calendar">
      {streak.recentDays.map((day, index) => {
        const date = new Date(day.date + "T12:00:00Z");
        const dayName = date.toLocaleDateString("en-US", { weekday: "short" }).charAt(0);
        
        return (
          <div
            key={day.date}
            className={`flex flex-col items-center gap-0.5 ${index === streak.recentDays.length - 1 ? "ring-2 ring-primary/50 rounded-md" : ""}`}
            data-testid={`calendar-day-${day.date}`}
          >
            <span className="text-[10px] text-muted-foreground">{dayName}</span>
            <div
              className={`w-6 h-6 rounded-md flex items-center justify-center ${
                day.claimed
                  ? "bg-orange-500 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {day.claimed ? (
                <Flame className="h-3 w-3" />
              ) : (
                <span className="text-xs">{date.getDate()}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StreakBadge() {
  const { data: streak, isLoading } = useQuery<StreakInfo>({
    queryKey: ["/api/streak"],
  });

  if (isLoading || !streak || streak.currentDays === 0) {
    return null;
  }

  return (
    <Badge variant="outline" className="flex items-center gap-1 text-orange-500 border-orange-500/30" data-testid="badge-streak-mini">
      <Flame className="h-3 w-3" />
      <span className="font-mono">{streak.currentDays}</span>
    </Badge>
  );
}
