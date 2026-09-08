import { Button } from "@/components/ui/button";
import {
  MAKE_CANVAS,
  MAKE_CREAM,
  MAKE_CREAM_ALT,
  MAKE_EMPTY_COPY,
  MAKE_GOLD,
  MAKE_INK,
  MAKE_MUTED,
} from "@/lib/makeIdentifyUi";

const SAMPLE_CARDS = [
  { rotate: -14, x: -52, cream: MAKE_CREAM },
  { rotate: -5, x: -18, cream: MAKE_CREAM_ALT },
  { rotate: 5, x: 18, cream: MAKE_CREAM },
  { rotate: 14, x: 52, cream: MAKE_CREAM_ALT },
] as const;

function ExamplePcStack() {
  return (
    <div className="relative mx-auto h-44 w-72" aria-hidden="true" data-testid="make-example-stack">
      {SAMPLE_CARDS.map((card, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-3 h-[9.5rem] w-[4.4rem] rounded-md shadow-md"
          style={{
            background: card.cream,
            transform: `translateX(calc(-50% + ${card.x}px)) rotate(${card.rotate}deg)`,
            zIndex: i + 1,
          }}
        >
          <div className="absolute inset-x-1.5 bottom-[20%] h-[30%] rounded-sm bg-[#0b0f16]" />
          <div
            className="absolute inset-x-2.5 bottom-[34%] h-1 rounded-full"
            style={{ background: MAKE_GOLD }}
          />
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
    <section
      data-testid="make-empty-state"
      className="rounded-2xl px-5 py-8 sm:px-8"
      style={{ background: MAKE_CANVAS }}
    >
      <p
        className="text-xs font-semibold tracking-[0.2em]"
        style={{ color: MAKE_GOLD }}
        data-testid="make-empty-eyebrow"
      >
        {MAKE_EMPTY_COPY.eyebrow}
      </p>
      <h1
        className="mt-3 text-3xl font-bold leading-tight"
        style={{ color: MAKE_INK }}
        data-testid="make-empty-headline"
      >
        {MAKE_EMPTY_COPY.headline}
      </h1>
      <p className="mt-2 text-sm" style={{ color: MAKE_MUTED }} data-testid="make-empty-subline">
        {MAKE_EMPTY_COPY.subline}
      </p>

      <div className="relative mt-8 mb-2">
        <span
          className="absolute -top-1 right-0 z-20 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide"
          style={{ color: MAKE_GOLD, borderColor: "rgba(245, 197, 24, 0.4)", background: MAKE_CANVAS }}
          data-testid="make-example-badge"
        >
          {MAKE_EMPTY_COPY.exampleBadge}
        </span>
        <ExamplePcStack />
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

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button
          onClick={onTakePhoto}
          disabled={photoDisabled}
          data-testid="make-cta-photo"
        >
          {MAKE_EMPTY_COPY.primaryCta}
        </Button>
        <Button
          variant="outline"
          onClick={onChooseLibrary}
          disabled={libraryDisabled}
          className="bg-transparent"
          style={{ color: MAKE_INK, borderColor: "rgba(143, 150, 163, 0.45)" }}
          data-testid="make-cta-library"
        >
          {MAKE_EMPTY_COPY.secondaryCta}
        </Button>
      </div>
    </section>
  );
}
