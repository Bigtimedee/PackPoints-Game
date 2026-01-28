import { useState } from "react";
import { Loader2, SkipForward, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  team
}: GameCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

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
    </div>
  );
}
