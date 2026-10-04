import type { Express } from "express";
import { verifyEpnSecret } from "../services/epnVerification";

/** Register before the legacy route: this handler always terminates the request. */
export function registerVerifiedEpnPostback(app: Express): void {
  app.get("/api/webhooks/epn-postback", async (req, res) => {
    const secret = process.env.EPN_POSTBACK_SECRET;
    if (!secret || secret.length < 32) {
      res.status(503).json({ error: "EPN postback disabled" });
      return;
    }
    if (!verifyEpnSecret(secret, req.headers["x-epn-postback-secret"])) {
      res.status(401).json({ error: "Unauthorized postback" });
      return;
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
  });
}
