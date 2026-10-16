import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Same copy as the server-rendered /how-to-play (server/lib/seoPages.ts). No player names. */
export default function HowToPlayPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] space-y-4" data-testid="page-how-to-play">
      <h1 className="text-3xl font-bold">How to play PackPTS</h1>
      <p className="text-muted-foreground">PackPTS shows you a real sports card with the player name covered by a gold bar. Below the card are four names. Pick the one you think is on the card and submit. You see right away if you were correct, then move to the next card.</p>
      <h2 className="text-xl font-semibold">Two ways to play</h2>
      <p className="text-muted-foreground"><Link href="/daily" className="underline">Daily 5</Link> is five cards, the same for everyone, once per day. <Link href="/sets" className="underline">Set games</Link> let you pick a set and play a longer game from that set alone.</p>
      <h2 className="text-xl font-semibold">Scoring</h2>
      <p className="text-muted-foreground">Each correct answer earns points. Points are never shown on the card while you play; you see your total when the game ends. <Link href="/points" className="underline">Learn what points are for</Link>.</p>
      <h2 className="text-xl font-semibold">Like Wordle, but with real cards</h2>
      <p className="text-muted-foreground">If you like daily puzzle games, Daily 5 works the same way: one short run a day and a score to share. Every puzzle is a real card from sets collectors know.</p>
      <h2 className="text-xl font-semibold">Do I need an account?</h2>
      <p className="text-muted-foreground">No. You can play as a guest. A free account keeps your points, streaks and history across devices.</p>
      <div className="flex flex-col gap-3 pt-2">
        <Link href="/daily"><Button size="lg" className="w-full min-h-11" data-testid="button-htp-daily">Play the Daily 5</Button></Link>
        <Link href="/sets"><Button size="lg" variant="outline" className="w-full min-h-11" data-testid="button-htp-sets">Browse sets</Button></Link>
      </div>
    </div>
  );
}
