/**
 * Ops alerts (GTM audit W9/R10): log at error level and email the ops inbox
 * through the existing Resend path. One email per key per hour so a crash loop
 * cannot flood the inbox. Never throws.
 */
export const OPS_ALERT_EMAIL = process.env.OPS_ALERT_EMAIL || "dtm@packpts.com";
const lastSent = new Map<string, number>();
const MIN_GAP_MS = 60 * 60 * 1000;

type Sender = (o: { to: string; subject: string; html: string; text: string }) => Promise<boolean>;
let sender: Sender | null = null;
export function setOpsAlertSenderForTests(s: Sender | null): void { sender = s; lastSent.clear(); }

export async function opsAlert(key: string, subject: string, detail: string): Promise<boolean> {
  console.error(`[OpsAlert] ${key}: ${subject} :: ${detail}`);
  try {
    const now = Date.now();
    if ((lastSent.get(key) ?? 0) > now - MIN_GAP_MS) return false;
    lastSent.set(key, now);
    const send: Sender = sender ?? (await import("./emailService")).sendEmail;
    const safe = detail.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
    return await send({ to: OPS_ALERT_EMAIL, subject: `[PackPTS ops] ${subject}`, text: detail, html: `<pre>${safe}</pre>` });
  } catch (err: any) {
    console.error("[OpsAlert] email failed", err?.message);
    return false;
  }
}
