import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface AffiliateDisclosureProps {
  variant?: "compact" | "full";
  className?: string;
}

export function AffiliateDisclosure({ variant = "compact", className = "" }: AffiliateDisclosureProps) {
  if (variant === "compact") {
    return (
      <p className={`text-xs text-muted-foreground text-center ${className}`} data-testid="text-affiliate-disclosure">
        Prices sourced from third-party marketplaces. Links may include affiliate tracking.
      </p>
    );
  }

  return (
    <Card className={className} data-testid="card-affiliate-disclosure">
      <CardContent className="p-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Prices and availability are sourced from third-party marketplaces (eBay, Goldin Auctions).
            PackPoints is not responsible for listing accuracy.
          </p>
          <p>
            Some links may include affiliate tracking. PackPoints may earn a commission on purchases
            made through these links at no additional cost to you.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
