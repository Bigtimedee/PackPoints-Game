/**
 * Production session cookies are first-party (packpts.com SPA + apex WorkOS).
 * SameSite=Lax is required: None would send the cookie on cross-site POSTs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "../auth/session";

describe("getSessionCookieOptions", () => {
  const savedNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
  });

  it("uses SameSite=Lax in production (not None)", () => {
    process.env.NODE_ENV = "production";
    const cookie = getSessionCookieOptions();
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
  });

  it("uses SameSite=Lax without Secure on development HTTP localhost", () => {
    process.env.NODE_ENV = "development";
    const cookie = getSessionCookieOptions();
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(false);
  });
});
