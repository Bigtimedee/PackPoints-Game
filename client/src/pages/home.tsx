import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Monitor, Users, Trophy, Zap, Star, Clock } from "lucide-react";

const gameModes = [
  {
    id: "solo",
    title: "1v Computer",
    description: "Test your knowledge against the clock. Earn points for each correct guess.",
    icon: Monitor,
    href: "/game/solo",
    badge: "Popular",
    badgeVariant: "default" as const,
    pointRange: "50-500 pts",
    difficulty: "All Levels",
  },
  {
    id: "1v1",
    title: "1v1 Battle",
    description: "Challenge a friend head-to-head. Both players guess the same cards!",
    icon: Users,
    href: "/lobby",
    badge: "New",
    badgeVariant: "default" as const,
    pointRange: "100-1000 pts",
    difficulty: "Competitive",
    disabled: false,
  },
  {
    id: "tournament",
    title: "Tournament",
    description: "Join 8-player tournaments. Climb the bracket and claim the grand prize.",
    icon: Trophy,
    href: "/game/tournament",
    badge: "Coming Soon",
    badgeVariant: "secondary" as const,
    pointRange: "500-5000 pts",
    difficulty: "Expert",
    disabled: true,
  },
];

const quickStats = [
  { label: "Total Games Played", value: "2,847", icon: Star },
  { label: "Cards Guessed", value: "12,493", icon: Zap },
  { label: "Avg Response Time", value: "3.2s", icon: Clock },
];

export default function Home() {
  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <section className="relative overflow-hidden py-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/10" />
        <div className="container mx-auto relative">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge variant="outline" className="gap-1.5 px-3 py-1">
              <Star className="h-3 w-3" />
              1987 Topps Collection
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight" data-testid="text-hero-title">
              Know Your Cards.{" "}
              <span className="text-primary">Earn Your Points.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto" data-testid="text-hero-description">
              The ultimate trivia game for baseball card collectors. Guess the player on classic 1987 Topps cards, 
              earn PackPoints, and redeem them for credits on Goldin and eBay.
            </p>
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <Link href="/game/solo">
                <Button size="lg" className="gap-2" data-testid="button-play-now">
                  <Zap className="h-5 w-5" />
                  Play Now
                </Button>
              </Link>
              <Link href="/leaderboard">
                <Button size="lg" variant="outline" className="gap-2" data-testid="button-view-leaderboard">
                  <Trophy className="h-5 w-5" />
                  View Leaderboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
          {quickStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-mono" data-testid={`text-stat-${stat.label.toLowerCase().replace(/\s/g, '-')}`}>{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold" data-testid="text-game-modes-title">Choose Your Game Mode</h2>
            <p className="text-muted-foreground">Pick a challenge that matches your skill level</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {gameModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <Card
                  key={mode.id}
                  className={`relative overflow-visible transition-transform ${
                    mode.disabled ? "opacity-60" : "hover-elevate cursor-pointer"
                  }`}
                  data-testid={`card-game-mode-${mode.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="p-3 rounded-md bg-primary/10 w-fit">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <Badge variant={mode.badgeVariant}>{mode.badge}</Badge>
                    </div>
                    <CardTitle className="text-xl">{mode.title}</CardTitle>
                    <CardDescription>{mode.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{mode.pointRange}</Badge>
                      <Badge variant="outline">{mode.difficulty}</Badge>
                    </div>
                    {mode.disabled ? (
                      <Button disabled className="w-full" data-testid={`button-${mode.id}-disabled`}>
                        Coming Soon
                      </Button>
                    ) : (
                      <Link href={mode.href}>
                        <Button className="w-full gap-2" data-testid={`button-${mode.id}-play`}>
                          <Zap className="h-4 w-4" />
                          Start Game
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <Card>
          <CardContent className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
              <div className="space-y-2">
                <div className="flex items-center justify-center md:justify-start gap-2 text-primary font-semibold">
                  <span className="text-2xl font-bold">1</span>
                  <span>Guess the Player</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  A 1987 Topps card appears with the name hidden. Choose the correct player from 4 options.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-center md:justify-start gap-2 text-primary font-semibold">
                  <span className="text-2xl font-bold">2</span>
                  <span>Earn Points</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Popular players = fewer points. Obscure players = more points. Test your deep knowledge.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-center md:justify-start gap-2 text-primary font-semibold">
                  <span className="text-2xl font-bold">3</span>
                  <span>Redeem Rewards</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Cash out PackPoints for real cards on Goldin or eBay, or keep climbing the ranks.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
