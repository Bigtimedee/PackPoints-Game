import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Zap, Trophy, Target, Flame, Star, Lock } from "lucide-react";

interface UserStats {
  gamesPlayed: number;
  correctAnswers: number;
  totalAnswers: number;
  points: number;
  streakDays?: number;
}

interface AchievementDef {
  id: string;
  label: string;
  description: string;
  icon: typeof Zap;
  color: string;
  bg: string;
  check: (stats: UserStats) => boolean;
}

const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first_game",
    label: "First Game",
    description: "Played your first game",
    icon: Trophy,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    check: (s) => s.gamesPlayed >= 1,
  },
  {
    id: "sharp_eye",
    label: "Sharp Eye",
    description: "90%+ accuracy across all games",
    icon: Target,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    check: (s) => s.totalAnswers >= 10 && s.correctAnswers / s.totalAnswers >= 0.9,
  },
  {
    id: "streak_7",
    label: "7-Day Streak",
    description: "Played 7 days in a row",
    icon: Flame,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    check: (s) => (s.streakDays ?? 0) >= 7,
  },
  {
    id: "streak_30",
    label: "30-Day Streak",
    description: "Played 30 days in a row",
    icon: Flame,
    color: "text-red-500",
    bg: "bg-red-500/10",
    check: (s) => (s.streakDays ?? 0) >= 30,
  },
  {
    id: "century",
    label: "Century Club",
    description: "Played 100 games",
    icon: Star,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    check: (s) => s.gamesPlayed >= 100,
  },
  {
    id: "point_master",
    label: "Point Master",
    description: "Earned 10,000 total PackPTS",
    icon: Zap,
    color: "text-green-500",
    bg: "bg-green-500/10",
    check: (s) => s.points >= 10000,
  },
];

interface AchievementBadgesProps {
  stats: UserStats;
}

function AchievementBadge({ achievement, earned }: { achievement: AchievementDef; earned: boolean }) {
  const Icon = achievement.icon;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all cursor-default ${
              earned
                ? `${achievement.bg} border-transparent`
                : "bg-muted/30 border-border opacity-50"
            }`}
            aria-label={`${achievement.label}: ${earned ? "Earned" : "Locked"}`}
          >
            <div className={`p-2 rounded-lg ${earned ? achievement.bg : "bg-muted"}`}>
              {earned ? (
                <Icon className={`w-5 h-5 ${achievement.color}`} />
              ) : (
                <Lock className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <span className="text-xs font-medium text-center leading-tight">{achievement.label}</span>
            {earned && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">Earned</Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm font-medium">{achievement.label}</p>
          <p className="text-xs text-muted-foreground">{achievement.description}</p>
          {!earned && <p className="text-xs text-orange-400 mt-1">Not yet earned</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AchievementBadges({ stats }: AchievementBadgesProps) {
  const earnedCount = ACHIEVEMENTS.filter(a => a.check(stats)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Achievements</h3>
        <span className="text-xs text-muted-foreground">{earnedCount}/{ACHIEVEMENTS.length} earned</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ACHIEVEMENTS.map(achievement => (
          <AchievementBadge
            key={achievement.id}
            achievement={achievement}
            earned={achievement.check(stats)}
          />
        ))}
      </div>
    </div>
  );
}

interface AmbassadorBadgeProps {
  tier: string | null;
  referralCount: number;
}

export function AmbassadorBadge({ tier, referralCount }: AmbassadorBadgeProps) {
  if (!tier) return null;

  const colors: Record<string, { color: string; bg: string; label: string }> = {
    bronze: { color: 'text-amber-600', bg: 'bg-amber-600/10', label: 'Bronze Ambassador' },
    silver: { color: 'text-slate-400', bg: 'bg-slate-400/10', label: 'Silver Ambassador' },
    gold: { color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Gold Ambassador' },
  };

  const tierData = colors[tier];
  if (!tierData) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${tierData.bg} cursor-default`}>
            <span className={`text-sm font-semibold ${tierData.color}`}>{tierData.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm font-medium">Ambassador Badge</p>
          <p className="text-xs text-muted-foreground">{referralCount} successful referrals</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
