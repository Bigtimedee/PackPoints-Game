import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, Clock, Zap } from "lucide-react";

const STATUS_CONFIG = {
  done: { label: "Done", icon: CheckCircle, color: "text-green-500", badgeVariant: "default" as const },
  in_progress: { label: "In Progress", icon: Zap, color: "text-blue-500", badgeVariant: "secondary" as const },
  planned: { label: "Planned", icon: Clock, color: "text-orange-500", badgeVariant: "outline" as const },
  considering: { label: "Considering", icon: Circle, color: "text-muted-foreground", badgeVariant: "outline" as const },
};

const ROADMAP_ITEMS = [
  // Done
  { status: "done", category: "Game", title: "Solo challenge mode", description: "Guess players from card images to earn PackPTS." },
  { status: "done", category: "Game", title: "1v1 friend matches", description: "Challenge friends with a shared join code." },
  { status: "done", category: "Game", title: "Daily 5 challenge", description: "5 curated cards per day with streak tracking." },
  { status: "done", category: "Rewards", title: "PackPTS wallet", description: "Earn, track, and redeem points." },
  { status: "done", category: "Rewards", title: "eBay marketplace redemption", description: "Use PackPTS for eBay card discounts." },
  { status: "done", category: "Social", title: "Global leaderboard", description: "See who's leading in PackPTS earned." },
  // In Progress
  { status: "in_progress", category: "Game", title: "Tournament mode", description: "Bracket-style competitions with prize pools." },
  { status: "in_progress", category: "Discovery", title: "Card of the Day", description: "Daily featured mystery card with community discussion." },
  { status: "in_progress", category: "Social", title: "Creator program", description: "Partner with sports card content creators." },
  // Planned
  { status: "planned", category: "Game", title: "Team-based mode", description: "2v2 and 3v3 team competitions." },
  { status: "planned", category: "Game", title: "Speed round mode", description: "30-second rapid-fire card identification." },
  { status: "planned", category: "Discovery", title: "Set browser", description: "Browse all available card sets and their difficulty ratings." },
  { status: "planned", category: "Rewards", title: "Goldin Auctions integration", description: "Bid on premium auctions using PackPTS." },
  { status: "planned", category: "Social", title: "Discord bot integration", description: "Daily challenges and leaderboard updates in your Discord server." },
  { status: "planned", category: "Mobile", title: "Native mobile app", description: "iOS and Android apps for on-the-go play." },
  // Considering
  { status: "considering", category: "Game", title: "Custom set creation", description: "Create and share your own card quiz sets." },
  { status: "considering", category: "Rewards", title: "PackPTS marketplace", description: "Trade PackPTS with other players." },
  { status: "considering", category: "Social", title: "Clans/Teams", description: "Create or join a team and compete on team leaderboards." },
];

type StatusKey = keyof typeof STATUS_CONFIG;

export default function Roadmap() {
  const statuses: StatusKey[] = ["in_progress", "planned", "done", "considering"];

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-3">PackPTS Roadmap</h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Here's what we're building. Priorities shift based on your feedback — let us know what matters most!
          </p>
          <div className="flex flex-wrap gap-3 justify-center mt-4">
            {statuses.map(status => {
              const config = STATUS_CONFIG[status];
              const Icon = config.icon;
              return (
                <div key={status} className="flex items-center gap-1.5 text-sm">
                  <Icon className={`h-4 w-4 ${config.color}`} />
                  <span>{config.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {statuses.map(status => {
          const items = ROADMAP_ITEMS.filter(item => item.status === status);
          if (items.length === 0) return null;

          const config = STATUS_CONFIG[status];
          const Icon = config.icon;

          return (
            <div key={status} className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Icon className={`h-5 w-5 ${config.color}`} />
                <h2 className="text-lg font-semibold">{config.label}</h2>
                <Badge variant={config.badgeVariant}>{items.length}</Badge>
              </div>
              <div className="grid gap-3">
                {items.map((item, i) => (
                  <Card key={i} className={status === "done" ? "opacity-70" : ""}>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-semibold">{item.title}</CardTitle>
                        <Badge variant="outline" className="text-xs flex-shrink-0">{item.category}</Badge>
                      </div>
                      <CardDescription className="text-xs">{item.description}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}

        <div className="text-center mt-10 p-6 rounded-lg bg-muted/30">
          <p className="text-sm font-medium mb-2">Have a feature idea?</p>
          <p className="text-sm text-muted-foreground mb-4">Use the feedback button (bottom right) to submit feature requests. We read every one.</p>
        </div>
      </div>
    </div>
  );
}
