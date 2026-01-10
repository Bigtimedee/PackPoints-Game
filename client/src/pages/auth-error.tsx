import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function AuthError() {
  const searchParams = new URLSearchParams(window.location.search);
  const reason = searchParams.get('reason');
  const isInvalidDomain = reason === 'invalid_domain';
  
  const isInEmbeddedWebview = (() => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>
            {isInvalidDomain ? "Login Not Available Here" : "Login Error"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isInvalidDomain ? (
            <>
              <p className="text-center text-muted-foreground">
                Login is only available when accessing this app from the Replit preview.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <p className="font-medium flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  How to Log In
                </p>
                <ol className="text-muted-foreground space-y-1 list-decimal pl-4">
                  <li>Open this Repl in the Replit editor</li>
                  <li>Look for the "Preview" or "Webview" panel</li>
                  <li>Use the app from within that preview panel</li>
                  <li>Click "Log in" from there</li>
                </ol>
              </div>
            </>
          ) : (
            <>
              <p className="text-center text-muted-foreground">
                There was a problem signing you in. This can happen when:
              </p>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-6">
                <li>You're accessing the app from an external link</li>
                <li>The login session has expired</li>
                <li>You cancelled the login process</li>
              </ul>
              
              {isInEmbeddedWebview && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                  <p className="font-medium flex items-center gap-2 mb-1">
                    <ExternalLink className="h-4 w-4" />
                    Tip: Open in a New Tab
                  </p>
                  <p className="text-muted-foreground">
                    Click the "New tab" button in the preview header to open this app in a full browser tab, then try logging in again.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex flex-col gap-2 pt-2">
            {!isInvalidDomain && (
              <Button asChild className="w-full gap-2">
                <a href="/api/login">
                  Try Again
                </a>
              </Button>
            )}
            <Link href="/">
              <Button variant={isInvalidDomain ? "default" : "outline"} className="w-full gap-2">
                <ArrowLeft className="h-4 w-4" />
                {isInvalidDomain ? "Continue as Guest" : "Back to Home"}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
