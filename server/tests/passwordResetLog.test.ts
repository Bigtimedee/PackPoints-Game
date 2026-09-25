import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPasswordReset } from "../auth/passwordResetRequest";

const routesSrc = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");

function forgotPasswordHandler(): string {
  const start = routesSrc.indexOf('app.post("/api/auth/forgot-password"');
  const end = routesSrc.indexOf('app.get("/api/auth/validate-reset-token"');
  return routesSrc.slice(start, end);
}

describe("forgot-password failure log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never logs the reset token", async () => {
    const token = "tok_7c91e4b0-reset-secret";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestPasswordReset({
      email: "dave@packpts.com",
      getUserByEmail: async () => ({ id: "user-1" }),
      createPasswordResetToken: async () => ({ token }),
      sendPasswordResetEmail: async (email, sentToken, baseUrl) => {
        expect(email).toBe("dave@packpts.com");
        expect(sentToken).toBe(token);
        expect(baseUrl).toBe("https://packpts.com");
        return false;
      },
      baseUrl: "https://packpts.com",
    });

    expect(result.status).toBe(200);
    const logged = [log, error, warn].flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
    expect(logged).toContain("[Auth] Password reset email failed to=d***@packpts.com error=send failed");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("dave@packpts.com");
    expect(logged).not.toContain("reset-password");
    expect(logged).not.toContain("https://packpts.com");
  });

  it("the route handler does not interpolate the token into a log", () => {
    const handler = forgotPasswordHandler();
    expect(handler).toContain("requestPasswordReset");
    expect(handler).not.toContain("resetLink");
    expect(handler).not.toContain("resetToken");
    expect(handler).not.toContain("?token=");
  });
});
