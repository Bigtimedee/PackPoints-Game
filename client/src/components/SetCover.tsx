import type { CSSProperties } from "react";
import { MaskedCardImage } from "@/components/MaskedCardImage";
import {
  SETS_POLISH,
  resolveSetCover,
  type SetCoverSource,
} from "@/lib/setsPolish";

function CreamSilhouette({ year }: { year?: number | null }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-[3px]"
      style={{
        aspectRatio: "2.5 / 3.5",
        background: `linear-gradient(180deg, ${SETS_POLISH.cream} 0%, #E2D3B3 100%)`,
        border: `1px solid ${SETS_POLISH.gold}55`,
      }}
      aria-hidden
    >
      <div
        className="absolute left-[8%] right-[8%] rounded-sm"
        style={{
          top: "54%",
          height: "46%",
          backgroundColor: "#000000",
        }}
      />
      <div className="absolute inset-x-0 top-[18%] text-center">
        <span
          className="font-mono text-[10px] tracking-[0.18em]"
          style={{ color: "#3a3428" }}
        >
          {year ? `PTS ${year}` : "PTS"}
        </span>
      </div>
    </div>
  );
}

function StackCard({
  src,
  year,
  className,
  style,
}: {
  src?: string | null;
  year?: number | null;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      {src ? (
        <div className="overflow-hidden rounded-[3px] shadow-md" style={{ aspectRatio: "2.5 / 3.5" }}>
          <MaskedCardImage
            src={src}
            alt=""
            className="h-full w-full"
            maskColor="#000000"
          />
        </div>
      ) : (
        <CreamSilhouette year={year} />
      )}
    </div>
  );
}

export function MaskedCardStack({
  urls,
  years,
  compact = false,
}: {
  urls: string[];
  years?: Array<number | null>;
  compact?: boolean;
}) {
  const count = Math.min(5, Math.max(3, urls.length));
  const cards = Array.from({ length: count }, (_, i) => ({
    src: urls[i] ?? null,
    year: years?.[i] ?? null,
  }));

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: compact ? 168 : 220, backgroundColor: SETS_POLISH.panel }}
      data-testid="cover-masked-stack"
    >
      {cards.map((card, i) => {
        const mid = (cards.length - 1) / 2;
        const dx = (i - mid) * 18;
        const rot = (i - mid) * 6;
        const lift = Math.abs(i - mid) * 8;
        return (
          <StackCard
            key={i}
            src={card.src}
            year={card.year}
            className="absolute"
            style={{
              width: compact ? "30%" : "28%",
              left: `${36 + dx}%`,
              top: compact ? 18 + lift : 28 + lift,
              transform: `translateX(-50%) rotate(${rot}deg)`,
              zIndex: i + 1,
            }}
          />
        );
      })}
    </div>
  );
}

export function SetCover({
  shareImageUrl,
  cardUrls,
  caption,
}: {
  shareImageUrl?: string | null;
  cardUrls?: string[];
  caption?: boolean;
}) {
  const cover: SetCoverSource = resolveSetCover(shareImageUrl, cardUrls ?? []);

  if (cover.kind === "surfaceA") {
    return (
      <div className="space-y-2">
        <div
          className="relative w-full overflow-hidden rounded-md"
          style={{ aspectRatio: "16 / 7", backgroundColor: SETS_POLISH.panel }}
          data-testid="cover-surface-a"
        >
          <img
            src={cover.src}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: "center 38%" }}
          />
        </div>
        {caption && (
          <p className="text-[11px] tracking-wide" style={{ color: SETS_POLISH.muted }}>
            {SETS_POLISH.surfaceACaption}
          </p>
        )}
      </div>
    );
  }

  return <MaskedCardStack urls={cover.urls} compact />;
}

export function TheStack({
  cards,
}: {
  cards: Array<{ imageUrl: string | null; year: number | null }>;
}) {
  const withArt = cards.filter((c) => c.imageUrl);
  const urls = withArt.map((c) => c.imageUrl as string);
  const years = withArt.map((c) => c.year);
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ backgroundColor: SETS_POLISH.panel }}
      data-testid="section-the-stack"
    >
      <MaskedCardStack urls={urls} years={years} />
    </div>
  );
}
