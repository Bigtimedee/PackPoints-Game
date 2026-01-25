import { useDailyProgress } from "@/hooks/use-daily-progress";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, TrendingUp, AlertTriangle } from "lucide-react";

export function DailyProgressBadge() {
  const { todayEarned, dailyCap, percentUsed, isAtCap, cardsCompleted, cardsMax, resetIn, isLoading } = useDailyProgress();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-1 w-16" />
        </div>
      </div>
    );
  }

  const formatResetTime = () => {
    if (resetIn.hours > 0) {
      return `${resetIn.hours}h ${resetIn.minutes}m`;
    }
    return `${resetIn.minutes}m`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-help ${
            isAtCap 
              ? "bg-amber-500/20 border border-amber-500/50" 
              : "bg-muted/50"
          }`}
          data-testid="daily-progress-badge"
        >
          {isAtCap ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium ${isAtCap ? "text-amber-500" : "text-muted-foreground"}`}>
                {cardsCompleted}/{cardsMax} cards
              </span>
            </div>
            <Progress 
              value={percentUsed} 
              className={`h-1 w-16 ${isAtCap ? "[&>div]:bg-amber-500" : ""}`}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        <div className="space-y-2">
          <p className="font-semibold">
            {isAtCap ? "Daily Limit Reached" : "Today's Progress"}
          </p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Cards completed:</span>
              <span className="font-medium text-foreground">{cardsCompleted}/{cardsMax}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>PackPTS earned:</span>
              <span className="font-medium text-foreground">{todayEarned.toLocaleString()}/{dailyCap.toLocaleString()}</span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {isAtCap 
              ? "You've reached the daily cap. Play again tomorrow to earn more PackPTS!"
              : `Complete ${cardsMax - cardsCompleted} more cards to max out today's earnings.`
            }
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Resets in {formatResetTime()}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
