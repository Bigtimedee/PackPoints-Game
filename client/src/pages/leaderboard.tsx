import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, Award, Zap, Target } from "lucide-react";
import type { LeaderboardEntry } from "@shared/schema";

function PodiumCard({ entry, position }: { entry: LeaderboardEntry; position: 1 | 2 | 3 }) {
  const icons = {
    1: Trophy,
    2: Medal,
    3: Award,
  };
  const colors = {
    1: "text-yellow-500",
    2: "text-gray-400",
    3: "text-amber-600",
  };
  const sizes = {
    1: "h-32",
    2: "h-24",
    3: "h-20",
  };

  const Icon = icons[position];

  return (
    <div className={`flex flex-col items-center ${position === 1 ? "order-2" : position === 2 ? "order-1" : "order-3"}`}>
      <Card className="w-full max-w-[140px] text-center">
        <CardContent className="p-4 space-y-3">
          <div className="relative mx-auto w-fit">
            <Avatar className="h-16 w-16 border-2 border-card-border">
              <AvatarFallback className="text-lg font-bold bg-primary/10 text-primary">
                {entry.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className={`absolute -top-1 -right-1 ${colors[position]}`}>
              <Icon className="h-6 w-6" />
            </div>
          </div>
          <div>
            <p className="font-semibold truncate" data-testid={`text-podium-username-${position}`}>{entry.username}</p>
            <p className="text-sm font-mono text-muted-foreground" data-testid={`text-podium-points-${position}`}>
              {entry.points.toLocaleString()} pts
            </p>
          </div>
        </CardContent>
      </Card>
      <div className={`w-20 ${sizes[position]} bg-gradient-to-t from-primary/20 to-primary/5 rounded-t-md mt-2 flex items-end justify-center pb-2`}>
        <span className="text-2xl font-bold text-primary">{position}</span>
      </div>
    </div>
  );
}

function LeaderboardRow({ entry, isCurrentUser }: { entry: LeaderboardEntry; isCurrentUser?: boolean }) {
  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-md ${
        isCurrentUser ? "bg-primary/10 border border-primary/20" : "bg-muted/50"
      }`}
      data-testid={`row-leaderboard-${entry.rank}`}
    >
      <div className="w-8 text-center font-mono font-bold text-muted-foreground">
        #{entry.rank}
      </div>
      <Avatar className="h-10 w-10">
        <AvatarFallback className="bg-primary/10 text-primary font-semibold">
          {entry.username.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">{entry.username}</p>
        <p className="text-sm text-muted-foreground">{entry.gamesPlayed} games</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground">
          <Target className="h-4 w-4" />
          {entry.accuracy}%
        </div>
        <Badge variant="secondary" className="font-mono gap-1">
          <Zap className="h-3 w-3" />
          {entry.points.toLocaleString()}
        </Badge>
      </div>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-md bg-muted/50">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function Leaderboard() {
  const { data: leaderboard, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard"],
  });

  const topThree = leaderboard?.slice(0, 3) || [];
  const rest = leaderboard?.slice(3) || [];

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="text-center space-y-2 mb-8">
          <h1 className="text-3xl font-bold" data-testid="text-leaderboard-title">Leaderboard</h1>
          <p className="text-muted-foreground">Top collectors ranked by PackPTS</p>
        </div>

        {isLoading ? (
          <LeaderboardSkeleton />
        ) : leaderboard && leaderboard.length > 0 ? (
          <>
            <div className="flex items-end justify-center gap-4 mb-12">
              {topThree.length >= 2 && <PodiumCard entry={topThree[1]} position={2} />}
              {topThree.length >= 1 && <PodiumCard entry={topThree[0]} position={1} />}
              {topThree.length >= 3 && <PodiumCard entry={topThree[2]} position={3} />}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">All Rankings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {rest.map((entry) => (
                  <LeaderboardRow key={entry.rank} entry={entry} />
                ))}
                {rest.length === 0 && topThree.length > 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    More players coming soon!
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="p-12 text-center space-y-4">
              <Trophy className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="font-semibold text-lg">No Rankings Yet</h3>
                <p className="text-muted-foreground">Be the first to play and claim the top spot!</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
