export function payoutReceiptText(payout: { amountCents: number; destination: string; stripePaymentId: string; stripeStatus: string; sandbox: boolean }) {
  return ["PackPTS cashback payout receipt", payout.sandbox ? "TEST ONLY. No real money moved." : "USD bank payout",
    `Amount: $${(payout.amountCents / 100).toFixed(2)}`, "Method: Stripe standard bank payout",
    `Destination: ${payout.destination}`, `Stripe reference: ${payout.stripePaymentId}`,
    `Stripe status: ${payout.stripeStatus}`, "Sent means funds left Stripe. Bank arrival is not guaranteed; returns may occur."].join("\n");
}
