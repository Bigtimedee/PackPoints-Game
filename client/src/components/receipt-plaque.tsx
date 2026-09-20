import { RECEIPT_COLORS, type ReceiptPlaqueView } from "@shared/receiptContract";

function MetaCell({ label, value, mono, testId }: { label: string; value: string; mono?: boolean; testId?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: RECEIPT_COLORS.muted }}>
        {label}
      </p>
      <p
        className={`mt-1 text-sm ${mono ? "font-mono" : "font-semibold"}`}
        style={{ color: RECEIPT_COLORS.ink }}
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  );
}

export function ReceiptStatusChip({
  label,
  color,
  testId,
}: {
  label: string;
  color: string;
  testId?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em]"
      style={{ color, borderColor: color }}
      data-testid={testId ?? `badge-status-${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}

export function ReceiptPlaque({
  plaque,
  compact = false,
}: {
  plaque: ReceiptPlaqueView;
  compact?: boolean;
}) {
  const heroColor = plaque.status === "CREDIT_GRANTED" ? RECEIPT_COLORS.green : RECEIPT_COLORS.ink;
  const helperColor = plaque.chip.label === "PURCHASE_CONFIRMED" ? RECEIPT_COLORS.gold : RECEIPT_COLORS.muted;

  return (
    <article
      className="overflow-hidden rounded-[28px]"
      style={{ background: RECEIPT_COLORS.surface, color: RECEIPT_COLORS.ink }}
      data-testid={compact ? `card-redemption-${plaque.intentId}` : "receipt-plaque"}
    >
      <div className="px-5 pt-4 text-right text-xs sm:px-7" style={{ color: RECEIPT_COLORS.muted }} data-testid="text-wallet-header">
        {plaque.walletHeader}
      </div>
      <div className="px-5 pb-6 sm:px-7">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-[0.22em]" style={{ color: RECEIPT_COLORS.muted }}>
            PACKPTS RECEIPT
          </p>
          <ReceiptStatusChip label={plaque.chip.label} color={plaque.chip.color} />
        </div>
        <div className="mt-3 h-px" style={{ background: RECEIPT_COLORS.gold }} />

        <p
          className={`mt-5 font-mono font-bold leading-none ${compact ? "text-3xl" : "text-5xl sm:text-6xl"}`}
          style={{ color: heroColor }}
          data-testid="text-receipt-usd"
        >
          {plaque.heroAmount}
        </p>
        {plaque.status === "CREDIT_GRANTED" ? (
          <>
            {plaque.helper && (
              <p className="mt-3 text-sm" style={{ color: helperColor }} data-testid="text-receipt-helper">
                {plaque.helper}
              </p>
            )}
            <p className="mt-1 text-sm" style={{ color: RECEIPT_COLORS.muted }} data-testid="text-receipt-subline">
              {plaque.subline}
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm" style={{ color: RECEIPT_COLORS.muted }} data-testid="text-receipt-subline">
              {plaque.subline}
            </p>
            {plaque.helper && (
              <p className="mt-1 text-sm" style={{ color: helperColor }} data-testid="text-receipt-helper">
                {plaque.helper}
              </p>
            )}
          </>
        )}

        <div className="mt-5 space-y-3 border-t pt-4" style={{ borderColor: "#2A3140" }}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm" style={{ color: RECEIPT_COLORS.muted }}>Partner</span>
            <span className="font-semibold" data-testid="text-receipt-partner">{plaque.partner}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm" style={{ color: RECEIPT_COLORS.muted }}>Partner price</span>
            <span className="font-semibold" data-testid="text-receipt-partner-price">{plaque.partnerPrice}</span>
          </div>
        </div>

        <div className="mt-4 border-t pt-4" style={{ borderColor: "#2A3140" }}>
          <p className="text-sm" style={{ color: RECEIPT_COLORS.muted }}>Listing</p>
          <p className="mt-1 line-clamp-2 font-semibold leading-snug" data-testid="text-receipt-listing">
            {plaque.listingTitle}
          </p>
        </div>

        {!compact && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4" style={{ borderColor: "#2A3140" }}>
              <MetaCell label="PackPTS spent" value={plaque.packptsSpentLabel} testId="text-receipt-packpts" />
              <MetaCell label="Intent" value={plaque.intentId.replace(/-/g, "").slice(0, 8)} mono testId="text-receipt-intent" />
              <MetaCell label="Created" value={plaque.createdAtLabel} />
              <MetaCell label="Granted" value={plaque.grantedAtLabel} />
              <MetaCell label="Grant" value={plaque.grantMethodLabel} testId="text-receipt-grant-method" />
              <MetaCell label="Evidence" value={plaque.evidenceLabel} />
            </div>

            <div className="mt-8 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <img src="/packpts-mark.svg" alt="" className="h-7 w-7 rounded-sm" data-testid="img-receipt-mark" />
                <span className="text-sm font-semibold">PackPTS</span>
              </div>
              <p className="truncate text-right text-[11px]" style={{ color: RECEIPT_COLORS.muted }}>
                packpts.com/redemptions/{plaque.intentId.replace(/-/g, "").slice(0, 8)}
              </p>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
