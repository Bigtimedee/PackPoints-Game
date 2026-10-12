import express, { type Express } from "express";
import { classifyEpnStatus, verifyEpnSecret } from "../services/epnVerification";

/** Register before the legacy route: this handler always terminates the request. */
export function registerVerifiedEpnPostback(app: Express): void {
  const handler = async (req: any, res: any) => {
    // EPN may POST (form or JSON); fields can come in the body or the query.
    if (req.method === "POST" && req.body && typeof req.body === "object") {
      req.query = { ...req.body, ...req.query };
    }
    const secret = process.env.EPN_POSTBACK_SECRET;
    if (!secret || secret.length < 32) {
      res.status(503).json({ error: "EPN postback disabled" });
      return;
    }
    // EPN postback templates are URL-based, so accept the secret as ?secret= as
    // well as the x-epn-postback-secret header. Both are timing-safe compares.
    if (!verifyEpnSecret(secret, req.headers["x-epn-postback-secret"]) &&
        !verifyEpnSecret(secret, req.query.secret)) {
      res.status(401).json({ error: "Unauthorized postback" });
      return;
    }
    // Status-only postback (return, cancel, reversal, lock) for a recorded sale.
    const statusRaw = typeof req.query.status === "string" ? req.query.status
      : typeof req.query.event_type === "string" ? req.query.event_type : undefined;
    if (typeof req.query.transaction_id === "string" && req.query.transaction_id && classifyEpnStatus(statusRaw)) {
      const { processEpnStatus } = await import("../services/rebateService");
      {
        try {
          const r = await processEpnStatus({ transaction_id: req.query.transaction_id, status: statusRaw! });
          res.json({ ok: true, action: r.action });
        } catch {
          res.status(400).json({ error: "Postback evidence rejected" });
        }
        return;
      }
    }
    const fields = ["customid", "transaction_id", "item_id", "sale_price"];
    if (fields.some(key => typeof req.query[key] !== "string" || !req.query[key])) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const optional = ["commission", "transaction_date"];
    if (optional.some(key => req.query[key] !== undefined && typeof req.query[key] !== "string")) {
      res.status(400).json({ error: "Invalid fields" });
      return;
    }
    try {
      const { processEpnPostback } = await import("../services/rebateService");
      const result = await processEpnPostback({
        customid: req.query.customid as string,
        transaction_id: req.query.transaction_id as string,
        item_id: req.query.item_id as string,
        sale_price: req.query.sale_price as string,
        commission: req.query.commission as string | undefined,
        transaction_date: req.query.transaction_date as string | undefined,
      });
      res.json({ ok: true, grants: result.grants.length });
    } catch {
      res.status(400).json({ error: "Postback evidence rejected" });
    }
  };
  app.get("/api/webhooks/epn-postback", handler);
  app.post("/api/webhooks/epn-postback", express.urlencoded({ extended: false, limit: "16kb" }), express.json({ limit: "16kb" }), handler);
}
