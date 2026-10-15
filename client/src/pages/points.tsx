import { useEffect } from "react";
import { Link } from "wouter";
import { trackPoints } from "@/lib/pointsEvents";
import { Button } from "@/components/ui/button";
import { AffiliateDisclosure } from "@/components/affiliate-disclosure";
import { usePointsValue } from "@/hooks/use-points-value";
import { INVITE, useInviteOffer } from "@/lib/invite";
import { PRIMARY, addingAnswer, cashOutAnswer, checkoutAnswer, expiryAnswer, pageSteps } from "@/lib/pointsCopy";

export default function PointsPage() {
  const { value, loaded, rebateLive, usdFor } = usePointsValue();
  const fromGame = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") === "game";
  const steps = pageSteps(rebateLive, value?.holdDays, value?.payoutMinimum?.display);
  useEffect(() => { trackPoints("points_page_view", { surface: "points_page" }); }, []);
  const example = 1000;
  const exampleUsd = rebateLive ? usdFor(example) : null;
  const cashOut = loaded ? cashOutAnswer(value) : null;
  const { data: invite } = useInviteOffer();
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
          <p className="text-sm text-muted-foreground">{loaded ? addingAnswer(rebateLive, value.expiry) : "Loading..."}</p>
        </div>
        {cashOut && (
          <div className="border-t pt-3" data-testid="faq-cashout">
            <h3 className="font-semibold">When can I cash out?</h3>
            <p className="text-sm text-muted-foreground">{cashOut}</p>
          </div>
        )}
        {invite && (
          <div className="border-t pt-3" data-testid="faq-invites">
            <h3 className="font-semibold">{INVITE.faqQ}</h3>
            <p className="text-sm text-muted-foreground">{INVITE.faqA(invite)}</p>
            {invite.code && <p className="text-sm pt-1">{INVITE.codeLabel}: <span className="font-mono font-semibold" data-testid="text-faq-invite-code">{invite.code}</span></p>}
          </div>
        )}
        <div className="flex flex-col gap-3 pt-2">
          <Link href="/game/solo" onClick={() => trackPoints("points_cta_click", { surface: "points_page", cta: "play_now" })}>
            <Button size="lg" className="w-full min-h-11" data-testid="button-play-now">Play now</Button>
          </Link>
          {fromGame && (
            <Button size="lg" variant="outline" className="w-full min-h-11" onClick={() => { trackPoints("points_cta_click", { surface: "points_page", cta: "back_to_game" }); window.history.back(); }} data-testid="button-back-to-game">Back to game</Button>
          )}
        </div>
      </div>
      <AffiliateDisclosure className="pt-2" />
    </div>
  );
}
