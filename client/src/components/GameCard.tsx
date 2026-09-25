import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, SkipForward, RefreshCw, Flag, Users, ImageOff, RotateCw, HelpCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import type { MaskRegion, PublicMaskPlan } from "@shared/schema";
import { inferLayoutClass, overlayMaskRegions } from "@shared/maskGeometry";
import { MaskPlaque, type PlaqueLayoutClass } from "@/components/MaskPlaque";
import {
  GAME_CARD_HONEST_IMAGE_ERROR_COPY,
  GAME_CARD_REPLACEMENT_PENDING_COPY,
  resolveGameCardImageErrorKind,
} from "@/lib/gameCardImageError";
import { nextGameCardImageState } from "@/lib/gameCardImageState";
import { playImageReportRequest, type PlayReportScope } from "@/lib/playImageReport";
import {
  analyzePlaceholderPixels,
  evaluateCardImageValidity,
  isPlaceholderUrl,
  shouldRunClientCanvasReject,
} from "@/lib/placeholderImageDetect";
import {
  gameCardReplaceOverlay,
  type SoloReplacePhase,
} from "@/lib/soloImageReplace";
import { isPlayCardImageReady, markPlayCardImageReady } from "@/lib/prefetchPlayCardImages";

interface MaskConfig {
  setKey: string;
  regions: MaskRegion[];
  maskVersion: number;
}

const CLIENT_SIDE_IMAGE_VALIDATION = import.meta.env.VITE_CLIENT_SIDE_IMAGE_VALIDATION !== 'false';

/**
 * Canvas silhouette check. Dominant >50% alone is NOT a silhouette (Topps Chrome
 * borders trip that). See client/src/lib/placeholderImageDetect.ts.
 */
function isPlaceholderImage(img: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const sampleSize = 100;
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const analysis = analyzePlaceholderPixels(imageData.data, sampleSize, sampleSize, {
      ignoreMaskFill: true,
    });
    if (analysis.isPlaceholder) {
      console.warn("[GameCard] placeholder bitmap", {
        uniqueColors: analysis.uniqueColors,
        dominantPercent: Math.round(analysis.dominantPercent),
        sampledPixels: analysis.sampledPixels,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    }
    return analysis.isPlaceholder;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError') {
      return false;
    }
    return false;
  }
}

/**
 * Canvas-based image validation — detects blank/placeholder card images.
 * Performance note: runs on the client for every loaded image.
 * Server-side canonical solution: see server/services/imageValidation.ts
 * Toggle with VITE_CLIENT_SIDE_IMAGE_VALIDATION env var (default: enabled when var is absent).
 */
function isBlankImage(img: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    
    const sampleSize = 50;
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    
    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    
    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const pixels = imageData.data;
    
    const refR = pixels[0];
    const refG = pixels[1];
    const refB = pixels[2];
    
    const isVeryLight = refR > 240 && refG > 240 && refB > 240;
    const isVeryDark = refR < 15 && refG < 15 && refB < 15;
    
    if (!isVeryLight && !isVeryDark) {
      return false;
    }
    
    const samplePoints = [
      0,
      (sampleSize / 2) * 4,
      (sampleSize - 1) * 4,
      (sampleSize * sampleSize / 2) * 4,
      (sampleSize * (sampleSize - 1)) * 4,
      (sampleSize * sampleSize - 1) * 4,
    ];
    
    const tolerance = 20;
    for (const offset of samplePoints) {
      if (offset >= pixels.length) continue;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      
      if (Math.abs(r - refR) > tolerance || 
          Math.abs(g - refG) > tolerance || 
          Math.abs(b - refB) > tolerance) {
        return false;
      }
    }
    
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError') {
      return false;
    }
    return false;
  }
}

const REPORT_REASONS = [
  { value: "multi_player", label: "Multiple Players", icon: Users, description: "Card shows more than one player" },
  { value: "bad_image", label: "Bad Image", icon: ImageOff, description: "Image is blurry, cropped, or unreadable" },
  { value: "upside_down", label: "Upside Down", icon: RotateCw, description: "Card image is rotated incorrectly" },
  { value: "other", label: "Other Issue", icon: HelpCircle, description: "Another problem with this card" },
] as const;

