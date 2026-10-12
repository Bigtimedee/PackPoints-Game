import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { usePointsValue } from "@/hooks/use-points-value";
import { PRIMARY, checkoutAnswer, expiryAnswer, pageSteps } from "@/lib/pointsCopy";

export default function PointsPage() {
  const { value, loaded, rebateLive, usdFor } = usePointsValue();
  const fromGame = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") === "game";
  const steps = pageSteps(rebateLive);
  const example = 1000;
  const exampleUsd = rebateLive ? usdFor(example) : null;
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] space-y-3" data-testid="page-points">
      <h1 className="text-3xl font-bold">How points work</h1>
      <p className="text-muted-foreground">{rebateLive ? PRIMARY.live : PRIMARY.soon}</p>
      {steps.map((s, i) => (
        <div key={s.title} className="rounded-lg border bg-card p-4 sm:p-6" data-testid={`points-step-${i + 1}`}>
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{i + 1}</span>
            <h2 className="text-xl font-semibold">{s.title}</h2>
          </div>
          <p className="mt-2 pl-10 text-sm text-muted-foreground">{s.body}</p>
        </div>
      ))}
      {rebateLive && exampleUsd && (
        <div className="rounded-lg border bg-card p-4 sm:p-6" data-testid="points-value-card">
          <p className="font-semibold">Today: {example.toLocaleString("en-US")} points = up to {exampleUsd}</p>
          <p className="text-sm text-muted-foreground">Rate is live and can change. Rebates can be capped per purchase.</p>
        </div>
      )}
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-3">
        <h2 className="text-xl font-semibold">Questions</h2>
        <div className="border-t pt-3" data-testid="faq-expiry">
          <h3 className="font-semibold">Do points expire?</h3>
          <p className="text-sm text-muted-foreground">{loaded ? expiryAnswer(value.expiry) : "Loading..."}</p>
        </div>
        <div className="border-t pt-3" data-testid="faq-checkout">
          <h3 className="font-semibold">Is checkout different?</h3>
          <p className="text-sm text-muted-foreground">{checkoutAnswer(rebateLive)}</p>
        </div>
        <div className="border-t pt-3" data-testid="faq-adding">
          <h3 className="font-semibold">What does adding points get me?</h3>
          <p className="text-sm text-muted-foreground">More points to play with. Points you buy are for play only and don't count toward rebates.</p>
        </div>
        <div className="flex flex-col gap-3 pt-2">
          <Link href="/game/solo">
            <Button size="lg" className="w-full min-h-11" data-testid="button-play-now">Play now</Button>
          </Link>
          {fromGame && (
            <Button size="lg" variant="outline" className="w-full min-h-11" onClick={() => window.history.back()} data-testid="button-back-to-game">Back to game</Button>
          )}
        </div>
      </div>
    </div>
  );
}
