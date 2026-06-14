import { test, expect, request } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:5001";

test.describe("Auth E2E — local credentials flow after OIDC purge", () => {
  const stamp = Date.now();
  const username = `e2eauth_${stamp}`.slice(0, 20);
  const email = `e2eauth+${stamp}@example.com`;
  const password = `e2e-pass-${stamp}`;
  let createdUserId: string | null = null;

  test("signup → logout → login → /api/friends auth gate → forgot password", async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });

    const registerRes = await ctx.post("/api/auth/register", {
      data: { username, email, password },
    });
    expect(registerRes.status(), "register status").toBe(200);
    const registerBody = await registerRes.json();
    expect(registerBody.success).toBe(true);
    expect(registerBody.user?.username).toBe(username);
    createdUserId = registerBody.user?.id ?? null;

    const friendsLoggedIn = await ctx.get("/api/friends");
    expect(friendsLoggedIn.status(), "/api/friends while session is fresh").toBe(200);

    const logoutRes = await ctx.post("/api/auth/local-logout");
    expect([200, 204]).toContain(logoutRes.status());

    const friendsLoggedOut = await ctx.get("/api/friends");
    expect(friendsLoggedOut.status(), "/api/friends after logout must be 401").toBe(401);
    const friendsLoggedOutBody = await friendsLoggedOut.json().catch(() => ({}));
    expect(friendsLoggedOutBody).toEqual({ message: "Unauthorized" });
    expect(JSON.stringify(friendsLoggedOutBody)).not.toMatch(/_probe|sentinel|hasWorkosUserId|sessionKeys/);

    const loginRes = await ctx.post("/api/auth/local-login", {
      data: { usernameOrEmail: email, password },
    });
    expect(loginRes.status(), "local-login status").toBe(200);

    const friendsBackIn = await ctx.get("/api/friends");
    expect(friendsBackIn.status(), "/api/friends after re-login").toBe(200);

    const forgotRes = await ctx.post("/api/auth/forgot-password", {
      data: { email },
    });
    expect(forgotRes.status(), "forgot-password always returns 200").toBe(200);
    const forgotBody = await forgotRes.json();
    expect(forgotBody.success).toBe(true);

    await ctx.dispose();
  });

  test("cleanup: emit the test user id for post-run DB cleanup", async () => {
    test.skip(!createdUserId, "no user was created");
    console.log(`[AuthE2E] Created test user id: ${createdUserId} (username=${username}, email=${email})`);
  });
});
