import { Button } from "@/components/ui/button";
import {
  MAKE_BLUE,
  MAKE_CANVAS,
  MAKE_CREAM,
  MAKE_CREAM_ALT,
  MAKE_EMPTY_COPY,
  MAKE_GOLD,
  MAKE_INK,
  MAKE_MUTED,
  MAKE_NAVY,
} from "@/lib/makeIdentifyUi";

function GoldStroke({ radius = 6 }: { radius?: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-[3px]"
      style={{ border: `1.5px solid ${MAKE_GOLD}`, borderRadius: radius }}
    />
  );
}

function SilhouetteCard({ navy }: { navy?: boolean }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-md shadow-[0_12px_24px_rgba(0,0,0,0.45)]"
      style={{ background: navy ? MAKE_NAVY : MAKE_CREAM_ALT }}
    >
      <GoldStroke />
      <div
        className="absolute inset-x-2 bottom-[22%] h-[28%] rounded-sm"
        style={{ background: navy ? "#0b0f16" : "#2a2418" }}
      />
    </div>
  );
}

function DeskSampleCard() {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-md shadow-[0_16px_32px_rgba(0,0,0,0.5)]"
      style={{ background: MAKE_CREAM }}
    >
      <GoldStroke radius={7} />
      <p
        className="absolute top-2 inset-x-0 text-center text-[9px] font-bold tracking-[0.28em]"
        style={{ color: "#3A3428" }}
      >
        DESK
      </p>
      <div className="absolute left-1/2 top-[42%] w-10 -translate-x-1/2 -translate-y-1/2">
        <div className="mx-auto h-[18px] w-[18px] rounded-full" style={{ background: "#8F96A3" }} />
        <div
          className="mx-auto -mt-0.5 h-7 w-9 rounded-t-[18px]"
          style={{ background: "#8F96A3" }}
        />
        <div className="absolute left-[-2px] right-[-2px] top-[16px] h-[8px] rounded-sm bg-[#0b0f16]" />
      </div>
      <div
        className="absolute bottom-2 left-1/2 w-[72%] -translate-x-1/2 rounded-sm px-1 py-1 text-center"
        style={{ background: "rgba(11,15,22,0.92)", border: `1px solid ${MAKE_GOLD}` }}
      >
        <div className="text-[9px] font-bold leading-none" style={{ color: MAKE_GOLD }}>
          PTS
        </div>
        <div className="mt-0.5 text-[8px] leading-none" style={{ color: MAKE_MUTED }}>
          1990
        </div>
      </div>
    </div>
  );
}

const FAN = [
  { rotate: -22, x: -72, z: 1, kind: "cream" as const },
  { rotate: -12, x: -40, z: 2, kind: "cream" as const },
  { rotate: -2, x: -8, z: 3, kind: "navy" as const },
  { rotate: 8, x: 28, z: 4, kind: "cream" as const },
  { rotate: 14, x: 62, z: 5, kind: "desk" as const },
];

function ExamplePcStack() {
  return (
    <div className="relative mx-auto h-52 w-80" aria-hidden="true" data-testid="make-example-stack">
      <div
        className="pointer-events-none absolute inset-x-8 top-6 h-36 rounded-full blur-2xl"
        style={{ background: "radial-gradient(ellipse, rgba(43,108,238,0.18), transparent 70%)" }}
      />
      {FAN.map((card, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-4 h-[11.25rem] w-[5.15rem]"
          style={{
            transform: `translateX(calc(-50% + ${card.x}px)) rotate(${card.rotate}deg)`,
            zIndex: card.z,
          }}
        >
          {card.kind === "desk" ? <DeskSampleCard /> : <SilhouetteCard navy={card.kind === "navy"} />}
        </div>
      ))}
    </div>
  );
}

interface MakeEmptyStateProps {
  onTakePhoto: () => void;
  onChooseLibrary: () => void;
  photoDisabled?: boolean;
  libraryDisabled?: boolean;
  showSoftAuth?: boolean;
  onSignIn?: () => void;
}

export function MakeEmptyState({
  onTakePhoto,
  onChooseLibrary,
  photoDisabled,
  libraryDisabled,
  showSoftAuth,
  onSignIn,
}: MakeEmptyStateProps) {
  return (
    <section data-testid="make-empty-state" className="px-1 pt-2 pb-4">
      <p
        className="text-[11px] font-semibold tracking-[0.22em]"
        style={{ color: MAKE_MUTED }}
        data-testid="make-empty-eyebrow"
      >
        {MAKE_EMPTY_COPY.eyebrow}
      </p>
      <h1
        className="mt-3 text-[1.85rem] font-bold leading-[1.15] sm:text-4xl"
        style={{ color: MAKE_INK }}
        data-testid="make-empty-headline"
      >
        {MAKE_EMPTY_COPY.headline}
      </h1>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: MAKE_MUTED }} data-testid="make-empty-subline">
        {MAKE_EMPTY_COPY.subline}
      </p>

      <div className="relative mt-8 mb-2">
        <div className="flex justify-center">
          <span
            className="relative z-20 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide"
            style={{ color: MAKE_GOLD, borderColor: "rgba(245, 197, 24, 0.4)", background: MAKE_CANVAS }}
            data-testid="make-example-badge"
          >
            {MAKE_EMPTY_COPY.exampleBadge}
          </span>
        </div>
        <div className="-mt-1">
          <ExamplePcStack />
        </div>
      </div>

      {showSoftAuth && (
        <p className="mb-4 text-center text-sm" style={{ color: MAKE_MUTED }} data-testid="make-soft-auth">
          {MAKE_EMPTY_COPY.softAuth}{" "}
          {onSignIn && (
            <button
              type="button"
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: MAKE_INK }}
              onClick={onSignIn}
            >
              Sign in
            </button>
          )}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button
          onClick={onTakePhoto}
          disabled={photoDisabled}
          className="h-12 w-full text-base font-semibold text-white border-0"
          style={{ background: MAKE_BLUE }}
          data-testid="button-make-take-photo"
        >
          {MAKE_EMPTY_COPY.primaryCta}
        </Button>
        <Button
          variant="outline"
          onClick={onChooseLibrary}
          disabled={libraryDisabled}
          className="h-12 w-full text-base font-medium"
          style={{ color: MAKE_INK, background: "#12171F", borderColor: "rgba(143, 150, 163, 0.4)" }}
          data-testid="button-make-choose-library"
        >
          {MAKE_EMPTY_COPY.secondaryCta}
        </Button>
      </div>
    </section>
  );
}
