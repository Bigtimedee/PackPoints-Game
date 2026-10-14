import { afterEach, describe, expect, it } from "vitest";
import { opsAlert, setOpsAlertSenderForTests, OPS_ALERT_EMAIL } from "../services/opsAlert";
import { checkDaily5Posted, ctNow, isDaily5Post, setDaily5XFetcherForTests } from "../services/daily5XWatch";

const sent: { to: string; subject: string }[] = [];
setOpsAlertSenderForTests(async (o) => { sent.push(o); return true; });
afterEach(() => { sent.length = 0; setOpsAlertSenderForTests(async (o) => { sent.push(o); return true; }); });

describe("opsAlert", () => {
  it("emails dtm@packpts.com once per key per hour", async () => {
    expect(OPS_ALERT_EMAIL).toBe("dtm@packpts.com");
    await opsAlert("k", "subject", "detail");
    await opsAlert("k", "subject", "detail");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("dtm@packpts.com");
  });
});

describe("Daily 5 X watchdog", () => {
  const at = (iso: string) => new Date(iso);
  it("skips before 9:15 AM CT", async () => {
    setDaily5XFetcherForTests(async () => []);
    expect(await checkDaily5Posted(at("2026-10-14T13:00:00Z"))).toBe("skipped"); // 8:00 AM CT
  });
  it("alerts when no Daily 5 post exists", async () => {
    setDaily5XFetcherForTests(async () => ["Ken Griffey memory post"]);
    expect(await checkDaily5Posted(at("2026-10-14T14:30:00Z"))).toBe("missing");
    expect(sent.some((s) => s.subject.includes("No Daily 5 post"))).toBe(true);
  });
  it("passes when today's post is there", async () => {
    setDaily5XFetcherForTests(async () => ["Can you name all 5?\n\nToday's Daily 5 is 1989 Topps."]);
    expect(await checkDaily5Posted(at("2026-10-15T14:30:00Z"))).toBe("ok");
  });
  it("alerts when X cannot be read", async () => {
    setDaily5XFetcherForTests(async () => { throw new Error("credentials_missing"); });
    expect(await checkDaily5Posted(at("2026-10-16T14:30:00Z"))).toBe("error");
  });
  it("helpers", () => {
    expect(ctNow(at("2026-10-14T14:30:00Z")).day).toBe("2026-10-14");
    expect(isDaily5Post("x utm_campaign=d5_20261014", "2026-10-14")).toBe(true);
  });
});

import { isThirdPartyPhotoHost } from "../services/cards/imageQuality";
describe("third-party photo hosts", () => {
  it("flags PSA, Beckett and eBay photo hosts only", () => {
    expect(isThirdPartyPhotoHost("https://i.ebayimg.com/images/g/x/s-l1600.jpg")).toBe(true);
    expect(isThirdPartyPhotoHost("https://www.psacard.com/x.jpg")).toBe(true);
    expect(isThirdPartyPhotoHost("https://img.beckett.com/x.jpg")).toBe(true);
    expect(isThirdPartyPhotoHost("https://cdn.cardhedger.com/x.jpg")).toBe(false);
    expect(isThirdPartyPhotoHost(null)).toBe(false);
  });
});
