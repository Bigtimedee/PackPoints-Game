import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Calendar, Users, Shuffle, Compass, Trophy, MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { shouldShowHomePlayVanity } from "@shared/homePlayVanity";

// Public covers serve only approved, deal-eligible, already-baked masks.
// Never substitute an original scan, player name, or an arbitrary card set.
const TOPPS_1987_COVER = "/api/sets/37fd025d-2ae1-4c92-b8ad-133375d0c722/covers/0";

const modes = [
  { id: "daily5", title: "Daily 5", description: "Five cards. A new challenge every day.", href: "/daily5", icon: Calendar },
  { id: "1v1-friend", title: "Play a friend", description: "Same cards. Head-to-head.", href: "/lobby", icon: Users },
  { id: "1v1-random", title: "Find an opponent", description: "Put your card knowledge to the test.", href: "/queue", icon: Shuffle },
  { id: "browse", title: "Explore the sets", description: "Pick your sport, set, and era.", href: "/sets", icon: Compass },
];

function FeaturedCard() {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <figure className="relative mx-auto w-[230px] sm:w-[280px] lg:w-[340px]" data-testid="home-featured-card">
      <div className="absolute -inset-5 rounded-full bg-amber-500/10 blur-3xl" aria-hidden="true" />
      <div className="relative aspect-[494/694] overflow-hidden rounded-sm bg-[#0b0f16] shadow-[0_18px_60px_-16px_rgba(0,0,0,0.65)] ring-1 ring-amber-200/20">
        {!failed ? (
          <img
            key={attempt}
            src={attempt ? `${TOPPS_1987_COVER}?retry=${attempt}` : TOPPS_1987_COVER}
            alt="1987 Topps baseball card with the player's name hidden"
            width={494}
            height={694}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
            data-testid="img-hero-masked-card"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-slate-200" role="status">
            <p className="text-sm">The card couldn't load.</p>
            <Button variant="outline" className="text-slate-900" onClick={() => { setAttempt(a => a + 1); setFailed(false); }}>
              Try again
            </Button>
          </div>
        )}
      </div>
      <figcaption className="relative mt-3 text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        1987 Topps · Baseball
      </figcaption>
    </figure>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { data: homeStats } = useQuery<{ totalGames: number; totalCards: number; staffPlayVanityOverride?: boolean }>({
    queryKey: ["/api/home-stats"], staleTime: 5 * 60 * 1000,
  });
  const showPlayVanity = shouldShowHomePlayVanity({ totalGames: homeStats?.totalGames, staffOverride: homeStats?.staffPlayVanityOverride });
  const quickStats = showPlayVanity && homeStats ? [
    { label: "Total Games Played", value: homeStats.totalGames.toLocaleString() },
    { label: "Cards Guessed", value: homeStats.totalCards.toLocaleString() },
  ] : [];

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      {/* Card first, including on a first visit: no automatic onboarding dialog. */}
      <section className="relative isolate overflow-hidden border-b" aria-labelledby="home-title">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-amber-500/[0.07] via-background to-primary/[0.06]" />
        <div className="mx-auto grid max-w-5xl items-center gap-5 px-5 pb-8 pt-6 md:grid-cols-2 md:gap-12 md:py-14 lg:py-16">
          <FeaturedCard />
          <div className="mx-auto max-w-md text-center md:text-left">
            <p className="mb-3 hidden text-xs font-semibold uppercase tracking-[0.22em] text-amber-600 dark:text-amber-400 md:block">Your collection. Your memory.</p>
            <h1 id="home-title" className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl lg:text-6xl" data-testid="text-hero-title">
              Who's on<br className="hidden md:block" /> the card?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground md:mt-5 md:text-lg" data-testid="text-hero-description">
              Name the player. Earn PackPTS.
            </p>
            <Button asChild size="lg" className="mt-5 min-h-12 w-full gap-2 text-base md:mt-7 md:w-auto md:min-w-56" data-testid="button-play-now">
              <Link href="/game/solo">Play Now <ArrowRight className="h-5 w-5" /></Link>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">{isAuthenticated ? "Your next round starts here." : "Free to play. Try a round before signing up."}</p>
            <Link href="/sets/37fd025d-2ae1-4c92-b8ad-133375d0c722" className="mt-4 inline-block text-sm underline decoration-border underline-offset-4 hover:text-primary">
              Play the 1987 Topps set
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-8 md:py-12" aria-labelledby="modes-title">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id="modes-title" className="text-lg font-semibold" data-testid="text-game-modes-title">Choose Your Game Mode</h2>
          <Link href="/leaderboard" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary" data-testid="button-view-leaderboard">
            <Trophy className="h-4 w-4" /> Ranks
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {modes.map(({ id, title, description, href, icon: Icon }) => (
            <Link key={id} href={href} className="group flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`card-game-mode-${id}`}>
              <div className="rounded-lg bg-primary/10 p-2.5 text-primary"><Icon className="h-5 w-5" /></div>
              <div className="flex-1"><h3 className="font-semibold">{title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
            </Link>
          ))}
        </div>
        {quickStats.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-8 text-center" data-testid="home-play-vanity">
            {quickStats.map(stat => <div key={stat.label}><p className="font-mono text-xl font-semibold">{stat.value}</p><p className="text-xs text-muted-foreground">{stat.label}</p></div>)}
          </div>
        )}
        {!isAuthenticated && (
          <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-xl border bg-muted/20 p-5 sm:flex-row sm:text-left">
            <div><h2 className="font-semibold">Create a Free Account</h2><p className="mt-1 text-sm text-muted-foreground">Keep Daily 5 and your sets on one profile.</p></div>
            <div className="flex flex-col items-center gap-2">
              <Button asChild variant="outline" data-testid="button-create-free-account"><Link href="/auth" data-testid="button-home-create-account">Create free account</Link></Button>
              <Link href="/game/solo" className="text-xs text-muted-foreground hover:text-primary">Play a round first</Link>
            </div>
          </div>
        )}
        <details className="mt-8 border-t pt-5 text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">How to play</summary>
          <p className="mt-3 leading-relaxed">Look at the card with the name hidden. Choose the player from four options. Correct answers earn PackPTS.</p>
          <p className="mt-2 leading-relaxed">Browse live eBay and Goldin listings in Marketplace. Applied PackPTS stay in your wallet and do not change the price those sites charge.</p>
        </details>
      </section>
      <footer className="border-t py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-6 gap-y-3 px-5 text-xs text-muted-foreground">
          <Link href="/terms-of-service" className="hover:text-foreground">Terms of Service</Link>
          <Link href="/privacy-policy" className="hover:text-foreground">Privacy Policy</Link>
          <a href="mailto:support@packpts.com" className="hover:text-foreground">Contact</a>
          {import.meta.env.VITE_DISCORD_INVITE_URL && <a href={import.meta.env.VITE_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground"><MessageCircle className="h-3.5 w-3.5" /> Discord</a>}
        </div>
      </footer>
    </div>
  );
}
