import express from "express";
import { describe, it, expect } from "vitest";
import { registerVerifiedEpnPostback } from "../routes/epnPostback";
import { readFileSync } from "node:fs";

it("registers the authenticated route before the legacy route", () => {
  const boot = readFileSync("server/index.ts", "utf8");
  expect(boot.indexOf("registerVerifiedEpnPostback(app)")).toBeLessThan(boot.indexOf("await registerRoutes(httpServer, app)"));
});

describe("EPN HTTP authentication", () => {
  it("terminates missing/wrong-secret requests before database code or legacy handler", async () => {
    const prior = process.env.EPN_POSTBACK_SECRET;
    const app = express();
    registerVerifiedEpnPostback(app);
    app.get("/api/webhooks/epn-postback", (_req, res) => res.status(418).end());
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address() as {port:number};
    const url = `http://127.0.0.1:${address.port}/api/webhooks/epn-postback`;
    try {
      delete process.env.EPN_POSTBACK_SECRET;
      expect((await fetch(url)).status).toBe(503);
      process.env.EPN_POSTBACK_SECRET = "s".repeat(40);
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, {headers:{"x-epn-postback-secret":"wrong"}})).status).toBe(401);
      expect((await fetch(url, {headers:{"x-epn-postback-secret":"s".repeat(40)}})).status).toBe(400);
      expect((await fetch(url + "?customid[]=bad&transaction_id=t&item_id=1&sale_price=70", {headers:{"x-epn-postback-secret":"s".repeat(40)}})).status).toBe(400);
    } finally {
      if (prior === undefined) delete process.env.EPN_POSTBACK_SECRET;
      else process.env.EPN_POSTBACK_SECRET = prior;
      await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
