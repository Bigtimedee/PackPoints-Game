import { describe, expect, it } from "vitest";
import { allocateLocalUsername, isUsernameConflict, usernameBaseFromEmail, usernameCandidate } from "../services/localUsername";

describe("username from email", () => {
  it("keeps a usable local part and falls back when it is too short", () => {
    expect(usernameBaseFromEmail("Casey.Jones@example.com")).toBe("CaseyJones");
    expect(usernameBaseFromEmail("ab@example.com")).toBe("player");
    expect(usernameBaseFromEmail("a.b+tag@example.com")).toBe("abtag");
    expect(usernameBaseFromEmail(`${"a".repeat(40)}@example.com`)).toHaveLength(16);
  });

  it("appends a counter without passing 20 characters", () => {
    expect(usernameCandidate("CaseyJones", 0)).toBe("CaseyJones");
    expect(usernameCandidate("a".repeat(16), 1000)).toHaveLength(20);
    expect(usernameCandidate("a".repeat(16), 1000).endsWith("1000")).toBe(true);
  });

  it("skips names that are already taken", async () => {
    const taken = new Set(["casey", "casey1"]);
    const name = await allocateLocalUsername("casey@example.com", async (candidate) => taken.has(candidate));
    expect(name).toBe("casey2");
  });

  it("treats only a username unique violation as a retry", () => {
    expect(isUsernameConflict({ code: "23505", constraint: "users_username_unique" })).toBe(true);
    expect(isUsernameConflict({ code: "23505", constraint: "users_email_unique" })).toBe(false);
    expect(isUsernameConflict({ code: "22001" })).toBe(false);
  });
});
