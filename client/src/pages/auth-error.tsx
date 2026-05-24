import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, ExternalLink, Shield, Link2Off, Timer, Mail } from "lucide-react";
import { Link } from "wouter";

const ERROR_CONFIGS: Record<string, { title: string; icon: React.ReactNode; description: string; showRetry?: boolean }> = {
  IDENTITY_IN_USE: {
    title: "Account Already Linked",
    icon: <Link2Off className="h-6 w-6 text-destructive" />,
    description: "This login method is already connected to a different PackPTS account. Each login can only be linked to one account.",
    showRetry: false,
  },
  CHALLENGE_EXPIRED: {
    title: "Link Request Expired",
    icon: <Timer className="h-6 w-6 text-destructive" />,
    description: "Your account linking request has expired. Please try again to link your accounts.",
    showRetry: true,
  },
  VERIFICATION_REQUIRED: {
    title: "Verification Required",
    icon: <Shield className="h-6 w-6 text-amber-500" />,
    description: "This account requires email verification before linking. Please check your email for a verification link.",
    showRetry: true,
  },
  INVALID_TOKEN: {
    title: "Invalid Verification Link",
    icon: <Mail className="h-6 w-6 text-destructive" />,
    description: "The verification link is invalid or has already been used. Please request a new one.",
    showRetry: true,
  },
  TOKEN_EXPIRED: {
    title: "Link Expired",
    icon: <Timer className="h-6 w-6 text-destructive" />,
    description: "The verification link has expired. Please request a new one.",
    showRetry: true,
  },
  WRONG_ACCOUNT: {
    title: "Wrong Account",
    icon: <AlertCircle className="h-6 w-6 text-destructive" />,
    description: "You need to log in to the account that owns this email address.",
    showRetry: true,
  },
};

export default function AuthError() {
  const searchParams = new URLSearchParams(window.location.search);
  const reason = searchParams.get('reason');
  const code = searchParams.get('code');
  const isInvalidDomain = reason === 'invalid_domain';
  
  const errorConfig = code ? ERROR_CONFIGS[code] : null;
  
  const isInEmbeddedWebview = (() => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  })();

  if (errorConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              {errorConfig.icon}
            </div>
            <CardTitle>{errorConfig.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground">
              {errorConfig.description}
            </p>

            {code === "IDENTITY_IN_USE" && (
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <p className="font-medium">What you can do:</p>
                <ul className="text-muted-foreground space-y-1 list-disc pl-4">
                  <li>Log in directly with your existing login method</li>
                  <li>Use a different account for this login method</li>
                  <li>Contact support if you need to merge accounts</li>
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {errorConfig.showRetry && (
                <Button asChild className="w-full gap-2">
                  <a href="/api/login">
                    Try Again
                  </a>
                </Button>
              )}
              <Link href="/">
                <Button variant={errorConfig.showRetry ? "outline" : "default"} className="w-full gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
                Login is only available from the official app URL.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <p className="font-medium flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  How to Log In
                </p>
                <ol className="text-muted-foreground space-y-1 list-decimal pl-4">
                  <li>Navigate to the official PackPoints app URL</li>
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
