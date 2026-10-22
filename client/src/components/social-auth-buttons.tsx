import { Button } from "@/components/ui/button";
import { startWorkosAuth } from "@/lib/attribution";
import { trackSignupStarted } from "@/lib/signupFunnel";

type Surface = "auth" | "modal";

/**
 * Primary Google and Apple sign-in. Both go through WorkOS. The word WorkOS
 * is not shown to users.
 */
export function SocialAuthButtons({ surface, disabled }: { surface: Surface; disabled?: boolean }) {
  const start = (method: "google" | "apple", provider: "GoogleOAuth" | "AppleOAuth") => {
    trackSignupStarted(method, surface);
    void startWorkosAuth(`/api/auth/workos/start?signupSurface=${surface}&provider=${provider}`);
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full min-h-11"
        disabled={disabled}
        onClick={() => start("google", "GoogleOAuth")}
        data-testid={`button-${surface}-google`}
      >
        Continue with Google
      </Button>
      <Button
        type="button"
        className="w-full min-h-11"
        disabled={disabled}
        onClick={() => start("apple", "AppleOAuth")}
        data-testid={`button-${surface}-apple`}
      >
        Continue with Apple
      </Button>
      <p className="text-center text-xs text-muted-foreground">or use email</p>
    </div>
  );
}
