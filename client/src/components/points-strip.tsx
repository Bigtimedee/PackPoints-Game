import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { usePointsValue } from "@/hooks/use-points-value";
import { FOOTNOTE_LIVE, GUEST_KEEP, primaryCta, stripSteps, valueLine } from "@/lib/pointsCopy";

/** Game Complete only. Never render during play or on the card face. */
export function PointsStrip({
  points,
  isGuest,
  playAgain,
}: {
  points: number;
  isGuest: boolean;
  /** The caller's own Play again button (kept in game.tsx so its replay wiring stays put). */
  playAgain?: ReactNode;
}) {
  const { rebateLive, usdFor } = usePointsValue();
  const usd = rebateLive ? usdFor(points) : null;
  const steps = stripSteps(rebateLive);
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6 text-left space-y-3" data-testid="points-strip">
      <h3 className="text-lg font-semibold">What your points are for</h3>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {steps.map((s, i) => (
          <div key={s.title} className="rounded-md bg-muted p-2 text-center" data-testid={`points-strip-step-${i + 1}`}>
            <div className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${i < 2 || rebateLive ? "bg-primary" : "bg-muted-foreground/60"}`}>{i + 1}</div>
            <p className="text-sm font-semibold leading-tight">{s.title}</p>
            <p className="text-xs text-muted-foreground leading-snug">{s.body}</p>
          </div>
        ))}
      </div>
      <p className="rounded-md border p-3 text-sm" data-testid="points-value-line">{valueLine(points, usd)}</p>
      {isGuest && <p className="text-sm text-muted-foreground" data-testid="text-guest-keep-points">{GUEST_KEEP}</p>}
      <div className="flex flex-col gap-3">
        <Link href="/points?from=game">
          <Button size="lg" className="w-full min-h-11" data-testid="button-how-points-work">{primaryCta(rebateLive)}</Button>
        </Link>
        {playAgain || null}
      </div>
      {rebateLive && <p className="text-xs text-muted-foreground">{FOOTNOTE_LIVE}</p>}
    </section>
  );
}
