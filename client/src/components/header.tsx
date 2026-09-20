import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { Trophy, User, ShoppingBag, Play, Zap, LogIn, LogOut, Loader2, ExternalLink, AlertCircle, Coins, ShieldAlert } from "lucide-react";
import packptsLogo from "@/assets/packpts-logo.png";
import { useAuth } from "@/hooks/use-auth";
import { useWallet } from "@/hooks/use-wallet";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function Header() {
  const [location] = useLocation();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const { isRestricted, isFrozen, isUnderReview, restrictedReason, availablePts } = useWallet();
  const [showLoginWarning, setShowLoginWarning] = useState(false);

  const isInEmbeddedWebview = () => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  };

  const handleLoginClick = (e: React.MouseEvent) => {
    if (isInEmbeddedWebview()) {
      e.preventDefault();
      setShowLoginWarning(true);
    }
  };

  const navItems = [
    { href: "/", label: "Play", icon: Play },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { href: "/store", label: "Store", icon: Coins },
    { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
    { href: "/profile", label: "Profile", icon: User },
  ];

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.firstName) {
      return user.firstName.slice(0, 2).toUpperCase();
    }
    if (user?.username) {
      return user.username.slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "U";
  };

  const getDisplayName = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user?.firstName) {
      return user.firstName;
    }
    if (user?.username) {
      return user.username;
    }
    if (user?.email) {
      return user.email.split('@')[0];
    }
    return "User";
  };

  return (
    <>
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <img src={packptsLogo} alt="PackPTS" className="h-10 w-auto" data-testid="img-logo" />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="gap-2"
                  data-testid={`link-nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {isAuthenticated && user && (
            <>
              <StreakBadge />
              {!isRestricted && <DailyProgressBadge />}
              {isRestricted ? (
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
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/80 font-mono" data-testid="text-points-balance">
                  <Zap className="h-4 w-4 text-secondary-foreground" />
                  <span className="font-semibold text-secondary-foreground">{availablePts.toLocaleString()}</span>
                </div>
              )}
            </>
          )}
          
          <ThemeToggle />

          {isLoading ? (
            <Button variant="ghost" size="icon" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          ) : isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" data-testid="button-user-menu">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user.profileImageUrl || undefined} alt={getDisplayName()} />
                    <AvatarFallback className="text-xs">{getInitials()}</AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-sm">{getDisplayName()}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {user.email}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <User className="h-4 w-4 mr-2" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-destructive"
                  onClick={() => logout()}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild data-testid="button-login">
              <Link href="/auth">
                <LogIn className="h-4 w-4 mr-2" />
                Log in
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>

    <AlertDialog open={showLoginWarning} onOpenChange={setShowLoginWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
              <ExternalLink className="h-6 w-6 text-muted-foreground" />
            </div>
            <AlertDialogTitle className="text-center">Open in New Tab to Login</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Login doesn't work in the embedded preview. Click "New tab" in the header above to open this app in a full browser tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">How to Log In:</p>
            <ol className="text-muted-foreground space-y-1 list-decimal pl-4">
              <li>Look for the "New tab" button in the preview header</li>
              <li>Click it to open the app in a new browser tab</li>
              <li>Then click "Log in" from there</li>
            </ol>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Got it</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
