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

interface MaskRegion {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  type: "solid" | "blur" | "pixelate";
  radiusPct?: number;
}

interface MaskConfig {
  setKey: string;
  regions: MaskRegion[];
  maskVersion: number;
}

const DEFAULT_MASK_REGIONS: MaskRegion[] = [
  { xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "solid", radiusPct: 0 },
  { xPct: 0, yPct: 80, wPct: 100, hPct: 20, type: "solid", radiusPct: 0 },
];

const PLACEHOLDER_URL_PATTERNS = [
  /placeholder/i,
  /no[-_]?image/i,
  /default[-_]?image/i,
  /missing[-_]?image/i,
  /silhouette/i,
  /generic[-_]?card/i,
  /coming[-_]?soon/i,
  /not[-_]?available/i,
  /fallback/i,
  /blank[-_]?card/i,
  /unavailable/i,
];

function isPlaceholderUrl(url: string): boolean {
  for (const pattern of PLACEHOLDER_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

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
    const pixels = imageData.data;
    
    const colorSet = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = Math.floor(pixels[i] / 32) * 32;
      const g = Math.floor(pixels[i + 1] / 32) * 32;
      const b = Math.floor(pixels[i + 2] / 32) * 32;
      colorSet.add(`${r},${g},${b}`);
    }
    
    if (colorSet.size < 8) {
      return true;
    }
    
    const colorCounts = new Map<string, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = Math.floor(pixels[i] / 32) * 32;
      const g = Math.floor(pixels[i + 1] / 32) * 32;
      const b = Math.floor(pixels[i + 2] / 32) * 32;
      const key = `${r},${g},${b}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
    
    const totalPixels = (sampleSize * sampleSize);
    const counts = Array.from(colorCounts.values());
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] / totalPixels > 0.8) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError') {
      return false;
    }
    return false;
  }
}

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
  onReportSubmitted
}: GameCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
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

  const regions = maskConfig?.regions || DEFAULT_MASK_REGIONS;

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

  return (
    <div 
      className="relative aspect-[2.5/3.5] w-full max-w-xs mx-auto overflow-hidden rounded-md border-4 border-card-border shadow-lg bg-slate-900 select-none"
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-amber-100 to-amber-200 z-30">
          <div className="text-center space-y-3">
            {cardNumber && (
              <div className="mb-4">
                <p className="text-2xl font-bold text-amber-800">Image Failed to Load</p>
                <p className="text-lg text-amber-700">#{cardNumber}</p>
                {team && <p className="text-sm text-amber-600 mt-2">{team}</p>}
              </div>
            )}
            {!showSkipButton && !showReplaceButton ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Finding a replacement card...</p>
              </>
            ) : showReplaceButton ? (
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
            ) : (
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
      <img
        src={imageUrl}
        alt="Baseball card"
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        crossOrigin="anonymous"
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
          className="absolute pointer-events-auto transition-opacity duration-300"
          style={{
            left: `${region.xPct}%`,
            top: `${region.yPct}%`,
            width: `${region.wPct}%`,
            height: `${region.hPct}%`,
            backgroundColor: region.type === "solid" ? "#0b0f16" : "transparent",
            borderRadius: region.radiusPct ? `${region.radiusPct}%` : undefined,
            backdropFilter: region.type === "blur" ? "blur(10px)" : undefined,
            zIndex: 20,
          }}
          onContextMenu={handleContextMenu}
          data-testid={`mask-region-${index}`}
        >
          {index === 0 && (
            <div className="w-full h-full bg-gradient-to-b from-slate-800 via-slate-700 to-slate-600 flex items-center justify-center border-b-2 border-slate-900">
              <span className="text-xs font-bold text-slate-200 tracking-widest">{setLabel || "MYSTERY CARD"}</span>
            </div>
          )}
          {index === 1 && (
            <div className="w-full h-full bg-gradient-to-t from-amber-800 via-amber-700 to-amber-600 flex items-center justify-center border-t-2 border-amber-900">
              <span className="text-sm font-bold text-amber-100 tracking-widest drop-shadow-md">WHO IS THIS PLAYER?</span>
            </div>
          )}
        </div>
      ))}
      
      {cardId && !imageError && (
        <div className="absolute top-2 right-2 z-30">
          <Popover open={reportOpen} onOpenChange={setReportOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 bg-black/50 hover:bg-black/70 ${reportSubmitted ? 'text-green-400' : 'text-white/70 hover:text-white'}`}
                disabled={reportSubmitted || reportPending}
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
