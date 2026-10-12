/**
 * EPN Transaction Detail Report (TDR) sync. eBay Partner Network does not push
 * per-sale postbacks to publishers; confirmed sales, commission (Earnings) and
 * status (pending, approved = locked, reversed) come from the reporting API:
 * GET https://api.partner.ebay.com/Mediapartners/<SID>/Reports/ebay_partner_transaction_detail.json
 * with HTTP basic auth (Account SID : Auth Token). Credentials live only in the
 * Railway env (EPN_ACCOUNT_SID, EPN_AUTH_TOKEN); the sync is off without them.
 */
import { processEpnPostback, processEpnStatus } from "./rebateService";

export interface TdrRow {
  CustomId?: string; ItemId?: string; Sales?: string | number; Earnings?: string | number;
  EventDate?: string; Status?: string; EbayCheckoutTransactionId?: string; EpnTransactionId?: string;
}

const money = (v: unknown): string | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : null;
};

/** Map one TDR row to what the postback handlers take. Exported for tests. */
export function tdrRowAction(r: TdrRow):
  | { kind: "sale"; query: { customid: string; transaction_id: string; item_id: string; sale_price: string; commission: string; transaction_date?: string }; status: "pending" | "locked" }
  | { kind: "reversal"; transaction_id: string }
  | null {
  const tx = String(r.EbayCheckoutTransactionId || r.EpnTransactionId || "").trim();
  if (!tx || !r.CustomId) return null;
  const status = String(r.Status || "").toLowerCase();
  const earnings = money(r.Earnings);
  if (status === "reversed" || (earnings !== null && Number(earnings) <= 0)) return { kind: "reversal", transaction_id: tx };
  const sales = money(r.Sales);
  if (!earnings || !sales || Number(sales) <= 0 || !r.ItemId) return null;
  return {
    kind: "sale",
    query: { customid: String(r.CustomId), transaction_id: tx, item_id: String(r.ItemId), sale_price: sales, commission: earnings, transaction_date: r.EventDate },
    status: status === "approved" ? "locked" : "pending",
  };
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

export async function syncEpnReport(days = 7): Promise<{ rows: number; sales: number; reversals: number; errors: number }> {
  const sid = process.env.EPN_ACCOUNT_SID, token = process.env.EPN_AUTH_TOKEN;
  if (!sid || !token) return { rows: 0, sales: 0, reversals: 0, errors: 0 };
  const end = new Date(), start = new Date(end.getTime() - days * 86_400_000);
  const url = `https://api.partner.ebay.com/Mediapartners/${encodeURIComponent(sid)}/Reports/ebay_partner_transaction_detail.json` +
    `?STATUS=ALL&DATE_TYPE=update_date&START_DATE=${ymd(start)}&END_DATE=${ymd(end)}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`EPN report HTTP ${res.status}`);
  const body: any = await res.json();
  const rows: TdrRow[] = Array.isArray(body) ? body : Array.isArray(body?.Records) ? body.Records : Array.isArray(body?.records) ? body.records : [];
  let sales = 0, reversals = 0, errors = 0;
  for (const r of rows) {
    const a = tdrRowAction(r);
    if (!a) continue;
    try {
      if (a.kind === "reversal") { await processEpnStatus({ transaction_id: a.transaction_id, status: "reversed" }); reversals++; }
      else {
        await processEpnPostback(a.query);
        if (a.status === "locked") await processEpnStatus({ transaction_id: a.query.transaction_id, status: "locked" });
        sales++;
      }
    } catch { errors++; }
  }
  return { rows: rows.length, sales, reversals, errors };
}

export function startEpnReportSync(): void {
  if (!process.env.EPN_ACCOUNT_SID || !process.env.EPN_AUTH_TOKEN) {
    console.log("[EPN report] sync off: EPN_ACCOUNT_SID / EPN_AUTH_TOKEN not set");
    return;
  }
  const run = () => syncEpnReport().then(r => console.log("[EPN report]", JSON.stringify(r))).catch(e => console.error("[EPN report] failed:", e?.message));
  setTimeout(run, 60_000).unref();
  setInterval(run, 60 * 60_000).unref();
}
