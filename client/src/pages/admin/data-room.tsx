import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, ShieldCheck, ShieldAlert, Sparkles } from "lucide-react";

interface DataRoom {
  thesis: string;
  dataset: {
    totalEvents: number; eventsLast7Days: number; distinctPlayers: number; distinctSets: number;
    attentionDaysCaptured: number; priceSnapshots: number; priceDaysCaptured: number; historyDays: number;
    firstEventAt: string | null; lastEventAt: string | null;
  };
  signatureIndices: { name: string; api: string }[];
  attentionAlpha: { players: number; bestLag: { lag: number; avgCorr: number } | null; caveat: string | null };
  governance: { pii: { clean: boolean }; dataQuality: { healthy: boolean; martReconciled: boolean } };
  exports: string[];
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-2xl font-bold font-mono">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

export default function AdminDataRoom() {
  const { data, isLoading } = useQuery<DataRoom>({
    queryKey: ["/api/admin/analytics/data-room"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/data-room`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load data room");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!data) return null;

  const d = data.dataset;
  const govOk = data.governance.pii.clean && data.governance.dataQuality.healthy;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Sparkles className="h-7 w-7 text-primary" /> Acquisition Data Room</h1>
        <p className="text-muted-foreground">Diligence-ready view of the Collector Intelligence asset</p>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <p className="text-sm italic">{data.thesis}</p>
        </CardContent>
      </Card>

      <div>
        <p className="text-sm font-medium mb-2">Dataset scale &amp; time-depth</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total demand-signal events" value={d.totalEvents} />
          <Stat label="Events (last 7 days)" value={d.eventsLast7Days} />
          <Stat label="Distinct players tracked" value={d.distinctPlayers} />
          <Stat label="Distinct sets" value={d.distinctSets} />
          <Stat label="Days of attention history" value={d.attentionDaysCaptured} />
          <Stat label="Price snapshots" value={d.priceSnapshots} />
          <Stat label="Days of price history" value={d.priceDaysCaptured} />
          <Stat label="Asset age (days)" value={d.historyDays} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Attention Alpha (attention → price)</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">Paired players: <span className="font-mono font-bold">{data.attentionAlpha.players}</span></p>
            {data.attentionAlpha.bestLag ? (
              <p className="text-sm mt-1">Peak lead: <span className="font-mono font-bold">+{data.attentionAlpha.bestLag.lag}d, r={data.attentionAlpha.bestLag.avgCorr.toFixed(2)}</span></p>
            ) : (
              <p className="text-sm mt-1 text-muted-foreground">Lead/lag emerges as history accrues.</p>
            )}
            {data.attentionAlpha.caveat && <p className="text-xs text-amber-600 mt-2">{data.attentionAlpha.caveat}</p>}
          </CardContent>
        </Card>
        <Card className={govOk ? "border-green-300" : "border-amber-300"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {govOk ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-amber-600" />}
              Diligence readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>PII-free asset: <Badge variant="outline" className={data.governance.pii.clean ? "text-green-600 border-green-300" : "text-red-600 border-red-300"}>{data.governance.pii.clean ? "pass" : "fail"}</Badge></p>
            <p>Marts reconciled: <Badge variant="outline">{data.governance.dataQuality.martReconciled ? "yes" : "no"}</Badge></p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Exports &amp; API</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Whitelisted marts — CSV download (the read-only Analytics API mirrors these):</p>
          <div className="flex flex-wrap gap-2">
            {data.exports.map((t) => (
              <Button key={t} asChild size="sm" variant="outline">
                <a href={`/api/admin/analytics/export/${t}.csv`} download><Download className="h-3.5 w-3.5 mr-1" />{t}.csv</a>
              </Button>
            ))}
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            <p className="font-medium">Signature indices (documented read API):</p>
            <ul className="mt-1 space-y-0.5">
              {data.signatureIndices.map((s) => (
                <li key={s.api}><span className="text-foreground">{s.name}</span> — <code className="text-[11px]">{s.api}</code></li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
