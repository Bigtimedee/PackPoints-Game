import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Monitor, Users, Trophy, Zap, Star, Shuffle, Calendar, MessageCircle, Flame, Gift, UserPlus, Play, X, Paintbrush } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { FoundersCounter } from "@/components/founders-counter";
import { OnboardingModal } from "@/components/OnboardingModal";
import { apiRequest } from "@/lib/queryClient";

function SetOfWeekBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery<{ active: { setName?: string; brand?: string; year?: number; multiplier: number } | null }>({
    queryKey: ["/api/set-of-week/active"],
    staleTime: 60_000,
  });

  if (dismissed || !data?.active) return null;

  const { setName, brand, year, multiplier } = data.active;
  const label = [year, brand, setName].filter(Boolean).join(" ");

  return (
    <div className="bg-gradient-to-r from-yellow-500 to-amber-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
      <span>⭐ SET OF THE WEEK: {label} — {multiplier}x PTS</span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// A/B test: hero CTA variants
const AB_STORAGE_KEY = "pp_hero_cta_variant";
const AB_VARIANTS = ["A", "B"] as const;
type HeroCTAVariant = typeof AB_VARIANTS[number];

function getOrAssignVariant(): HeroCTAVariant {
  try {
    const stored = localStorage.getItem(AB_STORAGE_KEY);
    if (stored === "A" || stored === "B") return stored;
    const variant: HeroCTAVariant = Math.random() < 0.5 ? "A" : "B";
    localStorage.setItem(AB_STORAGE_KEY, variant);
    return variant;
  } catch {
    return "A";
  }
}

function logAbEvent(event: "impression" | "click", variant: HeroCTAVariant) {
  apiRequest("POST", "/api/ab-events", { test: "hero_cta", variant, event }).catch(() => {});
}

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
    id: "1v1-friend",
    title: "1v1 Friend",
    description: "Challenge a friend head-to-head. Share a code and compete!",
    icon: Users,
    href: "/lobby",
    badge: "Multiplayer",
    badgeVariant: "default" as const,
    pointRange: "100-1000 pts",
    difficulty: "Competitive",
    disabled: false,
  },
  {
    id: "1v1-random",
    title: "1v1 Random",
    description: "Find a random opponent online. Quick matchmaking, instant action!",
    icon: Shuffle,
    href: "/queue",
    badge: "New",
    badgeVariant: "default" as const,
    pointRange: "100-1000 pts",
    difficulty: "Competitive",
    disabled: false,
  },
  {
    id: "daily5",
    title: "Daily 5",
    description: "Same 5 cards for everyone, once per day. Compete on the daily leaderboard!",
    icon: Calendar,
    href: "/daily5",
    badge: "New",
    badgeVariant: "default" as const,
    pointRange: "Up to 500 pts",
    difficulty: "Everyone",
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
  {
    id: "make",
    title: "Make a Set",
    description: "Upload photos of your cards and build a playable set for others to guess.",
    icon: Paintbrush,
    href: "/make",
    badge: "New",
    badgeVariant: "default" as const,
    pointRange: "—",
    difficulty: "Creators",
    disabled: false,
  },
];

