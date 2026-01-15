import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Trophy, Target, Clock, Star, TrendingUp, Settings } from "lucide-react";
import { StreakCard, StreakCalendar } from "@/components/streak-card";

interface ProfileStats {
  username: string;
  email: string;
  points: number;
  gamesPlayed: number;
  correctAnswers: number;
  totalAnswers: number;
  rank: number;
  level: number;
  pointsToNextLevel: number;
  levelProgress: number;
  createdAt: string;
}

function StatCard({ icon: Icon, label, value, subtext }: { icon: typeof Zap; label: string; value: string; subtext?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold font-mono">{value}</p>
            {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function Profile() {
  const { data: stats, isLoading, error } = useQuery<ProfileStats>({
    queryKey: ["/api/profile/stats"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <ProfileSkeleton />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">Please log in to view your profile.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const username = stats.username || "Player";
  const memberSince = stats.createdAt 
    ? new Date(stats.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : "Recently";

  const accuracy = stats.totalAnswers > 0 
    ? Math.round((stats.correctAnswers / stats.totalAnswers) * 100)
    : 0;

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card className="mb-8">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
              <Avatar className="h-24 w-24 border-4 border-primary/20">
                <AvatarFallback className="text-3xl font-bold bg-primary/10 text-primary">
                  {username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-center md:text-left space-y-3">
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <h1 className="text-2xl font-bold" data-testid="text-profile-username">{username}</h1>
                  <Badge variant="secondary" className="w-fit mx-auto md:mx-0">
                    Level {stats.level}
                  </Badge>
                </div>
                <div className="flex flex-col md:flex-row items-center md:items-start gap-3">
                  <p className="text-muted-foreground">Collecting since {memberSince}</p>
                  <StreakCalendar />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Progress to Level {stats.level + 1}</span>
                    <span className="font-mono text-muted-foreground">{stats.pointsToNextLevel} pts to go</span>
                  </div>
                  <Progress value={stats.levelProgress} className="h-2" data-testid="progress-level" />
                </div>
              </div>
              <Button variant="outline" size="icon" data-testid="button-settings">
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="mb-8">
          <StreakCard />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div data-testid="stat-card-points">
            <StatCard 
              icon={Zap} 
              label="Total Points" 
              value={stats.points.toLocaleString()} 
            />
          </div>
          <div data-testid="stat-card-games">
            <StatCard 
              icon={Trophy} 
              label="Games Played" 
              value={stats.gamesPlayed.toString()} 
            />
          </div>
          <div data-testid="stat-card-accuracy">
            <StatCard 
              icon={Target} 
              label="Accuracy" 
              value={`${accuracy}%`}
              subtext={`${stats.correctAnswers}/${stats.totalAnswers} correct`}
            />
          </div>
          <div data-testid="stat-card-rank">
            <StatCard 
              icon={TrendingUp} 
              label="Global Rank" 
              value={`#${stats.rank}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Star className="h-5 w-5 text-primary" />
                Achievements
              </CardTitle>
              <CardDescription>Your collecting milestones</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
                  <Trophy className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">First Win</p>
                  <p className="text-sm text-muted-foreground">Won your first game</p>
                </div>
                <Badge variant="outline" className="text-xs">Earned</Badge>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
                  <Target className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Sharp Eye</p>
                  <p className="text-sm text-muted-foreground">90% accuracy in a game</p>
                </div>
                <Badge variant="outline" className="text-xs">Earned</Badge>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30 opacity-60">
                <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Point Master</p>
                  <p className="text-sm text-muted-foreground">Earn 10,000 total points</p>
                </div>
                <Badge variant="secondary" className="text-xs">Locked</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Recent Games
              </CardTitle>
              <CardDescription>Your latest performances</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50">
                <div>
                  <p className="font-medium">Solo Challenge</p>
                  <p className="text-sm text-muted-foreground">Today at 2:30 PM</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold text-accent">+250 pts</p>
                  <p className="text-sm text-muted-foreground">8/10 correct</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50">
                <div>
                  <p className="font-medium">Solo Challenge</p>
                  <p className="text-sm text-muted-foreground">Yesterday at 5:15 PM</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold text-accent">+180 pts</p>
                  <p className="text-sm text-muted-foreground">7/10 correct</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50">
                <div>
                  <p className="font-medium">Solo Challenge</p>
                  <p className="text-sm text-muted-foreground">Jan 1 at 10:00 AM</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold text-accent">+320 pts</p>
                  <p className="text-sm text-muted-foreground">9/10 correct</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
