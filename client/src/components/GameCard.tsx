import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { logger } from "@/lib/logger";
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
import type { MaskRegion } from "@shared/schema";
import { largestMaskRegion, overlayMaskRegions } from "@shared/maskGeometry";
import {
  GAME_CARD_HONEST_IMAGE_ERROR_COPY,
  GAME_CARD_REPLACEMENT_PENDING_COPY,
  resolveGameCardImageErrorKind,
} from "@/lib/gameCardImageError";
import {
  isPlaceholderBitmap,
  isPlaceholderUrl,
  shouldRunClientCanvasReject,
} from "@/lib/placeholderImageDetect";
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
    const analysis = isPlaceholderBitmap(imageData.data, sampleSize, sampleSize);
    if (analysis) {
      logger.warn(`[PlaceholderDetect] Silhouette bitmap (low unique colors AND near-flat histogram)`);
    }
    return analysis;
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
  onReportSubmitted?: () => void;
  isSetOfWeek?: boolean;
  setOfWeekMultiplier?: number;
  /** Daily 5 must pass false — canvas reject has no replace path. Solo/1v1 default true. */
  allowClientImageReject?: boolean;
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
  onReportSubmitted,
  isSetOfWeek = false,
  setOfWeekMultiplier,
  allowClientImageReject = true,
}: GameCardProps) {
  const CDN_BASE_URL = import.meta.env.VITE_CDN_BASE_URL || '';
  const cdnImageUrl = CDN_BASE_URL && imageUrl ? `${CDN_BASE_URL}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}` : imageUrl;

  const [imageLoaded, setImageLoaded] = useState(() => isPlayCardImageReady(imageUrl));
  const [imageError, setImageError] = useState(() => {
    if (imageUrl && isPlaceholderUrl(imageUrl)) {
      return true;
    }
    return false;
  });
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

  const regions = overlayMaskRegions(maskConfig?.regions);
  const nameBandRegion = largestMaskRegion(regions);

  useEffect(() => {
    if (imageUrl && isPlaceholderUrl(imageUrl) && cardId) {
      apiRequest("POST", `/api/cards/${cardId}/report`, { 
        reason: "bad_image", 
        sessionId,
        autoDetected: true,
        detectionReason: "placeholder_url_pattern"
      }).catch(() => {});
      onImageError?.();
    }
  }, [imageUrl, cardId, sessionId, onImageError]);

  const autoReportPlaceholder = async (reason: string) => {
    if (!cardId) return;
    try {
      await apiRequest("POST", `/api/cards/${cardId}/report`, { 
        reason: "bad_image", 
        sessionId,
        autoDetected: true,
        detectionReason: reason
      });
    } catch {}
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    if (img.naturalWidth < 50 || img.naturalHeight < 50) {
      setImageError(true);
      onImageError?.();
      autoReportPlaceholder("image_too_small");
      return;
    }
    
    if (aspectRatio > 1.3) {
      setImageError(true);
      onImageError?.();
      autoReportPlaceholder("abnormal_aspect_ratio");
      return;
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
    setImageLoaded(true);
  };

  const handleError = () => {
    setImageError(true);
    onImageError?.();
  };

  const handleReport = async (reason: string) => {
    if (!cardId) {
      toast({
        title: "Unable to report",
        description: "Card information not available",
        variant: "destructive",
      });
      return;
    }

    setReportPending(true);
    try {
      await apiRequest("POST", `/api/cards/${cardId}/report`, { reason, sessionId });
      
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

  const imageErrorKind = resolveGameCardImageErrorKind({ showSkipButton, showReplaceButton, onImageError });

  return (
    <div 
      className="relative aspect-[2.5/3.5] w-full max-w-xs mx-auto overflow-hidden rounded-md border-4 border-card-border shadow-lg bg-slate-900 select-none max-h-full"
      onContextMenu={handleContextMenu}
      style={{
        touchAction: "manipulation",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      data-testid="game-card-wrapper"
    >
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {imageError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-amber-100 to-amber-200 z-30" data-testid="game-card-image-error">
          <div className="text-center space-y-3 px-4">
            {isRevealed && cardNumber ? (
              <div className="mb-4">
                <p className="text-2xl font-bold text-amber-800">Image Failed to Load</p>
                <p className="text-lg text-amber-700">#{cardNumber}</p>
                {team && <p className="text-sm text-amber-600 mt-2">{team}</p>}
              </div>
            ) : (
              <p className="text-2xl font-bold text-amber-800 mb-4">Image Failed to Load</p>
            )}
            {imageErrorKind === "honest" && (
              <p className="text-sm text-amber-900" data-testid="text-game-card-image-error">
                {GAME_CARD_HONEST_IMAGE_ERROR_COPY}
              </p>
            )}
            {imageErrorKind === "replace-pending" && (
              <>
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground" data-testid="text-game-card-image-error">
                  {GAME_CARD_REPLACEMENT_PENDING_COPY}
                </p>
              </>
            )}
            {imageErrorKind === "replace-button" && (
              <>
                {!replacePending && (
                  <Button 
                    variant="secondary" 
                    onClick={onReplace}
                    disabled={replacePending || !onReplace}
                    className="gap-2"
                    data-testid="button-try-another-card"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Another Card
                  </Button>
                )}
                {replacePending && (
                  <div className="flex items-center gap-2 text-amber-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Fetching another card...</span>
                  </div>
                )}
              </>
            )}
            {imageErrorKind === "skip-button" && (
              <Button 
                variant="default" 
                size="default"
                onClick={onSkip}
                disabled={skipPending || !onSkip}
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
      )}
      {/* CDN delivery: set VITE_CDN_BASE_URL env var to enable (e.g., https://cdn.yoursite.com) */}
      {/* srcSet hint: when CDN is configured, add ?w=400&q=80 for responsive images */}
      <img
        src={cdnImageUrl}
        alt={isRevealed && team ? `${team} sports card` : "sports card"}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        crossOrigin="anonymous"
        loading="eager"
        decoding="async"
        style={{
          opacity: imageLoaded && !imageError ? 1 : 0,
          transform: imageRotation ? `rotate(${imageRotation}deg)` : undefined,
          WebkitUserDrag: "none",
        } as React.CSSProperties}
        onLoad={handleImageLoad}
        onError={handleError}
        onDragStart={handleDragStart}
        draggable={false}
        referrerPolicy="no-referrer"
        data-testid="img-card"
      />
      
      {!isRevealed && !imageError && regions.map((region, index) => (
        <div
          key={index}
          className="absolute pointer-events-none transition-opacity duration-300 flex items-center justify-center"
          style={{
            left: `${region.xPct}%`,
            top: `${region.yPct}%`,
            width: `${region.wPct}%`,
            height: `${region.hPct}%`,
            backgroundColor: region.type === "solid" ? "#0b0f16" : "transparent",
            borderRadius: region.radiusPct ? `${region.radiusPct}%` : undefined,
            backdropFilter: region.type === "blur" ? "blur(12px)" : undefined,
            WebkitBackdropFilter: region.type === "blur" ? "blur(12px)" : undefined,
            zIndex: 20,
          }}
          data-testid={`mask-region-${index}`}
        >
          {index === 0 && region.type === "solid" && (
            <div className="w-full h-full bg-gradient-to-b from-slate-800 via-slate-700 to-slate-600 flex items-center justify-center border-b-2 border-slate-900">
              <span className="text-xs font-bold text-slate-200 tracking-widest">{setLabel || "MYSTERY CARD"}</span>
            </div>
          )}
          {index === 0 && region.type === "blur" && (
            <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.45)" }}>
              <span className="text-xs font-bold text-slate-100 tracking-widest drop-shadow-lg">{setLabel || "MYSTERY CARD"}</span>
            </div>
          )}
        </div>
      ))}

      {!isRevealed && !imageError && regions.map((region, index) => {
        const isPrimary = nameBandRegion === region || (index === 0 && !nameBandRegion);
        return (
          <div
            key={`name-band-${index}`}
            className="absolute pointer-events-none flex items-center justify-center"
            style={{
              left: `${region.xPct}%`,
              top: `${region.yPct}%`,
              width: `${region.wPct}%`,
              height: `${region.hPct}%`,
              backgroundColor: "#0a0e16",
              zIndex: 21,
            }}
            data-testid={isPrimary ? "mask-name-band" : `mask-name-band-${index}`}
          >
            {isPrimary && region.hPct >= 8 && (
              <span className="text-sm font-bold text-slate-100 tracking-widest drop-shadow-lg px-2 text-center">WHO IS THIS PLAYER?</span>
            )}
          </div>
        );
      })}
      
      {isSetOfWeek && !imageError && (
        <div className="absolute top-2 left-2 z-30 pointer-events-none">
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold bg-yellow-400 text-yellow-900 shadow">
            ⭐ FEATURED{setOfWeekMultiplier ? ` — ${setOfWeekMultiplier}x PTS` : ""}
          </span>
        </div>
      )}
      {cardId && !imageError && (
        <div className="absolute top-2 right-2 z-30">
          <Popover open={reportOpen} onOpenChange={setReportOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 bg-black/50 hover:bg-black/70 ${reportSubmitted ? 'text-green-400' : 'text-white/70 hover:text-white'}`}
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
  );
}
