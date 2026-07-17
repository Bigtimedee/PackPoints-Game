import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, captureUtmParams } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { Header } from "@/components/header";
import { MobileNav } from "@/components/mobile-nav";
import { AdminLayout } from "@/components/admin-layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FeedbackWidget } from "@/components/FeedbackWidget";

// Critical path — eager imports
import Home from "@/pages/home";
import Auth from "@/pages/auth";
import NotFound from "@/pages/not-found";
import AuthError from "@/pages/auth-error";
import AuthSuccess from "@/pages/auth-success";
import LinkRequired from "@/pages/link-required";

// Lazy-load everything else
const Game = lazy(() => import("@/pages/game"));
const Lobby = lazy(() => import("@/pages/lobby"));
const Match = lazy(() => import("@/pages/match"));
const Queue = lazy(() => import("@/pages/queue"));
const Leaderboard = lazy(() => import("@/pages/leaderboard"));
const Marketplace = lazy(() => import("@/pages/marketplace"));
const Store = lazy(() => import("@/pages/store"));
const StoreSuccess = lazy(() => import("@/pages/store-success"));
const StoreCancel = lazy(() => import("@/pages/store-cancel"));
const Profile = lazy(() => import("@/pages/profile"));
const Friends = lazy(() => import("@/pages/friends"));
const Daily5 = lazy(() => import("@/pages/daily5"));
const Waitlist = lazy(() => import("@/pages/waitlist"));
const Invite = lazy(() => import("@/pages/invite"));
const Redeem = lazy(() => import("@/pages/redeem"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy"));
const TermsOfService = lazy(() => import("@/pages/terms-of-service"));
const Partners = lazy(() => import("@/pages/partners"));
const AdminLogin = lazy(() => import("@/pages/admin/login"));
const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
const AdminUsers = lazy(() => import("@/pages/admin/users"));
const AdminUserDetail = lazy(() => import("@/pages/admin/user-detail"));
const AdminMetrics = lazy(() => import("@/pages/admin/metrics"));
const AdminAuditLog = lazy(() => import("@/pages/admin/audit-log"));
const AdminRedemptions = lazy(() => import("@/pages/admin/redemptions"));
const AdminTiers = lazy(() => import("@/pages/admin/tiers"));
const AdminStreaks = lazy(() => import("@/pages/admin/streaks"));
const AdminProducts = lazy(() => import("@/pages/admin/products"));
const AdminSubscriptions = lazy(() => import("@/pages/admin/subscriptions"));
const AdminAccess = lazy(() => import("@/pages/admin/access"));
const AdminGeo = lazy(() => import("@/pages/admin/geo"));
const AdminPlayableSets = lazy(() => import("@/pages/admin/playable-sets"));
const AdminCardHedgeCard = lazy(() => import("@/pages/admin/cardhedge-card"));
const AdminCardSearch = lazy(() => import("@/pages/admin/card-search"));
const AdminCardReports = lazy(() => import("@/pages/admin/card-reports"));
const AdminPackageGuardrails = lazy(() => import("@/pages/admin/package-guardrails"));
const AdminCardSets = lazy(() => import("@/pages/admin/card-sets"));
const AdminCardTelemetry = lazy(() => import("@/pages/admin/card-telemetry"));
const AdminDaily5Stats = lazy(() => import("@/pages/admin/daily5-stats"));
const AdminGrowth = lazy(() => import("@/pages/admin/growth"));
const Creators = lazy(() => import("@/pages/creators"));
const Roadmap = lazy(() => import("@/pages/roadmap"));
const Make = lazy(() => import("@/pages/make"));
const SetPage = lazy(() => import("@/pages/set-page"));
const Collab = lazy(() => import("@/pages/collab"));
const BrowseSets = lazy(() => import("@/pages/browse-sets"));

function BrandedLoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <span className="text-2xl font-black tracking-tight text-foreground">PackPTS</span>
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<BrandedLoadingScreen />}>
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/game/:mode" component={Game} />
      <Route path="/lobby" component={Lobby} />
      <Route path="/lobby/:id" component={Lobby} />
      <Route path="/lobby/:action" component={Lobby} />
      <Route path="/queue" component={Queue} />
      <Route path="/match/:matchId" component={Match} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/store" component={Store} />
      <Route path="/store/success" component={StoreSuccess} />
      <Route path="/store/cancel" component={StoreCancel} />
      <Route path="/profile">
        {() => (
          <ProtectedRoute requireAuth>
            <Profile />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/friends">
        {() => (
          <ProtectedRoute requireAuth>
            <Friends />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/daily5" component={Daily5} />
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/dashboard">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminDashboard />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/users">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminUsers />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/products">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminProducts />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/subscriptions">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminSubscriptions />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/users/:userId">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminUserDetail />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/metrics">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminMetrics />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/audit-log">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminAuditLog />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/redemptions">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminRedemptions />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/tiers">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminTiers />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/streaks">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminStreaks />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/daily5">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminDaily5Stats />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/access">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminAccess />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/geo">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminGeo />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/playable-sets">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminPlayableSets />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/card-sets">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminCardSets />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/cardhedge-card">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminCardHedgeCard />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/card-search">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminCardSearch />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/card-reports">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminCardReports />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/card-telemetry">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminCardTelemetry />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/package-guardrails">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminPackageGuardrails />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/growth">
        {() => (
          <ProtectedRoute requireAdmin>
            <AdminLayout>
              <AdminGrowth />
            </AdminLayout>
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/auth" component={Auth} />
      <Route path="/auth/success" component={AuthSuccess} />
      <Route path="/auth/link-required" component={LinkRequired} />
      <Route path="/auth/error" component={AuthError} />
      <Route path="/auth-error" component={AuthError} />
      <Route path="/waitlist" component={Waitlist} />
      <Route path="/invite" component={Invite} />
      <Route path="/redeem" component={Redeem} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/terms-of-service" component={TermsOfService} />
      <Route path="/creators" component={Creators} />
      <Route path="/partners" component={Partners} />
      <Route path="/roadmap" component={Roadmap} />
      <Route path="/make" component={Make} />
      <Route path="/sets" component={BrowseSets} />
      <Route path="/sets/:id" component={SetPage} />
      <Route path="/collab/:id" component={Collab} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function AppShell() {
  const [location] = useLocation();
  const isMatchRoute = location === "/match" || location.startsWith("/match/");
  const isGameRoute = location.startsWith("/game/");
  const isFullscreen = isMatchRoute || isGameRoute;

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground overflow-hidden">
      {!isFullscreen && <Header />}
      <main className={isFullscreen ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto pb-20 md:pb-0"}>
        <Router />
      </main>
      <MobileNav />
    </div>
  );
}

function App() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    captureUtmParams();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="packpoints-theme">
          <TooltipProvider>
            {isOffline && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  zIndex: 9999,
                  backgroundColor: '#b91c1c',
                  color: '#fff',
                  textAlign: 'center',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                You appear to be offline. Some features may not work.
              </div>
            )}
            <AppShell />
            <FeedbackWidget />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