function PromotionBanner() {
  const { data: promotion } = useQuery<{
    id: number;
    name: string;
    description: string | null;
    pointsMultiplier: number;
    endAt: string;
  } | null>({
    queryKey: ["/api/promotions/active"],
    staleTime: 60_000,
  });

  if (!promotion) return null;

  const endDate = new Date(promotion.endAt);
  const timeLeft = endDate.getTime() - Date.now();
  const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 text-center text-sm font-medium">
      <span className="mr-2">🔥</span>
      <strong>{promotion.name}</strong>
      {promotion.pointsMultiplier > 1 && (
        <span className="ml-2">{promotion.pointsMultiplier}× Points!</span>
      )}
      {daysLeft > 0 && daysLeft <= 7 && (
        <span className="ml-2 opacity-90">— Ends in {daysLeft} day{daysLeft !== 1 ? 's' : ''}</span>
      )}
      {promotion.description && (
        <span className="ml-2 opacity-90">— {promotion.description}</span>
      )}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "See the Card",
      description: "You'll see a real sports trading card with the player's name hidden. Study the team, stats, and design.",
      emoji: "🃏",
    },
    {
      number: "02",
      title: "Make Your Guess",
      description: "Choose from 4 options. Faster correct answers earn more PackPTS. Build a streak for multipliers!",
      emoji: "⚡",
    },
    {
      number: "03",
      title: "Redeem for Real Cards",
      description: "Use your PackPTS to get discounts on real sports cards from our marketplace partners.",
      emoji: "🏆",
    },
  ];

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold mb-4 text-center">How It Works</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {steps.map((step) => (
          <div key={step.number} className="flex gap-3 p-4 rounded-lg bg-muted/30">
            <div className="text-2xl flex-shrink-0">{step.emoji}</div>
            <div>
              <p className="text-xs text-primary font-mono font-bold">{step.number}</p>
              <h3 className="font-semibold text-sm">{step.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "What is PackPTS?",
      a: "PackPTS is a sports card trivia game where you identify players from their trading cards. Correct answers earn PackPTS (points) that you can redeem for real card discounts.",
    },
    {
      q: "Is PackPTS free to play?",
      a: "Yes! PackPTS has a free tier with daily game limits. Pro subscribers get unlimited games, bonus point multipliers, and priority access to new card sets.",
    },
    {
      q: "How do I redeem my points?",
      a: "Visit the Marketplace section to browse available cards. Apply your PackPTS at checkout for discounts at partner stores including eBay and Goldin Auctions.",
    },
    {
      q: "What sports are covered?",
      a: "We cover MLB, NBA, NFL, and NHL cards spanning multiple decades. New card sets are added regularly based on community requests.",
    },
    {
      q: "How does the 1v1 mode work?",
      a: "Challenge a friend or get matched with a random opponent. Both players see the same cards and race to answer correctly. The player with the most correct answers wins bonus points.",
    },
  ];

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold mb-4">Frequently Asked Questions</h2>
      <div className="space-y-3">
        {faqs.map((faq, i) => (
          <div key={i} className="p-4 rounded-lg border bg-card">
            <h3 className="font-semibold text-sm mb-1">{faq.q}</h3>
            <p className="text-sm text-muted-foreground">{faq.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Daily5Urgency() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const msLeft = midnight.getTime() - now.getTime();
  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
  const minutesLeft = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));

  const urgentColor = hoursLeft < 3 ? "text-red-500" : hoursLeft < 6 ? "text-orange-500" : "text-primary";
  const urgentBg = hoursLeft < 3 ? "border-red-500/30 bg-red-500/5" : hoursLeft < 6 ? "border-orange-500/30 bg-orange-500/5" : "border-primary/20";

  return (
    <Card className={`mb-8 border-2 ${urgentBg}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Daily 5 Challenge</p>
              <p className="text-sm text-muted-foreground">Same 5 cards for everyone. Compete for the top spot!</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <p className={`text-lg font-bold font-mono ${urgentColor}`}>
                {hoursLeft}h {minutesLeft}m left
              </p>
              <p className="text-xs text-muted-foreground">Resets at midnight UTC</p>
            </div>
            <Link href="/daily5">
              <Button className="gap-2" size="sm">
                <Zap className="h-4 w-4" />
                Play Daily 5
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CardOfTheDay() {
  const { data: card } = useQuery<{
    cardId: number;
    imageUrl: string;
    setName: string;
    year: string;
    wrongAnswerRate: number;
    date: string;
  } | null>({
    queryKey: ["/api/card-of-the-day"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (!card) return null;

  return (
    <Card className="mb-8 overflow-hidden border-2 border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-lg">Card of the Day</CardTitle>
          <Badge variant="secondary" className="ml-auto">
            {Math.round(card.wrongAnswerRate)}% got it wrong
          </Badge>
        </div>
        <CardDescription>
          Can you identify today's mystery player? {Math.round(card.wrongAnswerRate)}% of players got it wrong yesterday!
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex items-center gap-4">
          <div className="w-20 h-28 rounded-md overflow-hidden bg-muted flex-shrink-0 relative">
            <img
              src={card.imageUrl}
              alt="Mystery card - player identity hidden"
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="text-white text-xs font-bold">?</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="font-medium">{card.setName} {card.year}</p>
            <p className="text-sm text-muted-foreground">Play today to find out who this is!</p>
            <Button size="sm" asChild className="mt-2">
              <a href="/game">Play Now</a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { data: homeStats } = useQuery<{ totalGames: number; totalCards: number }>({
    queryKey: ["/api/home-stats"],
    staleTime: 5 * 60 * 1000,
  });

  const variant = useRef<HeroCTAVariant>(getOrAssignVariant());
  useEffect(() => {
    logAbEvent("impression", variant.current);
  }, []);

  const quickStats = [
    {
      label: "Total Games Played",
      value: homeStats ? homeStats.totalGames.toLocaleString() : "—",
      icon: Star,
    },
    {
      label: "Cards Guessed",
      value: homeStats ? homeStats.totalCards.toLocaleString() : "—",
      icon: Zap,
    },
  ];

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <PromotionBanner />
      <SetOfWeekBanner />
      <OnboardingModal />
      <section className="relative overflow-hidden py-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/10" />
        <div className="container mx-auto relative">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge variant="outline" className="gap-1.5 px-3 py-1">
              <Star className="h-3 w-3" />
              Classic Card Collections
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight" data-testid="text-hero-title">
              Know Your Cards.{" "}
              <span className="text-primary">Earn Your Points.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto" data-testid="text-hero-description">
              The ultimate trivia game for sports card collectors. Guess the player on classic cards from your favorite sets,
              earn PackPTS, and use them as a discount toward cards on Goldin and eBay.
            </p>
            {!isAuthenticated && (
              <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary rounded-full px-5 py-2 text-sm font-semibold">
                <Gift className="h-4 w-4" />
                New players get 250 free PackPTS on signup — no purchase needed
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <Link href="/game/solo">
                <Button
                  size="lg"
                  className="gap-2"
                  data-testid="button-play-now"
                  data-ab-variant={variant.current}
                  onClick={() => logAbEvent("click", variant.current)}
                >
                  <Zap className="h-5 w-5" />
                  {variant.current === "B" ? "Start Earning — It's Free" : "Play Now"}
                </Button>
              </Link>
              {!isAuthenticated && (
                <Link href="/auth">
                  <Button size="lg" variant="outline" className="gap-2" data-testid="button-claim-bonus">
                    <Gift className="h-5 w-5" />
                    Claim 250 Free Points
                  </Button>
                </Link>
              )}
              {isAuthenticated && (
                <Link href="/leaderboard">
                  <Button size="lg" variant="outline" className="gap-2" data-testid="button-view-leaderboard">
                    <Trophy className="h-5 w-5" />
                    View Leaderboard
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-4">
        <FoundersCounter />
      </section>

      <section className="container mx-auto px-4 pt-4">
        <Daily5Urgency />
        <CardOfTheDay />
      </section>

      <section className="container mx-auto px-4 py-8">
        <HowItWorks />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                  A card from your selected set appears with the name hidden. Choose the correct player from 4 options.
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
                  <span>Use Your Discount</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Use your PackPTS as a discount toward cards on Goldin or eBay, or keep climbing the ranks.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {!isAuthenticated && (
        <section className="container mx-auto px-4 py-8">
          <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-background">
            <CardContent className="p-6 md:p-8 text-center space-y-4">
              <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit">
                <Gift className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold">Start with 250 Free PackPTS</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Create a free account today and we'll credit 250 PackPTS straight to your wallet.
                Use them toward real cards on Goldin and eBay.
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Link href="/auth">
                  <Button size="lg" className="gap-2" data-testid="button-signup-bonus">
                    <UserPlus className="h-5 w-5" />
                    Create Free Account
                  </Button>
                </Link>
                <Link href="/game/solo">
                  <Button size="lg" variant="outline" className="gap-2">
                    <Play className="h-5 w-5" />
                    Try Without Signing Up
                  </Button>
                </Link>
              </div>
              <p className="text-xs text-muted-foreground pt-1">No credit card required. Free forever.</p>
            </CardContent>
          </Card>
        </section>
      )}

      <section className="container mx-auto px-4 py-4">
        <FAQ />
      </section>

      {/* Discord community link */}
      {import.meta.env.VITE_DISCORD_INVITE_URL && (
        <div className="text-center py-4">
          <a
            href={import.meta.env.VITE_DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Join our Discord community"
          >
            <MessageCircle className="h-4 w-4" />
            Join our Discord community
          </a>
        </div>
      )}

      <footer className="border-t mt-8 py-6">
        <div className="container mx-auto px-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/terms-of-service" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy-policy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <a href="mailto:support@packpts.com" className="hover:text-foreground transition-colors">
            support@packpts.com
          </a>
        </div>
      </footer>
    </div>
  );
}
