import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";

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
    </div>
  );
}
