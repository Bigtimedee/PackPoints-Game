import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CATALOG_MATCH_COPY,
  MAKE_BLUE,
  MAKE_CREAM,
  MAKE_EMPTY_COPY,
  MAKE_GOLD,
  MAKE_GREEN,
  MAKE_INK,
  MAKE_MUTED,
  MAKE_PANEL,
} from "@/lib/makeIdentifyUi";
import { catalogMatchPlayPath, type CatalogMatchSet, type MatchStatus } from "@shared/catalogMatch";
import { Check } from "lucide-react";

function usePreviewUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

function EmptyPlaque() {
  return (
    <div
      className="relative h-36 w-[6.4rem] rounded-xl"
      style={{ border: "1px solid rgba(143, 150, 163, 0.35)" }}
      aria-hidden
    >
      <div
        className="absolute inset-3 rounded-lg"
        style={{ border: "1px solid rgba(143, 150, 163, 0.28)" }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-0.5 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "rgba(143, 150, 163, 0.45)" }}
      />
    </div>
  );
}

interface MakeMatchResultProps {
  status: MatchStatus;
  file: File | null;
  label: string | null;
  sets: CatalogMatchSet[];
  pickedSetId: string | null;
  onPick: (setId: string) => void;
  onPlay: (path: "/sets" | `/sets/${string}`) => void;
  onSnapAnother: () => void;
  onBrowse: () => void;
  onTryAnother: () => void;
  onDaily5: () => void;
}

export function MakeMatchResult({
  status,
  file,
  label,
  sets,
  pickedSetId,
  onPick,
  onPlay,
  onSnapAnother,
  onBrowse,
  onTryAnother,
  onDaily5,
}: MakeMatchResultProps) {
  const previewUrl = usePreviewUrl(status === "none" ? null : file);
  const picked = sets.find((set) => set.id === pickedSetId) ?? (status === "matched" ? sets[0] : undefined);
  const playPath = picked ? catalogMatchPlayPath(picked.slug) : null;

  if (status === "none") {
    return (
      <section data-testid="make-match-none" className="space-y-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em]" style={{ color: MAKE_MUTED }}>
            {MAKE_EMPTY_COPY.eyebrow}
          </p>
          <h1 className="mt-3 text-[1.85rem] font-bold leading-tight" style={{ color: MAKE_INK }}>
            {CATALOG_MATCH_COPY.noneHeadline}
          </h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: MAKE_MUTED }}>
            {CATALOG_MATCH_COPY.noneSub}
          </p>
        </div>
        <div className="flex justify-center py-6">
          <EmptyPlaque />
        </div>
        <div className="flex flex-col items-center gap-4">
          <Button
            onClick={onBrowse}
            className="h-12 w-full text-base font-semibold text-white border-0"
            style={{ background: MAKE_BLUE }}
            data-testid="button-browse-sets"
          >
            {CATALOG_MATCH_COPY.browse}
          </Button>
          <button
            type="button"
            className="text-sm"
            style={{ color: MAKE_MUTED }}
            onClick={onTryAnother}
            data-testid="button-try-another-photo"
          >
            {CATALOG_MATCH_COPY.tryAnother}
          </button>
          <button
            type="button"
            className="text-center text-sm leading-relaxed"
            style={{ color: MAKE_MUTED }}
            onClick={onDaily5}
            data-testid="button-daily-5-soft"
          >
            {CATALOG_MATCH_COPY.daily5}
          </button>
        </div>
      </section>
    );
  }

  const headline =
    status === "ambiguous" ? CATALOG_MATCH_COPY.ambiguousHeadline : CATALOG_MATCH_COPY.foundHeadline;

  return (
    <section
      data-testid={status === "ambiguous" ? "make-match-ambiguous" : "make-match-found"}
      className="space-y-6"
    >
      <div>
        <p className="text-[11px] font-semibold tracking-[0.22em]" style={{ color: MAKE_MUTED }}>
          {MAKE_EMPTY_COPY.eyebrow}
        </p>
        <h1 className="mt-3 text-[1.85rem] font-bold leading-tight" style={{ color: MAKE_INK }}>
          {headline}
        </h1>
        {status === "ambiguous" && (
          <p className="mt-3 text-sm leading-relaxed" style={{ color: MAKE_MUTED }}>
            {CATALOG_MATCH_COPY.ambiguousSub}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div
          className="relative h-28 w-[5.1rem] shrink-0 overflow-hidden rounded-xl"
          style={{ background: MAKE_CREAM, border: `1.5px solid ${MAKE_GOLD}` }}
        >
          {previewUrl && (
            <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span
            className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: MAKE_GREEN }}
            aria-hidden
          >
            <Check className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight" style={{ color: MAKE_INK }}>
            {label || "Card"}
          </p>
          <p className="mt-1 text-sm" style={{ color: MAKE_MUTED }}>
            {CATALOG_MATCH_COPY.catalogLine}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {sets.map((set) => {
          const selected = status === "matched" || set.id === pickedSetId;
          return (
            <button
              key={set.id}
              type="button"
              className="w-full rounded-2xl px-4 py-4 text-left"
              style={{
                background: MAKE_PANEL,
                border: selected ? `1px solid ${MAKE_BLUE}` : "1px solid rgba(143, 150, 163, 0.22)",
              }}
              onClick={() => onPick(set.id)}
              data-testid="make-set-chip"
              data-set-slug={set.slug}
            >
              <p className="text-lg font-semibold" style={{ color: MAKE_INK }}>
                {set.name}
              </p>
              <p className="mt-1 text-sm" style={{ color: MAKE_MUTED }}>
                {set.tease}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-4">
        <Button
          disabled={!playPath || playPath === "/sets"}
          onClick={() => playPath && onPlay(playPath)}
          className="h-12 w-full text-base font-semibold text-white border-0"
          style={{ background: playPath && playPath !== "/sets" ? MAKE_BLUE : undefined }}
          data-testid="button-play-this-set"
          data-play-path={playPath ?? ""}
        >
          {CATALOG_MATCH_COPY.play}
        </Button>
        {status === "ambiguous" && (
          <button
            type="button"
            className="text-sm"
            style={{ color: MAKE_MUTED }}
            onClick={onBrowse}
            data-testid="button-browse-sets"
          >
            {CATALOG_MATCH_COPY.browse}
          </button>
        )}
        <button
          type="button"
          className="text-sm"
          style={{ color: MAKE_MUTED }}
          onClick={status === "ambiguous" ? onTryAnother : onSnapAnother}
          data-testid={status === "ambiguous" ? "button-try-another-photo" : "button-snap-another"}
        >
          {status === "ambiguous" ? CATALOG_MATCH_COPY.tryAnother : CATALOG_MATCH_COPY.snapAnother}
        </button>
      </div>

      {status === "matched" && (
        <p className="pt-6 text-center text-sm" style={{ color: MAKE_MUTED }} data-testid="make-match-honesty">
          {CATALOG_MATCH_COPY.honesty}
        </p>
      )}
    </section>
  );
}
