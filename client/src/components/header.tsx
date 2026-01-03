import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { Trophy, User, ShoppingBag, Play, Zap } from "lucide-react";

interface HeaderProps {
  points?: number;
}

export function Header({ points = 0 }: HeaderProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Play", icon: Play },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
    { href: "/profile", label: "Profile", icon: User },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-xl tracking-tight" data-testid="text-logo">PackPoints</span>
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/80 font-mono" data-testid="text-points-balance">
            <Zap className="h-4 w-4 text-secondary-foreground" />
            <span className="font-semibold text-secondary-foreground">{points.toLocaleString()}</span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
