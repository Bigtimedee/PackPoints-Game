import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { SetCover } from "@/components/SetCover";
import { usePlayMakerSet } from "@/hooks/use-play-maker-set";
import {
  SET_INDEX_COVER_HEIGHT,
  SETS_POLISH,
  displaySetYearLabel,
  formatIndexSetTitle,
  formatSetMetaLine,
  sanitizeCoverCardUrls,
} from "@/lib/setsPolish";

export interface BrowseSet {
  id: string;
  setName: string;
  brand?: string | null;
  makerNote: string | null;
  makerUsername: string | null;
  isUserCreated?: boolean;
  cardCount: number;
  year?: number | null;
  createdAt: string | null;
  shareImageUrl?: string | null;
  coverCardUrls?: string[];
}

function MaskedPMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden className="rounded-sm">
      <rect width="1024" height="1024" fill={SETS_POLISH.canvas} />
      <path fill="#ffffff" fillRule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z" />
      <rect x="292" y="448" width="528" height="96" fill={SETS_POLISH.gold} />
    </svg>
  );
}

function PlayButton({
  setId,
  cardCount,
  label = SETS_POLISH.playThisSet,
}: {
  setId: string;
  cardCount: number;
  label?: string;
}) {
  const play = usePlayMakerSet(setId, cardCount);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (play.canPlay) play.mutate();
        }}
        disabled={!play.canPlay || play.isPending}
        className="w-full min-h-11 rounded-md text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: SETS_POLISH.blue }}
        data-testid={`button-play-set-${setId}`}
      >
        {play.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : label}
      </button>
      {play.gatePrompt}
    </>
  );
}

function SetRow({ set, coversDisabled }: { set: BrowseSet; coversDisabled: boolean }) {
  const title = formatIndexSetTitle({ id: set.id, setName: set.setName, brand: set.brand });
  const yearLabel = displaySetYearLabel(set.id, set.year);
  const coverUrls = sanitizeCoverCardUrls(set.coverCardUrls);
  const showCovers = !coversDisabled && coverUrls.length > 0;
  return (
    <article
      className="space-y-3"
      data-testid={`card-set-${set.id}`}
    >
      <Link href={`/sets/${set.id}`} className="block space-y-3">
        {showCovers ? (
          <SetCover shareImageUrl={set.shareImageUrl} cardUrls={coverUrls} />
        ) : (
          <div
            className="w-full"
            style={{ height: SET_INDEX_COVER_HEIGHT }}
            data-testid="cover-slot-hidden"
            aria-hidden
          />
        )}
        <div className="space-y-1">
          <h2 className="text-lg font-semibold leading-tight" style={{ color: SETS_POLISH.ink }} data-testid="text-set-title">
            {title}
          </h2>
          {!showCovers ? (
            yearLabel ? (
              <p className="text-xs" style={{ color: SETS_POLISH.muted }} data-testid="text-set-year">
                {yearLabel}
              </p>
            ) : null
          ) : (
            <p className="text-xs" style={{ color: SETS_POLISH.muted }} data-testid="text-set-meta">
              {formatSetMetaLine({
                makerUsername: set.isUserCreated ? set.makerUsername : null,
                cardCount: set.cardCount,
                createdAt: set.isUserCreated ? set.createdAt : null,
                authored: set.isUserCreated === true,
              })}
            </p>
          )}
        </div>
      </Link>
      <PlayButton setId={set.id} cardCount={Number(set.cardCount)} />
    </article>
  );
}

function SetRowSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="w-full rounded-md" style={{ aspectRatio: "16 / 7", backgroundColor: SETS_POLISH.panel }} />
      <Skeleton className="h-5 w-2/3" style={{ backgroundColor: SETS_POLISH.panel }} />
      <Skeleton className="h-3 w-1/2" style={{ backgroundColor: SETS_POLISH.panel }} />
      <Skeleton className="h-11 w-full rounded-md" style={{ backgroundColor: SETS_POLISH.panel }} />
    </div>
  );
}

export function BrowseSetsShelf({
  sets,
  isLoading,
  coversDisabled = false,
}: {
  sets: BrowseSet[];
  isLoading: boolean;
  coversDisabled?: boolean;
}) {
  return (
    <div className="min-h-full pb-20 md:pb-10" style={{ backgroundColor: SETS_POLISH.canvas, color: SETS_POLISH.ink }}>
      <div className="container mx-auto max-w-lg px-4 py-8 space-y-8">
        <header className="space-y-2">
          <p
            className="text-[11px] font-medium tracking-[0.18em]"
            style={{ color: SETS_POLISH.muted }}
            data-testid="text-sets-eyebrow"
          >
            {SETS_POLISH.eyebrow}
          </p>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-sets-title">
            {SETS_POLISH.indexTitle}
          </h1>
          <p className="text-sm" style={{ color: SETS_POLISH.muted }} data-testid="text-sets-sub">
            {SETS_POLISH.indexSub}
          </p>
          {!isLoading && (
            <p className="text-xs" style={{ color: SETS_POLISH.muted }} data-testid="text-sets-count">
              {sets.length} set{sets.length === 1 ? "" : "s"}
            </p>
          )}
        </header>

        {isLoading ? (
          <div className="space-y-8">
            {[0, 1].map((i) => <SetRowSkeleton key={i} />)}
          </div>
        ) : sets.length === 0 ? (
          <div className="py-16 text-center space-y-2" data-testid="text-empty-shelf">
            <p className="font-medium" style={{ color: SETS_POLISH.muted }}>The shelf is empty.</p>
            <p className="text-sm" style={{ color: SETS_POLISH.muted }}>Play Daily 5 while PackPTS adds more sets.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {sets.map((set) => (
              <SetRow key={set.id} set={set} coversDisabled={coversDisabled} />
            ))}
          </div>
        )}

        <div className="space-y-3 pt-2">
          <Link href="/daily">
            <span
              className="flex w-full min-h-11 items-center justify-center rounded-md text-sm font-medium"
              style={{
                backgroundColor: SETS_POLISH.canvas,
                color: SETS_POLISH.ink,
                border: `1px solid ${SETS_POLISH.panelBorder}`,
              }}
              data-testid="button-play-daily-5"
            >
              Play Daily 5
            </span>
          </Link>
        </div>

        <footer className="flex items-center gap-2 pt-6">
          <MaskedPMark />
          <span className="text-sm font-medium tracking-wide">PackPTS</span>
        </footer>
      </div>
    </div>
  );
}

export default function BrowseSets() {
  const { data, isLoading } = useQuery<{ sets: BrowseSet[]; coversDisabled?: boolean }>({
    queryKey: ["/api/sets"],
    queryFn: async () => {
      const res = await fetch("/api/sets?limit=50");
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <BrowseSetsShelf
      sets={data?.sets ?? []}
      isLoading={isLoading}
      coversDisabled={data?.coversDisabled === true}
    />
  );
}
