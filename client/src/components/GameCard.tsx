import { useState } from "react";
import { Loader2, SkipForward, RefreshCw, Flag, Users, ImageOff, RotateCw, HelpCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
    console.error('[GameCard] Error checking for blank image:', e);
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
  onImageError?: () => void;
  imageRotation?: number;
  showSkipButton?: boolean;
  skipPending?: boolean;
  onSkip?: () => void;
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
  onImageError, 
  imageRotation = 0,
  showSkipButton = false,
  skipPending = false,
  onSkip,
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
  const [imageError, setImageError] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const { toast } = useToast();

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    
    if (img.naturalWidth < 50 || img.naturalHeight < 50) {
      setImageError(true);
      onImageError?.();
      return;
    }
    
    if (aspectRatio > 1.3) {
      console.log(`[GameCard] Detected abnormal aspect ratio ${aspectRatio.toFixed(2)} for image, likely duplicated`);
      setImageError(true);
      onImageError?.();
      return;
    }
    
    if (isBlankImage(img)) {
      console.log(`[GameCard] Detected blank/uniform color image, skipping`);
      setImageError(true);
      onImageError?.();
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
      console.error("[GameCard] Error submitting report:", error);
      toast({
        title: "Report failed",
        description: "Unable to submit report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setReportPending(false);
    }
  };

  return (
    <div className="relative aspect-[2.5/3.5] w-full max-w-xs mx-auto overflow-hidden rounded-md border-4 border-card-border shadow-lg bg-slate-900">
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {imageError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-amber-100 to-amber-200">
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
                {skipPending ? "Skipping..." : "Skip to Next"}
              </Button>
            )}
          </div>
        </div>
      )}
      <img
        src={imageUrl}
        alt="Baseball card"
        className={`absolute inset-0 w-full h-full object-contain ${imageError ? 'pointer-events-none' : ''}`}
        crossOrigin="anonymous"
        style={{
          opacity: imageLoaded && !imageError ? 1 : 0,
          transform: imageRotation ? `rotate(${imageRotation}deg)` : undefined,
        }}
        onLoad={handleImageLoad}
        onError={handleError}
        referrerPolicy="no-referrer"
        data-testid="img-card"
      />
      {!isRevealed && imageLoaded && !imageError && (
        <div 
          className="absolute top-0 left-0 right-0 transition-opacity duration-500"
          style={{ height: "18%" }}
        >
          <div className="w-full h-full bg-gradient-to-b from-slate-800 via-slate-700 to-slate-600 flex items-center justify-center border-b-2 border-slate-900">
            <span className="text-xs font-bold text-slate-200 tracking-widest">{setLabel || "MYSTERY CARD"}</span>
          </div>
        </div>
      )}
      {!isRevealed && imageLoaded && !imageError && (
        <div 
          className="absolute bottom-0 left-0 right-0 transition-opacity duration-500"
          style={{ height: "20%" }}
        >
          <div className="w-full h-full bg-gradient-to-t from-amber-800 via-amber-700 to-amber-600 flex items-center justify-center border-t-2 border-amber-900">
            <span className="text-sm font-bold text-amber-100 tracking-widest drop-shadow-md">WHO IS THIS PLAYER?</span>
          </div>
        </div>
      )}
      
      {cardId && imageLoaded && !imageError && (
        <div className="absolute top-2 right-2 z-10">
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
