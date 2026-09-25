import { useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { MaskRegion } from "@shared/schema";
import { largestMaskRegion } from "@shared/maskGeometry";

export type PlaqueLayoutClass = "TOP_PLATE" | "BOTTOM_PLAQUE" | "PSA_SLAB";

interface MaskPlaqueProps {
  regions: MaskRegion[];
  layoutClass: PlaqueLayoutClass;
  eyebrow?: string;
  armed?: boolean;
  hidden?: boolean;
  /** Spinner sits where the label would, while the bake is still loading. */
  pending?: boolean;
}

function seamOnTop(region: MaskRegion): boolean {
  const reachesBottom = region.yPct + region.hPct >= 99;
  if (region.yPct <= 1 && !reachesBottom) return false;
  if (reachesBottom || region.yPct >= 40) return true;
  return false;
}

function labelSizePx(boxWidth: number, labelOnly: boolean): number {
  if (labelOnly || boxWidth < 230) return 11;
  if (boxWidth < 260) return 12;
  return 13;
}

function PlaqueBand({
  region,
  index,
  isPrimary,
  layoutClass,
  eyebrow,
  armed,
  pending,
  boxWidth,
}: {
  region: MaskRegion;
  index: number;
  isPrimary: boolean;
  layoutClass: PlaqueLayoutClass;
  eyebrow?: string;
  armed?: boolean;
  pending?: boolean;
  boxWidth: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const fullWidth = region.wPct >= 90;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!fullWidth) {
    return (
      <div
        ref={ref}
        className="absolute bg-plaque-fill rounded-[2px]"
        style={{
          left: `${region.xPct}%`,
          top: `${region.yPct}%`,
          width: `${region.wPct}%`,
          height: `${region.hPct}%`,
        }}
        data-testid={`mask-region-${index}`}
      />
    );
  }

  const tier = height >= 88 ? "full" : height >= 52 ? "bar-label" : height >= 28 ? "label" : "bar";
  const showFrame = height >= 40;
  const showBar = tier === "full" || tier === "bar-label" || tier === "bar";
  const showLabel = isPrimary && (tier === "full" || tier === "bar-label" || tier === "label");
  const showEyebrow = isPrimary && tier === "full" && !!eyebrow;
  const certSealed = !isPrimary && layoutClass === "PSA_SLAB" && region.yPct <= 1;
  const showCert = certSealed && (tier === "full" || tier === "bar-label");
  const topSeam = seamOnTop(region);

  return (
    <div
      ref={ref}
      className="absolute bg-plaque-fill"
      style={{
        left: `${region.xPct}%`,
        top: `${region.yPct}%`,
        width: `${region.wPct}%`,
        height: `${region.hPct}%`,
      }}
      data-testid={`mask-region-${index}`}
    >
      <div
        className={`absolute inset-x-0 h-px transition-colors duration-150 ease-out ${topSeam ? "top-0" : "bottom-0"} ${armed ? "bg-plaque-seam-armed" : "bg-plaque-seam"}`}
      />
      {showFrame && (
        <div className="absolute inset-[6px] rounded-[3px] border border-plaque-frame" />
      )}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 max-w-[86%] mx-auto"
        data-testid={isPrimary ? "mask-name-band" : undefined}
      >
        {showBar && (
          <div className={`h-[3px] bg-plaque-bar transition-[width] duration-150 ease-out ${armed ? "w-10" : "w-7"}`} />
        )}
        {pending && isPrimary ? (
          <Loader2 className="h-4 w-4 animate-spin text-plaque-muted" />
        ) : (
          <>
            {showCert && (
              <span className="font-mono font-medium text-[10px] tracking-[0.18em] uppercase text-plaque-muted">
                CERT SEALED
              </span>
            )}
            {showEyebrow && (
              <span className="font-mono font-medium text-[10px] tracking-[0.18em] uppercase text-plaque-muted">
                {eyebrow}
              </span>
            )}
            {showLabel && (
              <span
                className="font-sans font-semibold tracking-[0.14em] uppercase text-plaque-ink whitespace-nowrap"
                style={{ fontSize: `${labelSizePx(boxWidth, tier === "label")}px` }}
              >
                WHO IS THIS PLAYER?
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function MaskPlaque({
  regions,
  layoutClass,
  eyebrow,
  armed = false,
  hidden = false,
  pending = false,
}: MaskPlaqueProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(390);
  const fullWidth = regions.filter((region) => region.wPct >= 90);
  const primary = largestMaskRegion(fullWidth.length > 0 ? fullWidth : regions);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 pointer-events-none transition-opacity duration-240 ease-out motion-reduce:transition-none ${hidden ? "opacity-0" : "opacity-100"}`}
      aria-hidden="true"
    >
      {regions.map((region, index) => (
        <PlaqueBand
          key={`${region.xPct}-${region.yPct}-${region.wPct}-${region.hPct}-${index}`}
          region={region}
          index={index}
          isPrimary={primary === region}
          layoutClass={layoutClass}
          eyebrow={eyebrow}
          armed={armed}
          pending={pending}
          boxWidth={boxWidth}
        />
      ))}
    </div>
  );
}
