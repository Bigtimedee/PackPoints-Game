import type { CSSProperties } from "react";
import { MaskedCardImage } from "@/components/MaskedCardImage";
import { isMaskedSetCoverUrl } from "@shared/setCoverUrl";
import {
  SET_INDEX_COVER_HEIGHT,
  SETS_POLISH,
  fanCoverPlacements,
  resolveSetCover,
  sanitizeCoverCardUrls,
  type SetCoverSource,
} from "@/lib/setsPolish";

function StackCard({
  src,
  className,
  style,
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      <div className="overflow-hidden rounded-[3px] shadow-md" style={{ aspectRatio: "2.5 / 3.5" }}>
        <MaskedCardImage
          src={src}
          alt=""
          className="h-full w-full"
          maskColor="#000000"
          plaqueChrome="bar"
        />
      </div>
    </div>
  );
}

export function MaskedCardStack({
  urls,
  compact = false,
}: {
  urls: string[];
  compact?: boolean;
}) {
  const cards = sanitizeCoverCardUrls(urls);
  if (cards.length === 0) return null;
  const placements = fanCoverPlacements(cards.length, compact);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: compact ? SET_INDEX_COVER_HEIGHT : 220 }}
      data-testid="cover-masked-stack"
      data-cover-count={cards.length}
    >
      {cards.map((src, i) => {
        const place = placements[i];
        return (
          <StackCard
            key={`${src}-${i}`}
            src={src}
            className="absolute"
            style={{
              width: `${place.widthPct}%`,
              left: `${place.leftPct}%`,
              top: (compact ? 16 : 24) + place.liftPx,
              transform: `translateX(-50%) rotate(${place.rotateDeg}deg)`,
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

  if (cover.urls.length === 0) return null;
  return <MaskedCardStack urls={cover.urls} compact />;
}

export function TheStack({
  cards,
}: {
  cards: Array<{ imageUrl: string | null; year: number | null }>;
}) {
  const urls = cards.filter((c) => isMaskedSetCoverUrl(c.imageUrl)).map((c) => c.imageUrl as string);
  if (urls.length === 0) return null;
  return (
    <div
      className="overflow-hidden"
      data-testid="section-the-stack"
    >
      <MaskedCardStack urls={urls} />
    </div>
  );
}
