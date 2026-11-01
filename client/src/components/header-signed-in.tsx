import { Link, useLocation } from "wouter";
import { LogOut, ShieldAlert, ShoppingBag, User, Zap } from "lucide-react";
import { WalletChip } from "@/components/wallet-sheet";
import { useWallet } from "@/hooks/use-wallet";
import { useCompleteScreenActive, usePlayChromeActive } from "@/lib/playChrome";
import { pointsChipHidden } from "@/lib/pointsChipVisibility";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StreakBadge } from "./streak-card";
import { DailyProgressBadge } from "./daily-progress-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type HeaderUser = {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
};

function initials(user: HeaderUser): string {
  if (user.firstName && user.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  if (user.firstName) return user.firstName.slice(0, 2).toUpperCase();
  if (user.username) return user.username.slice(0, 2).toUpperCase();
  if (user.email) return user.email.slice(0, 2).toUpperCase();
  return "U";
}

function displayName(user: HeaderUser): string {
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.firstName) return user.firstName;
  if (user.username) return user.username;
  if (user.email) return user.email.split("@")[0];
  return "User";
}

/** Signed-in header cluster. Loaded only after auth, so guests do not download it. */
export function HeaderSignedIn({ user, logout }: { user: HeaderUser; logout: () => void }) {
  const [location] = useLocation();
  const playActive = usePlayChromeActive();
  const completeActive = useCompleteScreenActive();
  const hideChip = pointsChipHidden(location, playActive, completeActive);
  const { isRestricted, isFrozen, availablePts } = useWallet();
  const name = displayName(user);

  return (
    <>
      <div className={location === "/" ? "hidden sm:block" : ""}><StreakBadge /></div>
      {!isRestricted && <div className={location === "/" ? "hidden sm:block" : "hidden min-[400px]:block"}><DailyProgressBadge /></div>}
      {hideChip ? null : isRestricted ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive/20 border border-destructive font-mono cursor-help" data-testid="text-points-balance-restricted">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-destructive">{availablePts.toLocaleString()}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            <p className="font-semibold">{isFrozen ? "Account Frozen" : "Account Under Review"}</p>
            <p className="text-muted-foreground text-xs">
              {isFrozen
                ? "Earning points is currently paused. Contact support if you believe this is an error."
                : "Your account is being reviewed. Earning points is temporarily paused."}
            </p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <WalletChip balance={availablePts}>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/80 font-mono" data-testid="text-points-balance">
            <Zap className="h-4 w-4 text-secondary-foreground" />
            <span className="font-semibold text-secondary-foreground">{availablePts.toLocaleString()}</span>
          </div>
        </WalletChip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex shrink-0 items-center gap-2 rounded-md border border-transparent px-1.5 py-1 hover-elevate sm:px-2" data-testid="button-user-menu">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user.profileImageUrl || undefined} alt={name} />
              <AvatarFallback className="text-xs">{initials(user)}</AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline text-sm">{name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{user.email}</div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/profile" className="cursor-pointer">
              <User className="h-4 w-4 mr-2" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/redemptions" className="cursor-pointer">
              <ShoppingBag className="h-4 w-4 mr-2" />
              My Redemptions
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer text-destructive" onClick={() => logout()}>
            <LogOut className="h-4 w-4 mr-2" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
