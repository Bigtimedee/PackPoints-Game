import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Gamepad2, Star, Target, CreditCard, CheckCircle, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface DashboardData {
  overview: {
    totalUsers: number;
    totalPoints: number;
    totalGames: number;
    avgAccuracy: number;
    totalCards: number;
    verifiedCards: number;
  };
  topPlayers: { username: string; points: number; gamesPlayed: number }[];
  mostActive: { username: string; gamesPlayed: number; points: number }[];
}

export default function AdminDashboard() {
  const adminKey = localStorage.getItem("packpoints_admin_key") || "";
  
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard"],
    queryFn: async () => {
      const response = await fetch("/api/admin/dashboard", {
        headers: { "X-Admin-Key": adminKey },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch dashboard data");
      }
      return response.json();
    },
    enabled: !!adminKey,
  });

  if (!adminKey) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Please enter your admin key to access the dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">
            <p>Failed to load dashboard data. Please check your admin key.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const statCards = [
    { title: "Total Users", value: data.overview.totalUsers.toLocaleString(), icon: Users, color: "text-blue-500" },
    { title: "Total Games", value: data.overview.totalGames.toLocaleString(), icon: Gamepad2, color: "text-green-500" },
    { title: "Total Points", value: data.overview.totalPoints.toLocaleString(), icon: Star, color: "text-yellow-500" },
    { title: "Avg Accuracy", value: `${data.overview.avgAccuracy}%`, icon: Target, color: "text-purple-500" },
    { title: "Total Cards", value: data.overview.totalCards.toString(), icon: CreditCard, color: "text-orange-500" },
    { title: "Verified Cards", value: data.overview.verifiedCards.toString(), icon: CheckCircle, color: "text-emerald-500" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-dashboard-title">Admin Dashboard</h1>
        <p className="text-muted-foreground">Overview of PackPoints platform statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s/g, '-')}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                  <span className="text-xs text-muted-foreground">{stat.title}</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stat.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Players by Points</CardTitle>
            <CardDescription>Highest earning players on the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topPlayers} layout="vertical">
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="username" width={100} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--background))", 
                      border: "1px solid hsl(var(--border))" 
                    }} 
                  />
                  <Bar dataKey="points" fill="hsl(var(--primary))" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most Active Players</CardTitle>
            <CardDescription>Players with the most games played</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.mostActive} layout="vertical">
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="username" width={100} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--background))", 
                      border: "1px solid hsl(var(--border))" 
                    }} 
                  />
                  <Bar dataKey="gamesPlayed" fill="hsl(var(--chart-2))" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Players</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.topPlayers.map((player, index) => (
                <div key={player.username} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Badge variant={index === 0 ? "default" : "secondary"}>{index + 1}</Badge>
                    <span className="font-medium">{player.username}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold">{player.points.toLocaleString()} pts</p>
                    <p className="text-xs text-muted-foreground">{player.gamesPlayed} games</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.mostActive.map((player, index) => (
                <div key={player.username} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Badge variant={index === 0 ? "default" : "secondary"}>{index + 1}</Badge>
                    <span className="font-medium">{player.username}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold">{player.gamesPlayed} games</p>
                    <p className="text-xs text-muted-foreground">{player.points.toLocaleString()} pts</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
