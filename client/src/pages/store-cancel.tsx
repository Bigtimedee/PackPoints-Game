import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle, ShoppingCart, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function StoreCancel() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center">
          <XCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          
          <h1 className="text-2xl font-bold mb-2" data-testid="text-cancel-title">
            Purchase Cancelled
          </h1>
          <p className="text-muted-foreground mb-8">
            No worries! Your purchase was cancelled and you weren't charged. 
            Come back anytime to get PackPTS.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="outline" asChild>
              <Link href="/" data-testid="link-home">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back Home
              </Link>
            </Button>
            <Button asChild data-testid="link-try-again">
              <Link href="/store">
                <ShoppingCart className="h-4 w-4 mr-2" />
                Try Again
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
