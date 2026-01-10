import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { MobileNav } from "@/components/mobile-nav";
import Home from "@/pages/home";
import Game from "@/pages/game";
import Lobby from "@/pages/lobby";
import Match from "@/pages/match";
import Queue from "@/pages/queue";
import Leaderboard from "@/pages/leaderboard";
import Marketplace from "@/pages/marketplace";
import Profile from "@/pages/profile";
import AdminLogin from "@/pages/admin/login";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import NotFound from "@/pages/not-found";
import { AdminLayout } from "@/components/admin-layout";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/game/:mode" component={Game} />
      <Route path="/lobby" component={Lobby} />
      <Route path="/lobby/:action" component={Lobby} />
      <Route path="/queue" component={Queue} />
      <Route path="/match/:matchId" component={Match} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/profile" component={Profile} />
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/dashboard">
        {() => (
          <AdminLayout>
            <AdminDashboard />
          </AdminLayout>
        )}
      </Route>
      <Route path="/admin/users">
        {() => (
          <AdminLayout>
            <AdminUsers />
          </AdminLayout>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="packpoints-theme">
        <TooltipProvider>
          <div className="min-h-screen bg-background text-foreground">
            <Header points={2500} />
            <main>
              <Router />
            </main>
            <MobileNav />
          </div>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
