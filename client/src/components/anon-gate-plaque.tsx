import { ANON_GATE_COPY } from "@shared/anonGate";

/** B masked-P. Gold bar is the mask, not a second mark. */
function MaskedPMark() {
  return (
    <svg width={36} height={36} viewBox="0 0 1024 1024" role="img" aria-label="PackPTS" className="rounded-md">
      <rect width="1024" height="1024" fill="#0b0f16" />
      <path fill="#ffffff" fillRule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z" />
      <rect x="292" y="448" width="528" height="96" fill="#F5C518" />
    </svg>
  );
}

export function EscrowHeldChip({ points }: { points: number }) {
  const held = Math.floor(points);
  if (!Number.isFinite(held) || held <= 0) return null;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1"
      style={{ borderColor: "#2A3240", backgroundColor: "#0b0f16" }}
      data-testid="chip-packpts-held"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#F5C518" }} aria-hidden />
      <span className="text-sm" style={{ color: "#8F96A3" }}>{ANON_GATE_COPY.escrowLabel}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: "#F5C518" }}>{held}</span>
    </div>
  );
}

export function AnonGatePlaque({
  variant,
  escrowPoints,
  onCreate,
  onContinue,
  onSignIn,
}: {
  variant: "soft" | "hard";
  escrowPoints: number;
  onCreate: () => void;
  onContinue?: () => void;
  onSignIn?: () => void;
}) {
  const hard = variant === "hard";
  return (
    <div
      className="w-full max-w-[390px] rounded-2xl border px-6 py-7 text-left"
      style={{ backgroundColor: "#161B24", borderColor: "#2A3240", color: "#F0F2F5" }}
      data-testid={hard ? "plaque-anon-hard-gate" : "plaque-anon-soft-gate"}
    >
      <MaskedPMark />
      <h2 className="mt-5 text-[1.75rem] font-semibold leading-tight tracking-tight" style={{ color: "#F0F2F5" }}>
        {hard ? ANON_GATE_COPY.hardTitle : ANON_GATE_COPY.softTitle}
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "#8F96A3" }}>
        {hard ? ANON_GATE_COPY.hardBody : ANON_GATE_COPY.softBody}
      </p>
      <div className="mt-4">
        <EscrowHeldChip points={escrowPoints} />
      </div>
      <button
        type="button"
        className="mt-5 w-full min-h-11 px-4 text-base font-semibold"
        style={{ backgroundColor: "#2B6CEE", color: "#F0F2F5", borderRadius: 10 }}
        onClick={onCreate}
        data-testid="button-gate-create-account"
      >
        {hard ? ANON_GATE_COPY.hardCta : ANON_GATE_COPY.softCta}
      </button>
      {hard ? (
        <button
          type="button"
          className="mt-3 w-full min-h-11 border bg-transparent px-4 text-base font-semibold"
          style={{ borderColor: "#2A3240", color: "#F0F2F5", borderRadius: 10 }}
          onClick={onSignIn}
          data-testid="button-gate-sign-in"
        >
          {ANON_GATE_COPY.signInCta}
        </button>
      ) : (
        <button
          type="button"
          className="mt-4 w-full min-h-11 bg-transparent text-base"
          style={{ color: "#8F96A3" }}
          onClick={onContinue}
          data-testid="button-gate-continue-once"
        >
          {ANON_GATE_COPY.softSecondary}
        </button>
      )}
    </div>
  );
}
