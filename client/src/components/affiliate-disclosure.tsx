import { Info } from "lucide-react";

/** FTC / EPN affiliate disclosure, shown next to every eBay link and on /points. */
export const AFFILIATE_DISCLOSURE = "PackPTS earns a commission on eBay purchases through our links.";
import { Card, CardContent } from "@/components/ui/card";

interface AffiliateDisclosureProps {
  variant?: "compact" | "full";
  className?: string;
}

export function AffiliateDisclosure({ variant = "compact", className = "" }: AffiliateDisclosureProps) {
  if (variant === "compact") {
    return (
      <p className={`text-xs text-muted-foreground text-center ${className}`} data-testid="text-affiliate-disclosure">
        {AFFILIATE_DISCLOSURE}
      </p>
    );
  }

  return (
    <Card className={className} data-testid="card-affiliate-disclosure">
      <CardContent className="p-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Prices and availability are sourced from third-party marketplaces (eBay).
            PackPTS is not responsible for listing accuracy.
          </p>
          <p>
            {AFFILIATE_DISCLOSURE} It costs you nothing extra.
          </p>
          <p>
            Applying PackPTS reserves or spends points in your PackPTS wallet. It does not change
            the price eBay charges.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
