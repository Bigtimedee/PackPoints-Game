import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Users, LogOut, Home, Shield, BarChart3, ScrollText, Gift, Coins, Flame, Package, UserPlus, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const navItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/access", label: "Access", icon: UserPlus },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: RefreshCw },
  { href: "/admin/redemptions", label: "Redemptions", icon: Gift },
  { href: "/admin/tiers", label: "Tiers", icon: Coins },
  { href: "/admin/streaks", label: "Streaks", icon: Flame },
  { href: "/admin/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.firstName) {
      return user.firstName.slice(0, 2).toUpperCase();
    }
    return "AD";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard">
              <div className="flex items-center gap-2 cursor-pointer">
                <Shield className="h-6 w-6 text-primary" />
                <span className="font-bold text-lg">PackPoints Admin</span>
              </div>
            </Link>
            <nav className="hidden md:flex items-center gap-1 ml-6">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      size="sm"
                      className="gap-2"
                      data-testid={`nav-${item.label.toLowerCase()}`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user.profileImageUrl || undefined} />
                  <AvatarFallback className="text-xs">{getInitials()}</AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline">{user.firstName || user.email?.split('@')[0]}</span>
              </div>
            )}
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-to-app">
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Back to App</span>
              </Button>
            </Link>
            <Button 
              variant="outline" 
              size="sm" 
              asChild
              className="gap-2"
              data-testid="button-admin-logout"
            >
              <a href="/api/logout">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </a>
            </Button>
          </div>
        </div>
      </header>

      <div className="md:hidden border-b bg-muted/50">
        <div className="container mx-auto px-4 py-2 flex gap-2 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-2 whitespace-nowrap"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </div>
      </div>

      <main className="container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
