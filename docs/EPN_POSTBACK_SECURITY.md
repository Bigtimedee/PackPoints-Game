# EPN cashback release gate

This patch is intentionally fail-closed. Set EPN_POSTBACK_SECRET to a randomly generated secret of at least 32 characters in the server secret store. A trusted relay must independently verify the actual EPN conversion before forwarding it with the x-epn-postback-secret header. This is not a claim that eBay directly supports that header. Do not deploy automatic grants as enabled until a supported verification/relay arrangement has been established. Do not put the secret in a URL, customid, repository, logs or browser.

Without that arrangement, the route returns 503 and the manual evidence/review path remains available. A correct secret alone is not proof of a buyer's purchase unless the sender is the verified relay. Never give this secret to a client.

Evidence checks require one recorded eBay click with an authenticated user, exact canonical item id, one unambiguous intent by the same user, USD sale price equal to stored intent price, click after intent creation, and no transaction replay across intents. The redirect now uses the same unpredictable customid for its URL and persisted click.

Strict price equality is conservative: offers, quantity, shipping/tax representation, foreign currencies and changed prices will not auto-grant. Those need reviewed evidence or a separate policy change; do not loosen the comparison to silently grant more than the verified sale supports.

No historic balances, PackPTS, reservations or payouts are changed by this PR. The existing reverse endpoint rejects CREDIT_GRANTED intents. A historic reversal needs a separate atomic, idempotent correction of rebate wallet/ledger, spent PackPTS and consumed treasury accounting. Removing the guard alone is unsafe.
