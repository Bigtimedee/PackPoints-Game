import { lazy, Suspense, useState } from "react";
import { Link, useLocation } from "wouter";
import { ThemeToggle } from "./theme-toggle";
import { Coins, Loader2, LogIn, Play, ShoppingBag, Trophy, User } from "lucide-react";
import packptsLogo from "@/assets/packpts-logo.png";
import { useAuth } from "@/hooks/use-auth";

const HeaderSignedIn = lazy(() => import("./header-signed-in").then((m) => ({ default: m.HeaderSignedIn })));
const LoginWebviewDialog = lazy(() => import("./login-webview-dialog").then((m) => ({ default: m.LoginWebviewDialog })));

const navLink = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium min-h-9 px-4 py-2 hover-elevate active-elevate-2";

export function Header() {
  const [location] = useLocation();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [showLoginWarning, setShowLoginWarning] = useState(false);

  const handleLoginClick = (e: React.MouseEvent) => {
    try {
      if (window.self !== window.top) {
        e.preventDefault();
        setShowLoginWarning(true);
      }
    } catch {
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

  return (
    <>
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 flex-nowrap items-center justify-between gap-2 sm:gap-4 pl-3 pr-3 sm:px-4" data-testid="header-bar">
        <Link href="/" className="flex min-w-0 shrink items-center gap-2">
          <img src={packptsLogo} alt="PackPTS" className="h-8 min-[400px]:h-10 w-auto max-w-full min-w-0 object-contain object-left" data-testid="img-logo" />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${navLink} ${isActive ? "border bg-secondary text-secondary-foreground" : "border border-transparent"}`}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 flex-nowrap items-center gap-1 min-[400px]:gap-1.5 sm:gap-3">
          {isAuthenticated && user ? (
            <Suspense fallback={null}>
              <HeaderSignedIn user={user} logout={logout} />
            </Suspense>
          ) : null}

          <ThemeToggle />

          {isLoading ? (
            <span className="inline-flex h-9 w-9 items-center justify-center" aria-hidden="true">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          ) : isAuthenticated && user ? null : (
            <Link
              href="/auth"
              onClick={handleLoginClick}
              data-testid="button-login"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground border border-primary-border min-h-9 px-4 py-2 hover-elevate active-elevate-2"
            >
              <LogIn className="h-4 w-4" />
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
    {showLoginWarning ? (
      <Suspense fallback={null}>
        <LoginWebviewDialog open={showLoginWarning} onOpenChange={setShowLoginWarning} />
      </Suspense>
    ) : null}
    </>
  );
}
