import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  IDENTIFY_FAIL_BORDER,
  IDENTIFY_RETRY_COPY,
  MAKE_GREEN,
  identifySlotChrome,
} from "@/lib/makeIdentifyUi";
import { Check, Loader2, X } from "lucide-react";

interface IdentifiedCard {
  playerName: string;
  year: number;
  brand: string;
  confidence: "high" | "medium" | "low";
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "bg-green-500/10 text-green-700",
  medium: "bg-yellow-500/10 text-yellow-700",
  low: "bg-muted text-muted-foreground",
};

interface MakeIdentifySlotProps {
  fileName: string;
  status: "queued" | "loading" | "ok" | "error";
  card?: IdentifiedCard;
  detail?: string;
  onRemove: () => void;
  onTryAgain: () => void;
  onSkip: () => void;
}

export function MakeIdentifySlot({
  fileName,
  status,
  card,
  detail,
  onRemove,
  onTryAgain,
  onSkip,
}: MakeIdentifySlotProps) {
  const chrome = identifySlotChrome(status);

  return (
    <div
      data-testid="make-identify-slot"
      data-status={status}
      className="relative rounded-lg border bg-card p-3 flex flex-col gap-1"
      style={chrome.failBorder ? { borderColor: IDENTIFY_FAIL_BORDER } : undefined}
    >
      <button
        type="button"
        className="absolute top-2 right-2 rounded-full p-0.5 hover:bg-muted"
        onClick={onRemove}
        aria-label="Remove card"
      >
        <X className="h-3 w-3" />
      </button>
      <p className="text-xs text-muted-foreground truncate pr-5">{fileName}</p>

      {status === "queued" && (
        <p className="text-xs text-muted-foreground">{chrome.label}</p>
      )}
      {status === "loading" && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {chrome.label}
        </div>
      )}
      {status === "ok" && card && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 pr-5">
            <Check className="h-3.5 w-3.5 shrink-0" style={{ color: MAKE_GREEN }} aria-hidden />
            <p className="text-sm font-semibold">{card.playerName}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {card.year} · {card.brand}
          </p>
          <Badge className={`text-xs ${CONFIDENCE_COLOR[card.confidence]}`}>
            {card.confidence} confidence
          </Badge>
        </div>
      )}
      {status === "error" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{IDENTIFY_RETRY_COPY.failed}</p>
          {detail && detail !== IDENTIFY_RETRY_COPY.failed && (
            <p className="text-xs text-muted-foreground/80">{detail}</p>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={onTryAgain}
              data-testid="make-try-again"
            >
              {IDENTIFY_RETRY_COPY.tryAgain}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={onSkip}
              data-testid="make-skip"
            >
              {IDENTIFY_RETRY_COPY.skip}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
