/** WorkOS User Management provider values the signup buttons may request. */
export type WorkosAuthorizeProvider = "GoogleOAuth" | "AppleOAuth" | "authkit";

/** Funnel method stored on signup_complete. Identity provider stays `workos`. */
export type OauthSignupMethod = "google" | "apple" | "workos";

const ALLOWED = new Set<string>(["GoogleOAuth", "AppleOAuth", "authkit"]);

function firstString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
}

/** Unknown or missing providers stay on AuthKit. Never forward an arbitrary string. */
export function workosAuthorizeProvider(raw: unknown): WorkosAuthorizeProvider {
  const value = firstString(raw);
  if (ALLOWED.has(value)) return value as WorkosAuthorizeProvider;
  return "authkit";
}

function methodOf(raw: string): OauthSignupMethod | null {
  if (raw === "GoogleOAuth" || raw === "google") return "google";
  if (raw === "AppleOAuth" || raw === "apple") return "apple";
  if (raw === "authkit" || raw === "workos") return "workos";
  return null;
}

/**
 * Prefer the IdP WorkOS reports. Fall back to the button the user pressed
 * when the token response omits authenticationMethod.
 */
export function signupMethodFromAuth(
  authenticationMethod: string | null | undefined,
  sessionMethod?: string | null,
): OauthSignupMethod {
  return methodOf(authenticationMethod || "") || methodOf(sessionMethod || "") || "workos";
}
