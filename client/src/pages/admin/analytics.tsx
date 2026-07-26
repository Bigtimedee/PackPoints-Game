import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, BarChart3, Flame, ShoppingBag, LineChart, AlertTriangle } from "lucide-react";

interface AttentionRow {
  playerKey: string;
  cai: number;
  signal: number;
  plays: number;
  uniqueUsers: number;
  correct: number;
  incorrect: number;
  recognitionRate: number | null;
  velocity7: number;
}

interface RecognitionRow {
  playerKey: string;
  attempts: number;
  correct: number;
  recognitionRate: number;
  ciLow: number;
  ciHigh: number;
  velocity: number | null;
  breakout: boolean;
}

function RecognitionPanel({ windowDays }: { windowDays: number }) {
  const { data, isLoading } = useQuery<{ rows: RecognitionRow[]; breakouts: RecognitionRow[] }>({
    queryKey: ["/api/admin/analytics/recognition", windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/recognition?window=${windowDays}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load recognition index");
      return res.json();
    },
  });
  const rows = data?.rows ?? [];
  const breakouts = data?.breakouts ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          Recognition Index
          {breakouts.length > 0 && (
            <Badge className="gap-1 bg-orange-500"><Flame className="h-3 w-3" />{breakouts.length} breakout{breakouts.length > 1 ? "s" : ""}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">Not enough volume yet (needs ≥20 attempts/player).</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left px-4 py-2 font-medium">Player</th>
                <th className="text-right px-4 py-2 font-medium">Recognition</th>
                <th className="text-right px-4 py-2 font-medium">95% CI</th>
                <th className="text-right px-4 py-2 font-medium">Attempts</th>
                <th className="text-right px-4 py-2 font-medium">Momentum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerKey} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">
                    {r.playerKey.split(":").slice(1).join(":").replace(/\b\w/g, c => c.toUpperCase())}
                    {r.breakout && <Flame className="inline h-3 w-3 ml-1 text-orange-500" />}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-bold">{Math.round(r.recognitionRate * 100)}%</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{Math.round(r.ciLow * 100)}–{Math.round(r.ciHigh * 100)}%</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{r.attempts}</td>
                  <td className="px-4 py-2 text-right">
                    {r.velocity == null ? <span className="text-muted-foreground">—</span> : (
                      <span className={`font-mono ${r.velocity > 0 ? "text-green-600" : r.velocity < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                        {r.velocity > 0 ? "+" : ""}{Math.round(r.velocity * 100)} pts
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

interface FunnelData {
  summary: { correct: number; listingClicks: number; purchases: number; revenueCents: number; clickThroughRate: number; conversionRate: number };
  topSets: { gameSetId: string; setName: string | null; correct: number; listingClicks: number; clickThroughRate: number }[];
}

function FunnelPanel({ windowDays }: { windowDays: number }) {
  const { data, isLoading } = useQuery<FunnelData>({
    queryKey: ["/api/admin/analytics/funnel", windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/funnel?window=${windowDays}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load funnel");
      return res.json();
    },
  });
  const s = data?.summary;
  const stages = s ? [
    { label: "Correct answers", value: s.correct },
    { label: "Listing clicks", value: s.listingClicks, rate: s.clickThroughRate },
    { label: "Purchases", value: s.purchases, rate: s.conversionRate },
  ] : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" /> Commerce Intent Funnel
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !s ? (
          <p className="text-sm text-muted-foreground text-center py-10">No funnel data yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {stages.map((st) => (
                <div key={st.label} className="rounded-lg border p-3">
                  <p className="text-2xl font-bold font-mono">{st.value.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{st.label}</p>
                  {st.rate != null && <p className="text-xs text-primary mt-1">{(st.rate * 100).toFixed(1)}% conv.</p>}
                </div>
              ))}
            </div>
            <p className="text-sm">Attributed revenue: <span className="font-mono font-bold">${(s.revenueCents / 100).toFixed(2)}</span></p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AlphaData {
  players: number;
  aggregateByLag: { lag: number; avgCorr: number; n: number }[];
  bestLag: { lag: number; avgCorr: number } | null;
  watchlist: { playerKey: string; attentionVelocity: number; priceChangePct: number | null }[];
  caveat: string | null;
}

function AttentionAlphaPanel() {
  const { data, isLoading } = useQuery<AlphaData>({
    queryKey: ["/api/admin/analytics/attention-alpha"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/attention-alpha`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attention alpha");
      return res.json();
    },
  });

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <LineChart className="h-4 w-4 text-primary" /> Attention Alpha — does attention lead price?
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground text-center py-10">No data.</p>
        ) : (
          <div className="space-y-4">
            {data.caveat && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{data.caveat}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-bold font-mono">{data.players}</p>
                <p className="text-xs text-muted-foreground">players with paired attention + price series</p>
              </div>
              <div className="rounded-lg border p-3">
                {data.bestLag ? (
                  <>
                    <p className="text-2xl font-bold font-mono">+{data.bestLag.lag}d · r={data.bestLag.avgCorr.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">peak lead: attention precedes price by {data.bestLag.lag} days</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold font-mono text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground">lead/lag emerges as history accrues</p>
                  </>
                )}
              </div>
            </div>
            {data.watchlist.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Attention-leading watchlist (rising attention, price not yet moved)</p>
                <div className="flex flex-wrap gap-2">
                  {data.watchlist.slice(0, 8).map((w) => (
                    <Badge key={w.playerKey} variant="outline" className="gap-1">
                      {w.playerKey.split(":").slice(1).join(":").replace(/\b\w/g, c => c.toUpperCase())}
                      <span className="text-green-600">+{Math.round(w.attentionVelocity)}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Mover { key: string; label: string; current: number; previous: number; velocity: number; pctChange: number | null; }
interface TrendingData { playersUp: Mover[]; playersDown: Mover[]; setsUp: Mover[]; eras: Mover[]; windowDays: number; }

function cap(s: string) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

function MoverList({ title, movers, dir }: { title: string; movers: Mover[]; dir: "up" | "down" }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">{title}</p>
      {movers.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="space-y-1">
          {movers.slice(0, 6).map((m) => (
            <div key={m.key} className="flex items-center justify-between text-sm">
              <span className="truncate">{cap(m.label)}</span>
              <span className={`font-mono text-xs shrink-0 ${dir === "up" ? "text-green-600" : "text-red-600"}`}>
                {m.velocity > 0 ? "+" : ""}{m.velocity}{m.pctChange != null ? ` (${Math.round(m.pctChange * 100)}%)` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketPulsePanel() {
  const { data, isLoading } = useQuery<TrendingData>({
    queryKey: ["/api/admin/analytics/trending"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/trending?window=7`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trending");
      return res.json();
    },
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Market Pulse — 7-day movers
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <MoverList title="Players rising" movers={data.playersUp} dir="up" />
            <MoverList title="Players cooling" movers={data.playersDown} dir="down" />
            <MoverList title="Sets rising" movers={data.setsUp} dir="up" />
            <MoverList title="Eras" movers={data.eras} dir="up" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function prettyPlayer(key: string): string {
  const name = key.includes(":") ? key.split(":").slice(1).join(":") : key;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminAnalytics() {
  const [windowDays, setWindowDays] = useState(30);

  const { data, isLoading } = useQuery<{ rows: AttentionRow[] }>({
    queryKey: ["/api/admin/analytics/attention", windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/attention?window=${windowDays}&limit=100`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attention index");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-primary" /> Collector Intelligence
          </h1>
          <p className="text-muted-foreground">Card Attention Index — the demand signal per player (clean layer)</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((w) => (
            <Button key={w} size="sm" variant={windowDays === w ? "default" : "outline"} onClick={() => setWindowDays(w)}>
              {w}d
            </Button>
          ))}
        </div>
      </div>

      <MarketPulsePanel />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Attention Leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              No attention data yet. Signal accrues as users play — the asset compounds daily.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">Player</th>
                  <th className="text-right px-4 py-2 font-medium">CAI</th>
                  <th className="text-right px-4 py-2 font-medium">Plays</th>
                  <th className="text-right px-4 py-2 font-medium">Reach</th>
                  <th className="text-right px-4 py-2 font-medium">Recognition</th>
                  <th className="text-right px-4 py-2 font-medium">Velocity 7d</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.playerKey} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-2 text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-4 py-2 font-medium">{prettyPlayer(r.playerKey)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className="font-mono font-bold">{r.cai}</span>
                        <span className="h-1.5 w-16 rounded bg-muted overflow-hidden inline-block align-middle">
                          <span className="block h-full bg-primary" style={{ width: `${r.cai}%` }} />
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{r.plays.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{r.uniqueUsers.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.recognitionRate != null ? `${Math.round(r.recognitionRate * 100)}%` : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {r.velocity7 === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant="outline" className={`gap-1 ${r.velocity7 > 0 ? "text-green-600 border-green-300" : "text-red-600 border-red-300"}`}>
                          {r.velocity7 > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {r.velocity7 > 0 ? "+" : ""}{Math.round(r.velocity7)}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <RecognitionPanel windowDays={windowDays} />
      <FunnelPanel windowDays={windowDays} />
      <AttentionAlphaPanel />
    </div>
  );
}
