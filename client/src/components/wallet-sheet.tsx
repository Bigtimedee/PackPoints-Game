import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePointsValue } from "@/hooks/use-points-value";
import { WALLET, holdLine } from "@/lib/pointsCopy";
import { setWalletSheetOpen } from "@/lib/walletSheetOpen";
import { trackPoints } from "@/lib/pointsEvents";
import { INVITE, inviteLink, shareInvite, useInviteOffer } from "@/lib/invite";

function WalletBody({ balance, onClose }: { balance: number; onClose: () => void }) {
  const { rebateLive, usdFor, value } = usePointsValue();
  const hold = holdLine(value);
  const usd = rebateLive ? usdFor(balance) : null;
  const { data } = useQuery<{ expiringNext30Days?: number }>({ queryKey: ["/api/wallet/expirations"], retry: 1 });
  const expiring = Math.floor(data?.expiringNext30Days ?? 0);
  const { data: offer } = useInviteOffer();
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="sheet-wallet">
      <h2 className="text-lg font-semibold">{WALLET.title}</h2>
      <p className="text-2xl font-bold font-mono" data-testid="text-wallet-balance">{WALLET.balance(balance)}</p>
      <p className="text-sm text-muted-foreground" data-testid="text-wallet-value">{usd ? WALLET.live(usd) : WALLET.soon}</p>
      {hold && <p className="text-sm text-muted-foreground" data-testid="text-wallet-hold">{hold}</p>}
      {expiring > 0 && <p className="text-sm" data-testid="text-wallet-expiring">{WALLET.expiring(expiring)}</p>}
      {offer?.url && (
        <button
          type="button"
          className="w-full min-h-11 rounded-md border px-3 py-2 text-left text-sm font-medium hover-elevate"
          onClick={async () => { const r = await shareInvite(inviteLink(offer.url!, "wallet")); if (r === "copied") setInviteNote(INVITE.copied); }}
          data-testid="button-wallet-invite"
        >
          {INVITE.walletRow(offer.inviterBonus)}
          <span className="block text-xs text-muted-foreground font-normal">{INVITE.codeLabel}: <span className="font-mono" data-testid="text-wallet-invite-code">{offer.code}</span></span>
        </button>
      )}
      {inviteNote && <p className="text-xs text-muted-foreground" role="status">{inviteNote}</p>}
      <div className="flex flex-col gap-3 pt-1">
        <Link href="/points" onClick={() => { trackPoints("points_cta_click", { surface: "wallet_sheet", cta: "how_points_work" }); onClose(); }}>
          <Button variant="outline" className="w-full min-h-11" data-testid="link-how-points-work">{WALLET.link}</Button>
        </Link>
        <Button className="w-full min-h-11" onClick={onClose} data-testid="button-wallet-close">{WALLET.close}</Button>
      </div>
    </div>
  );
}

/** Header points chip. Bottom sheet on mobile, popover on desktop. Focus is trapped in both. */
export function WalletChip({ balance, children }: { balance: number; children: ReactNode }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  useEffect(() => { setWalletSheetOpen(open); if (open) trackPoints("wallet_sheet_open", { surface: "wallet_sheet" }); return () => setWalletSheetOpen(false); }, [open]);
  const trigger = (
    <button type="button" aria-label={`${WALLET.title}: ${balance}`} className="min-h-11 flex items-center" onClick={isMobile ? () => setOpen(true) : undefined} data-testid="button-wallet-chip">
      {children}
    </button>
  );
  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="rounded-t-xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <SheetTitle className="sr-only">{WALLET.title}</SheetTitle>
            <WalletBody balance={balance} onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-6">
        <WalletBody balance={balance} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