interface GameCardProps {
  imageUrl: string;
  isRevealed: boolean;
  setLabel?: string;
  setKey?: string;
  onImageError?: () => void;
  imageRotation?: number;
  showSkipButton?: boolean;
  skipPending?: boolean;
  onSkip?: () => void;
  skipButtonMode?: 'replace' | 'skip';
  showReplaceButton?: boolean;
  replacePending?: boolean;
  onReplace?: () => void;
  cardNumber?: string;
  team?: string;
  cardId?: string;
  sessionId?: string;
  /** With sessionId + questionIndex, reports resolve the card on the server. */
  playScope?: PlayReportScope;
  questionIndex?: number;
  onReportSubmitted?: () => void;
  isSetOfWeek?: boolean;
  setOfWeekMultiplier?: number;
  /** Daily 5 must pass false. Canvas reject has no replace path. Solo/1v1 default true. */
  allowClientImageReject?: boolean;
  maskPlan?: PublicMaskPlan | null;
  /** Set only after the server ACKs the answer. Never a raw card id. */
  revealUrl?: string;
  plaqueEyebrow?: string;
  answerStaged?: boolean;
  /** Used in alt text only after reveal. */
  revealedPlayerName?: string;
  /** Solo replace lifecycle. Omitted on Daily 5 and 1v1. */
  replacePhase?: SoloReplacePhase;
  onRetryImage?: () => void;
}

