import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Trophy, Target, Clock, TrendingUp, Settings, Paintbrush, Users, Hash } from "lucide-react";
import { StreakCard, StreakCalendar } from "@/components/streak-card";
import { FoundersPassCard } from "@/components/founders-pass-card";
import { AchievementBadges } from "@/components/AchievementBadges";

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

interface MySet {
  id: string;
  setName: string;
  sport: string;
  brand: string;
  year: number;
  makerNote: string | null;
  cardCount: number;
  playCount: number;
  createdAt: string;
}

function MySetsPanel() {
  const [, navigate] = useLocation();
  const { data: sets, isLoading } = useQuery<MySet[]>({
    queryKey: ["/api/my-sets"],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!sets?.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <Paintbrush className="h-10 w-10 text-muted-foreground/50" />
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">No sets yet</p>
            <p className="text-sm text-muted-foreground">Upload card photos to build your first playable set.</p>
          </div>
          <Button onClick={() => navigate("/make")} size="sm">Make a Set</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sets.map(set => (
        <Link key={set.id} href={`/sets/${set.id}`}>
          <Card className="hover:border-primary/40 transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-semibold truncate">{set.setName}</p>
                  {set.makerNote && (
                    <p className="text-xs text-muted-foreground italic line-clamp-1">"{set.makerNote}"</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Hash className="h-3 w-3" />{Number(set.cardCount)} cards</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{Number(set.playCount)} plays</span>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-xs capitalize">{set.sport}</Badge>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
      <Button variant="outline" className="w-full" onClick={() => navigate("/make")}>
        <Paintbrush className="mr-2 h-4 w-4" /> Make Another Set
      </Button>
    </div>
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
  const [, navigate] = useLocation();
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
              <Button variant="outline" size="icon" aria-label="Open settings" data-testid="button-settings">
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="stats" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="my-sets" className="flex items-center gap-1">
              <Paintbrush className="h-3 w-3" /> My Sets
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="space-y-8">
            <StreakCard />
            <AchievementBadges stats={{
              gamesPlayed: stats.gamesPlayed,
              correctAnswers: stats.correctAnswers,
              totalAnswers: stats.totalAnswers,
              points: stats.points,
            }} />
            <FoundersPassCard />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div data-testid="stat-card-points">
                <StatCard icon={Zap} label="Total Points" value={stats.points.toLocaleString()} />
              </div>
              <div data-testid="stat-card-games">
                <StatCard icon={Trophy} label="Games Played" value={stats.gamesPlayed.toString()} />
              </div>
              <div data-testid="stat-card-accuracy">
                <StatCard icon={Target} label="Accuracy" value={`${accuracy}%`} subtext={`${stats.correctAnswers}/${stats.totalAnswers} correct`} />
              </div>
              <div data-testid="stat-card-rank">
                <StatCard icon={TrendingUp} label="Global Rank" value={`#${stats.rank}`} />
              </div>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Recent Games
                </CardTitle>
                <CardDescription>Your latest performances</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                  <Trophy className="h-10 w-10 text-muted-foreground/50" />
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">No recent games yet</p>
                    <p className="text-sm text-muted-foreground">Play a match and your results will appear here.</p>
                  </div>
                  <Button onClick={() => navigate("/")} variant="outline" size="sm">Play Now</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="my-sets">
            <MySetsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
