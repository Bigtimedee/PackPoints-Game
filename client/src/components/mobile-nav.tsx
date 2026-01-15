import { Link, useLocation } from "wouter";
import { Trophy, User, ShoppingBag, Play, Coins } from "lucide-react";

export function MobileNav() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Play", icon: Play },
    { href: "/leaderboard", label: "Ranks", icon: Trophy },
    { href: "/store", label: "Store", icon: Coins },
    { href: "/marketplace", label: "Redeem", icon: ShoppingBag },
    { href: "/profile", label: "Profile", icon: User },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-md transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover-elevate"
              }`}
              data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
