import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { usePointsValue } from "@/hooks/use-points-value";
import { ONBOARDING, stripSteps } from "@/lib/pointsCopy";
import { trackPoints } from "@/lib/pointsEvents";
import { usePlayChromeActive } from "@/lib/playChrome";
import { setOnboardingCardOpen } from "@/lib/walletSheetOpen";

export const ONBOARD_POINTS_KEY = "pp_onboard_points_v1";

function seen(): boolean {
  try { return localStorage.getItem(ONBOARD_POINTS_KEY) != null; } catch { return true; }
}

/** First-run card (single, skippable). Inline on Home only; never during play. */
export function OnboardingPointsCard() {
  const [, navigate] = useLocation();
  const playActive = usePlayChromeActive();
  const { rebateLive } = usePointsValue();
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(!seen()); }, []);
  const visible = show && !playActive;
  useEffect(() => { setOnboardingCardOpen(visible); return () => setOnboardingCardOpen(false); }, [visible]);
  if (!visible) return null;
  const done = (cta: "start_playing" | "skip") => {
    try { localStorage.setItem(ONBOARD_POINTS_KEY, cta); } catch { /* ignore */ }
    trackPoints("points_cta_click", { surface: "onboarding", cta });
    setShow(false);
    if (cta === "start_playing") navigate("/game/solo");
  };
  return (
    <>
    {/* Mobile: pinned just above the bottom nav (4rem + safe area) so both buttons are on screen at first load. Spacer keeps page content scrollable past it. */}
    <div className="h-60 md:hidden" aria-hidden="true" />
    <section
      className="fixed inset-x-0 z-40 px-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:static md:z-auto md:mx-auto md:max-w-5xl md:px-6 md:pt-4"
      aria-labelledby="onboarding-points-title"
      data-testid="section-onboarding-points"
    >
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-3 shadow-lg md:shadow-none" data-testid="card-onboarding-points">
        <h2 id="onboarding-points-title" className="text-lg font-semibold">{ONBOARDING.title}</h2>
        <div className="grid grid-cols-3 gap-3">
          {stripSteps(rebateLive).map((s, i) => (
            <div key={s.title} className="rounded-md bg-muted p-2 text-center" data-testid={`onboarding-points-step-${i + 1}`}>
              <div className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${i < 2 || rebateLive ? "bg-primary" : "bg-muted-foreground/60"}`}>{i + 1}</div>
              <p className="text-sm font-semibold leading-tight">{s.title}</p>
              <p className="text-xs text-muted-foreground leading-snug">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 min-h-11" onClick={() => done("skip")} data-testid="button-onboarding-skip">{ONBOARDING.skip}</Button>
          <Button className="flex-1 min-h-11" onClick={() => done("start_playing")} data-testid="button-onboarding-start">{ONBOARDING.start}</Button>
        </div>
      </div>
    </section>
    </>
  );
}
