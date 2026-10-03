import { describe, it, expect } from "vitest";
import { resolveAdminActorId } from "../auth/adminActor";

describe("resolveAdminActorId", () => {
  it("uses the OAuth claim when present", () => {
    expect(resolveAdminActorId({ user: { claims: { sub: "oauth-1" } }, session: { localUserId: "local-1" } } as any)).toBe("oauth-1");
  });
  it("falls back to the local-login session id", () => {
    expect(resolveAdminActorId({ session: { localUserId: "local-1" } } as any)).toBe("local-1");
  });
  it("does not read req.user.id and returns undefined with no actor", () => {
    expect(resolveAdminActorId({ user: { id: "legacy" } } as any)).toBeUndefined();
    expect(resolveAdminActorId({} as any)).toBeUndefined();
  });
});
