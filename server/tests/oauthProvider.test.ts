import { describe, expect, it } from "vitest";
import { signupMethodFromAuth, workosAuthorizeProvider } from "../services/oauthProvider";

describe("workosAuthorizeProvider", () => {
  it("allows Google and Apple and falls back otherwise", () => {
    expect(workosAuthorizeProvider("GoogleOAuth")).toBe("GoogleOAuth");
    expect(workosAuthorizeProvider("AppleOAuth")).toBe("AppleOAuth");
    expect(workosAuthorizeProvider("authkit")).toBe("authkit");
    expect(workosAuthorizeProvider(undefined)).toBe("authkit");
    expect(workosAuthorizeProvider("GitHubOAuth")).toBe("authkit");
    expect(workosAuthorizeProvider(["AppleOAuth"])).toBe("AppleOAuth");
    expect(workosAuthorizeProvider(["nope", "GoogleOAuth"])).toBe("authkit");
  });
});

describe("signupMethodFromAuth", () => {
  it("maps the IdP method ahead of the button the user pressed", () => {
    expect(signupMethodFromAuth("GoogleOAuth", "apple")).toBe("google");
    expect(signupMethodFromAuth("AppleOAuth", "google")).toBe("apple");
    expect(signupMethodFromAuth(undefined, "google")).toBe("google");
    expect(signupMethodFromAuth(undefined, "apple")).toBe("apple");
    expect(signupMethodFromAuth("Password", "workos")).toBe("workos");
    expect(signupMethodFromAuth(undefined, undefined)).toBe("workos");
    expect(signupMethodFromAuth("SSO", "google")).toBe("google");
  });
});
