import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePointsValue } from "@/hooks/use-points-value";
import { WALLET } from "@/lib/pointsCopy";
import { setWalletSheetOpen } from "@/lib/walletSheetOpen";

function WalletBody({ balance, onClose }: { balance: number; onClose: () => void }) {
  const { rebateLive, usdFor } = usePointsValue();
  const usd = rebateLive ? usdFor(balance) : null;
  const { data } = useQuery<{ expiringNext30Days?: number }>({ queryKey: ["/api/wallet/expirations"], retry: 1 });
  const expiring = Math.floor(data?.expiringNext30Days ?? 0);
  return (
    <div className="space-y-3" data-testid="sheet-wallet">
      <h2 className="text-lg font-semibold">{WALLET.title}</h2>
      <p className="text-2xl font-bold font-mono" data-testid="text-wallet-balance">{WALLET.balance(balance)}</p>
      <p className="text-sm text-muted-foreground" data-testid="text-wallet-value">{usd ? WALLET.live(usd) : WALLET.soon}</p>
      {expiring > 0 && <p className="text-sm" data-testid="text-wallet-expiring">{WALLET.expiring(expiring)}</p>}
      <div className="flex flex-col gap-3 pt-1">
        <Link href="/points" onClick={onClose}>
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
  useEffect(() => { setWalletSheetOpen(open); return () => setWalletSheetOpen(false); }, [open]);
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
