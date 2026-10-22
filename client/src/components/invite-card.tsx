import { useState } from "react";
import { Link } from "wouter";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INVITE, inviteLink, shareInvite, useInviteOffer } from "@/lib/invite";

/** Game Complete only. Never render during play. */
export function InviteCard({ isGuest }: { isGuest: boolean }) {
  const { data: offer } = useInviteOffer();
  const [note, setNote] = useState<string | null>(null);
  if (!offer) return null;
  const url = offer.url ? inviteLink(offer.url, "game_complete") : null;
  return (
    <section className="rounded-lg border bg-card p-4 text-left space-y-3" data-testid="invite-card" data-guest={isGuest ? "true" : "false"}>
      <div className="flex items-start gap-3">
        <Gift className="h-5 w-5 shrink-0 text-primary mt-0.5" />
        <p className="text-sm font-medium" data-testid="text-invite-headline">{INVITE.headline}</p>
      </div>
      {offer.code && url ? (
        <>
          <p className="text-sm text-muted-foreground">
            {INVITE.codeLabel}: <span className="font-mono font-semibold text-foreground" data-testid="text-invite-code">{offer.code}</span>
          </p>
          <Button className="w-full min-h-11" onClick={async () => { const r = await shareInvite(url); if (r === "copied") setNote(INVITE.copied); }} data-testid="button-share-invite">
            {INVITE.share}
          </Button>
          {note && <p className="text-xs text-muted-foreground" role="status">{note}</p>}
        </>
      ) : (
        <Link href="/auth?tab=signup">
          <Button variant="outline" className="w-full min-h-11" data-testid="button-invite-signup">{INVITE.guestCta}</Button>
        </Link>
      )}
    </section>
  );
}
