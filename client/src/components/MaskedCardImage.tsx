import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { DEFAULT_MASK_REGIONS } from "@shared/schema";
import type { MaskRegion } from "@shared/schema";
import { inferLayoutClass, overlayMaskRegions } from "@shared/maskGeometry";
import { MaskPlaque } from "@/components/MaskPlaque";

interface MaskConfig {
  setKey: string;
  regions: MaskRegion[];
  maskVersion: number;
}

interface MaskedCardImageProps {
  src: string;
  setKey?: string;
  alt?: string;
  className?: string;
  showMasks?: boolean;
  onImageLoad?: () => void;
  onImageError?: () => void;
  maskColor?: string;
}

export function MaskedCardImage({
  src,
  setKey,
  alt = "Card image",
  className = "",
  showMasks = true,
  onImageLoad,
  onImageError,
}: MaskedCardImageProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const { data: maskConfig } = useQuery<MaskConfig>({
    queryKey: ["/api/card-sets/mask", setKey || "__default__"],
    queryFn: async () => {
      if (!setKey) {
        return {
          setKey: "__default__",
          regions: DEFAULT_MASK_REGIONS,
          maskVersion: 1,
        };
      }
      const res = await fetch(`/api/card-sets/${encodeURIComponent(setKey)}/mask`);
      if (!res.ok) {
        return {
          setKey: setKey,
          regions: DEFAULT_MASK_REGIONS,
          maskVersion: 1,
        };
      }
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const regions = overlayMaskRegions(maskConfig?.regions);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    onImageLoad?.();
  }, [onImageLoad]);

  const handleImageError = useCallback(() => {
    setImageError(true);
    onImageError?.();
  }, [onImageError]);

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
      className={`relative overflow-hidden select-none ${className}`}
      onContextMenu={handleContextMenu}
      style={{
        touchAction: "manipulation",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      data-testid="masked-card-wrapper"
    >
      {!imageLoaded && !imageError && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-plaque-surface z-10"
          data-testid="masked-card-loading"
        >
          <Loader2 className="h-8 w-8 animate-spin text-plaque-muted" />
        </div>
      )}

      {imageError && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-plaque-surface ring-1 ring-plaque-frame z-10"
          data-testid="masked-card-error"
        >
          <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-plaque-ink">Card image didn't load</p>
        </div>
      )}

      <img
        src={src}
        alt={alt}
        className="w-full h-full object-contain pointer-events-none"
        style={{
          opacity: imageLoaded && !imageError ? 1 : 0,
          WebkitUserDrag: "none",
          userSelect: "none",
        } as React.CSSProperties}
        onLoad={handleImageLoad}
        onError={handleImageError}
        onDragStart={handleDragStart}
        draggable={false}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        data-testid="masked-card-image"
      />

      {showMasks && !imageError && (
        <MaskPlaque
          regions={regions}
          layoutClass={inferLayoutClass(regions)}
          pending={!imageLoaded}
        />
      )}
    </div>
  );
}

export type { MaskRegion, MaskConfig };
