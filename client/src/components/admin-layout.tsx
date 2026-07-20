import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Home,
  Shield,
  BarChart3,
  ScrollText,
  Gift,
  Coins,
  Flame,
  Package,
  UserPlus,
  RefreshCw,
  MapPin,
  Layers,
  Flag,
  ShieldCheck,
  Download,
  Calendar,
  Menu,
  X,
  Megaphone,
  Star,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type NavGroup = {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
};

const navGroups: NavGroup[] = [
  {
    label: "Dashboard",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/metrics", label: "Metrics", icon: BarChart3 },
      { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
      { href: "/admin/daily5", label: "Daily 5", icon: Calendar },
      { href: "/admin/set-of-week", label: "Set of the Week", icon: Star },
    ],
  },
  {
    label: "Users",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/access", label: "Access", icon: UserPlus },
      { href: "/admin/geo", label: "Geo", icon: MapPin },
      { href: "/admin/streaks", label: "Streaks", icon: Flame },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/playable-sets", label: "Cards", icon: Layers },
      { href: "/admin/card-sets", label: "Set Importer", icon: Download },
      { href: "/admin/card-reports", label: "Reports", icon: Flag },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/admin/growth", label: "Publishing Queue", icon: Megaphone },
    ],
  },
  {
    label: "Financial",
    items: [
      { href: "/admin/products", label: "Products", icon: Package },
      { href: "/admin/package-guardrails", label: "Guardrails", icon: ShieldCheck },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: RefreshCw },
      { href: "/admin/redemptions", label: "Redemptions", icon: Gift },
      { href: "/admin/tiers", label: "Tiers", icon: Coins },
    ],
  },
];

function NavItem({ href, label, icon: Icon, isActive, onClick }: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick}>
      <Button
        variant={isActive ? "secondary" : "ghost"}
        size="sm"
        className="w-full justify-start gap-2"
        data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </Button>
    </Link>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.firstName) {
      return user.firstName.slice(0, 2).toUpperCase();
    }
    return "AD";
  };

  const sidebar = (
    <nav className="flex flex-col gap-6 p-4 overflow-y-auto h-full">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={location === item.href}
                onClick={() => setSidebarOpen(false)}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top header bar */}
      <header className="border-b bg-card flex-shrink-0">
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger — always visible, sidebar hidden/shown by state */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link href="/admin/dashboard">
              <div className="flex items-center gap-2 cursor-pointer">
                <Shield className="h-5 w-5 text-primary" />
                <span className="font-bold text-base">PackPTS Admin</span>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user.profileImageUrl || undefined} />
                  <AvatarFallback className="text-xs">{getInitials()}</AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline">{user.firstName || user.email?.split("@")[0]}</span>
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
              className="gap-2"
              data-testid="button-admin-logout"
              onClick={() => logout()}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop persistent sidebar */}
        <aside className="hidden lg:flex lg:flex-col w-52 border-r bg-card flex-shrink-0 overflow-y-auto">
          {sidebar}
        </aside>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="fixed top-14 left-0 bottom-0 z-50 w-64 border-r bg-card overflow-y-auto lg:hidden">
              {sidebar}
            </aside>
          </>
        )}

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