export function GameCard({
  imageUrl,
  isRevealed,
  setLabel,
  setKey,
  onImageError,
  imageRotation = 0,
  showSkipButton = false,
  skipPending = false,
  onSkip,
  skipButtonMode = 'replace',
  showReplaceButton = false,
  replacePending = false,
  onReplace,
  cardNumber,
  team,
  cardId,
  sessionId,
  playScope,
  questionIndex,
  onReportSubmitted,
  isSetOfWeek = false,
  setOfWeekMultiplier,
  allowClientImageReject = true,
  maskPlan = null,
  revealUrl,
  plaqueEyebrow,
  answerStaged = false,
  revealedPlayerName,
  replacePhase,
  onRetryImage,
}: GameCardProps) {
  const CDN_BASE_URL = import.meta.env.VITE_CDN_BASE_URL || '';
  const [honestRetry, setHonestRetry] = useState(0);
  const baseImageUrl = CDN_BASE_URL && imageUrl ? `${CDN_BASE_URL}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}` : imageUrl;
  const cdnImageUrl = honestRetry > 0
    ? `${baseImageUrl}${baseImageUrl.includes("?") ? "&" : "?"}retry=${honestRetry}`
    : baseImageUrl;

  const [imageLoaded, setImageLoaded] = useState(
    () => nextGameCardImageState(imageUrl, isPlayCardImageReady(imageUrl)).imageLoaded,
  );
  const [imageError, setImageError] = useState(
    () => nextGameCardImageState(imageUrl, false).imageError,
  );
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [revealLoaded, setRevealLoaded] = useState(false);
  const [revealFailed, setRevealFailed] = useState(false);
  const [imageUrlSeen, setImageUrlSeen] = useState(imageUrl);
  if (imageUrl !== imageUrlSeen) {
    const next = nextGameCardImageState(imageUrl, isPlayCardImageReady(imageUrl));
    setImageUrlSeen(imageUrl);
    setImageError(next.imageError);
    setImageLoaded(next.imageLoaded);
    setNaturalSize(null);
    setRevealLoaded(false);
    setRevealFailed(false);
    setHonestRetry(0);
  }
  // A reveal URL always paints. The failed masked image must not keep the spinner up.
  if (revealUrl && imageError) {
    setImageError(false);
  }
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const { toast } = useToast();

  const { data: maskConfig } = useQuery<MaskConfig>({
    queryKey: ["/api/card-sets/mask", setKey || setLabel || "__default__"],
    queryFn: async () => {
      const key = setKey || setLabel || "";
      if (!key) {
        return {
          setKey: "__default__",
          regions: DEFAULT_MASK_REGIONS,
          maskVersion: 1,
        };
      }
      try {
        const res = await fetch(`/api/card-sets/${encodeURIComponent(key)}/mask`);
        if (!res.ok) {
          return {
            setKey: key,
            regions: DEFAULT_MASK_REGIONS,
            maskVersion: 1,
          };
        }
        return res.json();
      } catch {
        return {
          setKey: key,
          regions: DEFAULT_MASK_REGIONS,
          maskVersion: 1,
        };
      }
    },
    staleTime: 10 * 60 * 1000,
  });

  const regions = maskPlan?.regions?.length ? maskPlan.regions : overlayMaskRegions(maskConfig?.regions);
  const layoutClass: PlaqueLayoutClass = maskPlan?.layoutClass ?? inferLayoutClass(regions);
  const eyebrow = plaqueEyebrow || setLabel || undefined;

  useEffect(() => {
    setRevealLoaded(false);
    setRevealFailed(false);
  }, [revealUrl, imageUrl]);

  useEffect(() => {
    if (imageUrl && !revealUrl && isPlaceholderUrl(imageUrl)) {
      const target = playImageReportRequest({
        imageUrl,
        cardId,
        scope: playScope,
        sessionId,
        questionIndex,
        reason: "bad_image",
        autoDetected: true,
        detectionReason: "placeholder_url_pattern",
      });
      if (target) {
        apiRequest("POST", target.url, target.body).catch(() => {});
      }
      onImageError?.();
    }
  }, [imageUrl, cardId, playScope, sessionId, questionIndex, onImageError, revealUrl]);

  const autoReportPlaceholder = async (reason: string) => {
    const target = playImageReportRequest({
      imageUrl,
      cardId,
      scope: playScope,
      sessionId,
      questionIndex,
      reason: "bad_image",
      autoDetected: true,
      detectionReason: reason,
    });
    if (!target) return;
    try {
      await apiRequest("POST", target.url, target.body);
    } catch {}
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (revealUrl) {
      markPlayCardImageReady(imageUrl);
      setImageError(false);
      setImageLoaded(true);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
      return;
    }

    const validity = evaluateCardImageValidity({
      width: img.naturalWidth,
      height: img.naturalHeight,
      rotation: imageRotation,
    });
    if (!validity.ok) {
      console.warn("[GameCard] rejected loaded image", validity);
      setImageError(true);
      onImageError?.();
      autoReportPlaceholder(validity.reason ?? "abnormal_aspect_ratio");
      return;
    }
    if (validity.acceptedSidewaysCard) {
      console.warn("[GameCard] accepted sideways trading-card scan", validity);
    }
    
    // Canvas silhouette/blank checks. Daily 5 sets allowClientImageReject={false}.
    if (shouldRunClientCanvasReject(allowClientImageReject, CLIENT_SIDE_IMAGE_VALIDATION)) {
      if (isBlankImage(img)) {
        setImageError(true);
        onImageError?.();
        autoReportPlaceholder("blank_image");
        return;
      }

      if (isPlaceholderImage(img)) {
        setImageError(true);
        onImageError?.();
        autoReportPlaceholder("placeholder_image");
        return;
      }
    }

    markPlayCardImageReady(imageUrl);
    if (!isPlaceholderUrl(imageUrl)) setImageError(false);
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setImageLoaded(true);
  };

  const handleRevealError = () => {
    setRevealFailed(true);
  };

  const handleError = () => {
    if (revealUrl) return;
    setImageError(true);
    onImageError?.();
  };

  const handleReport = async (reason: string) => {
    const target = playImageReportRequest({
      imageUrl,
      cardId,
      scope: playScope,
      sessionId,
      questionIndex,
      reason,
    });
    if (!target) {
      toast({
        title: "Unable to report",
        description: "Card information not available",
        variant: "destructive",
      });
      return;
    }

    setReportPending(true);
    try {
      await apiRequest("POST", target.url, target.body);
      
      setReportSubmitted(true);
      setReportOpen(false);
      toast({
        title: "Report submitted",
        description: reason === "multi_player" 
          ? "Thanks! This card will be reviewed and removed if it has multiple players."
          : "Thanks for helping improve the game!",
      });
      onReportSubmitted?.();
    } catch (error) {
      toast({
        title: "Report failed",
        description: "Unable to submit report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setReportPending(false);
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    return false;
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    return false;
  }, []);

  const forcedOverlay = gameCardReplaceOverlay({
    allowClientImageReject,
    replacePhase,
    revealUrl,
  });
  const imageErrorKind = forcedOverlay === "spinner"
    ? "replace-pending"
    : forcedOverlay === "honest"
      ? "honest"
      : forcedOverlay === "replace-failed"
        ? "replace-failed"
        : resolveGameCardImageErrorKind({ showSkipButton, showReplaceButton, onImageError });
  const slotAspect = 2.5 / 3.5;
  const scanAspect = naturalSize && naturalSize.h > 0 ? naturalSize.w / naturalSize.h : slotAspect;
  const tallScan = scanAspect < slotAspect;
  const chromeOnBottom = layoutClass === "TOP_PLATE" || layoutClass === "PSA_SLAB";
  const guessingAlt = `Masked card, ${eyebrow ?? "sports card"}`;
  const imageAlt = isRevealed && revealedPlayerName ? `Masked card, ${revealedPlayerName}` : guessingAlt;
  const outlineButtonClass = "border-plaque-frame text-plaque-ink";
  const canReportImage = playImageReportRequest({
    imageUrl,
    cardId,
    scope: playScope,
    sessionId,
    questionIndex,
    reason: "bad_image",
  }) !== null;

  return (
    <div className="w-full max-w-xs mx-auto">
    <div 
      className="relative aspect-[2.5/3.5] w-full select-none max-h-full flex items-center justify-center"
      onContextMenu={handleContextMenu}
      style={{
        touchAction: "manipulation",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      data-testid="game-card-wrapper"
    >
      {imageError && (
        <div
          className="flex h-full w-full items-center justify-center rounded-md bg-plaque-surface ring-1 ring-plaque-frame"
          data-testid="game-card-image-error"
          aria-label={GAME_CARD_HONEST_IMAGE_ERROR_COPY}
        >
          <div className="w-[86%] border-y border-plaque-seam bg-plaque-fill px-4 py-6 text-center">
            <div className="mx-auto mb-3 h-[3px] w-7 bg-plaque-bar" />
            <div className="rounded-[3px] border border-plaque-frame px-3 py-4">
            {isRevealed && cardNumber ? (
              <p className="mb-2 text-xs text-plaque-muted">#{cardNumber}{team ? ` ${team}` : ""}</p>
            ) : null}
            <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-plaque-ink">
              CARD IMAGE DIDN'T LOAD
            </p>
            {imageErrorKind !== "replace-pending" && imageErrorKind !== "replace-failed" && (
              <p className="mt-2 text-[13px] text-plaque-muted" data-testid="text-game-card-image-error">
                You can still answer.
              </p>
            )}
            {imageErrorKind === "honest" && (
              <Button
                variant="outline"
                className={`mt-3 ${outlineButtonClass}`}
                onClick={() => {
                  setImageError(false);
                  setImageLoaded(false);
                  setHonestRetry((count) => count + 1);
                }}
                data-testid="button-retry-image"
              >
                Retry image
              </Button>
            )}
            {imageErrorKind === "replace-pending" && (
              <>
                <Loader2 className="mx-auto mt-3 h-4 w-4 animate-spin text-plaque-muted" />
                <p className="mt-2 text-[13px] text-plaque-muted" data-testid="text-game-card-image-error">
                  {GAME_CARD_REPLACEMENT_PENDING_COPY}
                </p>
              </>
            )}
            {imageErrorKind === "replace-failed" && (
              <>
                <p className="mt-2 text-[13px] text-plaque-muted" data-testid="text-game-card-replace-failed">
                  Retry this card or skip it.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className={outlineButtonClass}
                    onClick={() => {
                      setImageError(false);
                      setImageLoaded(false);
                      setHonestRetry((count) => count + 1);
                      onRetryImage?.();
                    }}
                    data-testid="button-retry-image"
                  >
                    Retry image
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onSkip}
                    disabled={skipPending || !onSkip}
                    className={outlineButtonClass}
                    data-testid="button-skip-broken-card"
                  >
                    {skipPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <SkipForward className="h-4 w-4 mr-2" />}
                    Skip
                  </Button>
                </div>
              </>
            )}
            {imageErrorKind === "replace-button" && (
              <>
                {!replacePending && (
                  <Button
                    variant="outline"
                    onClick={onReplace}
                    disabled={replacePending || !onReplace}
                    className={`mt-3 gap-2 ${outlineButtonClass}`}
                    data-testid="button-try-another-card"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Another Card
                  </Button>
                )}
                {replacePending && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-plaque-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Fetching another card...</span>
                  </div>
                )}
              </>
            )}
            {imageErrorKind === "skip-button" && (
              <Button
                variant="outline"
                size="default"
                onClick={onSkip}
                disabled={skipPending || !onSkip}
                className={`mt-3 ${outlineButtonClass}`}
                data-testid="button-skip-broken-card"
              >
                {skipPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <SkipForward className="h-4 w-4 mr-2" />
                )}
                {skipPending
                  ? (skipButtonMode === 'skip' ? "Skipping..." : "Loading card...")
                  : (skipButtonMode === 'skip' ? "Skip to Next" : "Try Different Card")
                }
              </Button>
            )}
            </div>
          </div>
        </div>
      )}
      {!imageError && (
        <div
          data-testid="game-card-image-box"
          className={`relative mx-auto overflow-hidden rounded-md bg-plaque-surface ring-1 ring-plaque-frame shadow-[0_6px_20px_rgba(0,0,0,0.45)] ${tallScan ? "h-full" : "w-full"}`}
          style={{ aspectRatio: naturalSize ? `${naturalSize.w} / ${naturalSize.h}` : "2.5 / 3.5" }}
        >
          {/* CDN delivery: set VITE_CDN_BASE_URL env var to enable (e.g., https://cdn.yoursite.com) */}
          {/* Server serves upright pixels for the bake and the reveal. CSS rotation would move only this frame. */}
          <img
            key={imageUrl}
            src={cdnImageUrl}
            alt={imageAlt}
            className="absolute inset-0 h-full w-full pointer-events-none"
            crossOrigin="anonymous"
            loading="eager"
            decoding="async"
            style={{
              opacity: imageLoaded ? 1 : 0,
              WebkitUserDrag: "none",
            } as React.CSSProperties}
            onLoad={handleImageLoad}
            onError={handleError}
            onDragStart={handleDragStart}
            draggable={false}
            referrerPolicy="no-referrer"
            data-testid="img-card"
          />
          {revealUrl ? (
            <img
              src={revealUrl}
              alt={imageAlt}
              className={`absolute inset-0 h-full w-full pointer-events-none transition-opacity duration-240 ease-out motion-reduce:transition-none ${revealLoaded ? "opacity-100" : "opacity-0"}`}
              loading="eager"
              decoding="async"
              draggable={false}
              onLoad={() => setRevealLoaded(true)}
              onError={handleRevealError}
              data-testid="img-card-reveal"
            />
          ) : null}
          <MaskPlaque
            regions={regions}
            layoutClass={layoutClass}
            eyebrow={eyebrow}
            armed={answerStaged}
            hidden={revealLoaded}
            pending={!imageLoaded}
          />
          {isSetOfWeek && (
            <div className={`absolute z-30 pointer-events-none ${chromeOnBottom ? "bottom-2 left-2" : "top-2 left-2"}`}>
              <span className="inline-flex items-center rounded-[3px] border border-plaque-bar bg-plaque-fill px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] text-plaque-bar">
                {setOfWeekMultiplier ? `FEATURED ${setOfWeekMultiplier}x PTS` : "FEATURED"}
              </span>
            </div>
          )}
          {canReportImage && (
            <div className={`absolute z-30 ${chromeOnBottom ? "bottom-2 right-2" : "top-2 right-2"}`}>
              <Popover open={reportOpen} onOpenChange={setReportOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`relative h-8 w-8 bg-black/50 hover:bg-black/70 before:absolute before:-inset-1 before:content-[''] ${reportSubmitted ? "text-green-400" : "text-white/70 hover:text-white"}`}
                    disabled={reportSubmitted || reportPending}
                    aria-label="Report this card image"
                    data-testid="button-report-card"
                  >
                    {reportSubmitted ? (
                      <Check className="h-4 w-4" />
                    ) : reportPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Flag className="h-4 w-4" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="end">
                  <div className="space-y-1">
                    <p className="text-sm font-medium px-2 py-1">Report this card</p>
                    {REPORT_REASONS.map((reason) => (
                      <Button
                        key={reason.value}
                        variant="ghost"
                        className="w-full justify-start gap-2 h-auto py-2"
                        onClick={() => handleReport(reason.value)}
                        disabled={reportPending}
                        data-testid={`button-report-${reason.value}`}
                      >
                        <reason.icon className="h-4 w-4 shrink-0" />
                        <div className="text-left">
                          <div className="text-sm font-medium">{reason.label}</div>
                          <div className="text-xs text-muted-foreground">{reason.description}</div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      )}
    </div>
    {revealFailed && (
      <p className="mt-2 text-center text-xs text-plaque-muted" data-testid="text-reveal-image-error">
        Full card image didn't load.
      </p>
    )}
    </div>
  );
}
