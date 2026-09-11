import type { ReactNode } from "react";
import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { logMakeClientEvent } from "@/lib/makeFunnel";
import { SetCover, TheStack } from "@/components/SetCover";
import { usePlayMakerSet } from "@/hooks/use-play-maker-set";
import {
  SETS_POLISH,
  formatDetailMetaLine,
  publicSetDisplayUrl,
  setShareSlug,
  shouldShowPlayTodayCue,
} from "@/lib/setsPolish";
import { playSetsShareUrl } from "@shared/playSetsShare";

interface PreviewCard {
  imageUrl: string | null;
  year: number | null;
}

interface SetDetail {
  id: string;
  setName: string;
  makerNote: string | null;
  isUserCreated: boolean;
  createdByUserId: string | null;
  coCreatorUserId: string | null;
  makerUsername: string | null;
  coCreatorUsername: string | null;
  cardCount: number;
  createdAt?: string | null;
  shareImageUrl?: string;
  previewCards?: PreviewCard[];
  playedToday?: boolean;
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

function QuietButton({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 min-h-11 rounded-md text-sm font-medium disabled:opacity-50"
      style={{
        backgroundColor: SETS_POLISH.panel,
        color: SETS_POLISH.ink,
        border: `1px solid ${SETS_POLISH.panelBorder}`,
      }}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export default function SetPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: set, isLoading, error } = useQuery<SetDetail>({
    queryKey: [`/api/sets/${id}`],
    enabled: !!id,
    retry: false,
  });

  const play = usePlayMakerSet(set?.id ?? id, set?.cardCount);

  useEffect(() => {
    if (!set?.setName) return;
    const previous = document.title;
    document.title = `${set.setName} · PackPTS`;
    return () => {
      document.title = previous;
    };
  }, [set?.setName]);

  const isOwner = user && set?.createdByUserId === (user as { id?: string }).id;
  const isCoCreator = user && set?.coCreatorUserId === (user as { id?: string }).id;
  const canSaveCover = !!(isOwner || isCoCreator) && !!set?.shareImageUrl;
  const previewCards = set?.previewCards ?? [];
  const coverCardUrls = previewCards
    .map((c) => c.imageUrl)
    .filter((u): u is string => !!u);

  function setShareHref() {
    const slug = setShareSlug(set!.setName, set!.id);
    return playSetsShareUrl({
      slugOrId: slug,
      origin: typeof window !== "undefined" ? window.location.origin : undefined,
    });
  }

  async function copyLink() {
    const url = setShareHref();
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn’t copy link", variant: "destructive" });
    }
  }

