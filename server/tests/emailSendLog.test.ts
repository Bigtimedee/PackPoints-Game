import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resend } from "resend";
import { maskEmailAddress, sendEmail, setEmailClientForTests } from "../services/emailService";

describe("sendEmail success log", () => {
  afterEach(() => {
    setEmailClientForTests(null);
    vi.restoreAllMocks();
  });

  it("masks a recipient as the first character plus the domain", () => {
    expect(maskEmailAddress("dave@packpts.com")).toBe("d***@packpts.com");
    expect(maskEmailAddress("not-an-email")).toBe("***");
  });

  it("logs the Resend id and masked recipient, never the body or token", async () => {
    const token = "reset-token-9f3c1a";
    const send = vi.fn(async () => ({ data: { id: "msg_abc123" }, error: null }));
    setEmailClientForTests({ emails: { send } } as unknown as Resend);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = `<a href="https://packpts.com/reset-password?token=${token}">Reset</a>`;
    const ok = await sendEmail({
      to: "dave@packpts.com",
      subject: "Reset Your PackPTS Password",
      html,
      text: `link token=${token}`,
    });

    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const logged = [log, error, warn].flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
    expect(logged).toContain("[EmailService] Email sent id=msg_abc123 subject=Reset Your PackPTS Password to=d***@packpts.com");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("dave@packpts.com");
    expect(logged).not.toContain("reset-password");
    expect(logged).not.toContain(html);
  });
});