  async function shareSet() {
    const url = setShareHref();
    logMakeClientEvent("share_opened", { surface: "set_page" });
    try {
      if (navigator.share) {
        await navigator.share({
          title: set!.setName,
          url,
          text: set!.makerNote ? `“${set!.makerNote}”` : "Play this set on PackPTS.",
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast({ title: "Couldn’t share", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-full p-4" style={{ backgroundColor: SETS_POLISH.canvas }}>
        <div className="max-w-lg mx-auto pt-8 space-y-4">
          <Skeleton className="h-8 w-2/3" style={{ backgroundColor: SETS_POLISH.panel }} />
          <Skeleton className="h-4 w-1/3" style={{ backgroundColor: SETS_POLISH.panel }} />
          <Skeleton className="h-24 w-full" style={{ backgroundColor: SETS_POLISH.panel }} />
          <Skeleton className="h-10 w-full" style={{ backgroundColor: SETS_POLISH.panel }} />
        </div>
      </div>
    );
  }

  if (error || !set) {
    return (
      <div
        className="min-h-full flex items-center justify-center p-4"
        style={{ backgroundColor: SETS_POLISH.canvas, color: SETS_POLISH.ink }}
      >
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Set not found</p>
          <button
            type="button"
            className="rounded-md px-4 py-2 text-sm"
            style={{ border: `1px solid ${SETS_POLISH.panelBorder}` }}
            onClick={() => setLocation("/")}
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  const cardCount = Number(set.cardCount);
  const displayUrl = publicSetDisplayUrl(set.setName, set.id);
  const showPlayCue = shouldShowPlayTodayCue(set.playedToday);

  return (
    <div className="min-h-full pb-20 md:pb-10" style={{ backgroundColor: SETS_POLISH.canvas, color: SETS_POLISH.ink }}>
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
        <header className="space-y-2">
          <p
            className="text-[11px] font-medium tracking-[0.18em]"
            style={{ color: SETS_POLISH.muted }}
          >
            SET
          </p>
          <h1 className="text-3xl font-bold leading-tight" data-testid="text-set-title">
            {set.setName}
          </h1>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm" style={{ color: SETS_POLISH.muted }} data-testid="text-set-meta">
              {formatDetailMetaLine({
                makerUsername: set.makerUsername,
                coCreatorUsername: set.coCreatorUsername,
                createdAt: set.createdAt,
              })}
            </p>
            {set.isUserCreated && (
              <span
                className="shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em]"
                style={{ color: SETS_POLISH.gold, border: `1px solid ${SETS_POLISH.gold}` }}
                data-testid="badge-fan-made"
              >
                {SETS_POLISH.fanMade}
              </span>
            )}
          </div>
        </header>

        {set.makerNote && (
          <div
            className="rounded-md px-4 py-3"
            style={{ backgroundColor: SETS_POLISH.panel }}
            data-testid="text-mixtape"
          >
            <p className="text-sm italic" style={{ color: SETS_POLISH.ink }}>
              “{set.makerNote}”
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-3">
            <button
              type="button"
              className="flex-1 min-h-11 rounded-md text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: SETS_POLISH.blue }}
              onClick={() => play.mutate()}
              disabled={!play.canPlay || play.isPending}
              data-testid="button-play-set"
            >
              {play.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Play"}
            </button>
            <div
              className="min-h-11 px-4 rounded-md text-sm font-medium flex items-center"
              style={{
                backgroundColor: SETS_POLISH.panel,
                color: SETS_POLISH.ink,
                border: `1px solid ${SETS_POLISH.panelBorder}`,
              }}
              data-testid="text-card-count"
            >
              {cardCount} Card{cardCount === 1 ? "" : "s"}
            </div>
          </div>
          {showPlayCue && play.canPlay && (
            <p className="text-xs" style={{ color: SETS_POLISH.muted }} data-testid="text-play-today">
              {SETS_POLISH.playTodayCue}
            </p>
          )}
          {!play.canPlay && (
            <p className="text-xs" style={{ color: SETS_POLISH.muted }}>
              This set has no playable cards yet.
            </p>
          )}
        </div>

        <SetCover
          shareImageUrl={set.shareImageUrl}
          cardUrls={coverCardUrls}
          caption
        />

        <section className="space-y-3">
          <p
            className="text-[11px] font-medium tracking-[0.18em]"
            style={{ color: SETS_POLISH.muted }}
          >
            {SETS_POLISH.stackHeading}
          </p>
          <TheStack cards={previewCards} />
        </section>

        <div className="flex gap-3">
          <QuietButton onClick={shareSet} testId="button-share-set">Share</QuietButton>
          <QuietButton onClick={copyLink} testId="button-copy-link">Copy link</QuietButton>
        </div>

        <p className="text-xs break-all" style={{ color: SETS_POLISH.muted }} data-testid="text-set-url">
          {displayUrl}
        </p>

        {canSaveCover && (
          <a
            href={set.shareImageUrl}
            download="packpts-set.png"
            className="block text-xs"
            style={{ color: SETS_POLISH.muted }}
          >
            Save cover
          </a>
        )}

        <footer className="flex items-center gap-2 pt-4 pb-2">
          <MaskedPMark />
          <span className="text-sm font-medium tracking-wide">PackPTS</span>
        </footer>
      </div>
    </div>
  );
}
