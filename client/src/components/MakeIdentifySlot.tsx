import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  IDENTIFY_FAIL_BORDER,
  IDENTIFY_RETRY_COPY,
  MAKE_BLUE,
  MAKE_CREAM,
  MAKE_GOLD,
  MAKE_GREEN,
  MAKE_INK,
  MAKE_MUTED,
  MAKE_PANEL,
  draftBoardTitle,
  draftSlotTitle,
  identifySlotChrome,
} from "@/lib/makeIdentifyUi";
import { Check, Loader2 } from "lucide-react";

interface IdentifiedCard {
  playerName: string;
  year: number;
  brand: string;
  imageUrl?: string | null;
}

interface MakeIdentifySlotProps {
  index: number;
  file: File;
  status: "queued" | "loading" | "ok" | "error";
  card?: IdentifiedCard;
  detail?: string;
  onTryAgain: () => void;
  onSkip: () => void;
}

function usePreviewUrl(file: File, remote?: string | null) {
  const [url, setUrl] = useState<string | null>(remote ?? null);
  useEffect(() => {
    if (remote) {
      setUrl(remote);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, remote]);
  return url;
}

function SlotThumb({
  status,
  previewUrl,
}: {
  status: MakeIdentifySlotProps["status"];
  previewUrl: string | null;
}) {
  const failed = status === "error";
  return (
    <div
      className="relative mx-auto aspect-[2.5/3.5] w-full max-w-[88px] overflow-hidden rounded-md"
      style={{
        background: failed ? "#0E131C" : MAKE_CREAM,
        border: failed ? "none" : `1.5px solid ${MAKE_GOLD}`,
      }}
    >
      {!failed && previewUrl && (
        <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {status === "ok" && (
        <span
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full"
          style={{ background: MAKE_GREEN }}
          aria-hidden
        >
          <Check className="h-3 w-3 text-white" />
        </span>
      )}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: MAKE_BLUE }} />
        </div>
      )}
    </div>
  );
}

export function MakeIdentifySlot({
  index,
  file,
  status,
  card,
  detail,
  onTryAgain,
  onSkip,
}: MakeIdentifySlotProps) {
  const chrome = identifySlotChrome(status);
  const title = draftSlotTitle(status, card, index);
  const previewUrl = usePreviewUrl(file, card?.imageUrl);

  return (
    <div
      data-testid="make-identify-slot"
      data-status={status}
      className="flex min-w-[7.25rem] flex-1 flex-col gap-2 rounded-xl p-2.5"
      style={
        chrome.failBorder
          ? { border: `1px solid ${IDENTIFY_FAIL_BORDER}`, background: "rgba(11,15,22,0.6)" }
          : undefined
      }
    >
      <SlotThumb status={status} previewUrl={previewUrl} />
      <div className="min-h-[2.5rem] text-center">
        <p className="truncate text-xs font-medium" style={{ color: MAKE_INK }}>
          {title}
        </p>
        <p
          className="mt-0.5 text-[11px]"
          style={{ color: chrome.success ? MAKE_GREEN : MAKE_MUTED }}
        >
          {chrome.label}
        </p>
      </div>
      {status === "error" && (
        <div className="space-y-1.5">
          {detail && detail !== IDENTIFY_RETRY_COPY.failed && (
            <p className="text-center text-[10px]" style={{ color: MAKE_MUTED }}>
              {detail}
            </p>
          )}
          <Button
            size="sm"
            className="h-8 w-full text-xs font-semibold text-white border-0"
            style={{ background: MAKE_BLUE }}
            onClick={onTryAgain}
            data-testid="make-try-again"
          >
            {IDENTIFY_RETRY_COPY.tryAgain}
          </Button>
          <button
            type="button"
            className="block w-full text-center text-[11px]"
            style={{ color: MAKE_MUTED }}
            onClick={onSkip}
            data-testid="make-skip"
          >
            {IDENTIFY_RETRY_COPY.skip}
          </button>
        </div>
      )}
    </div>
  );
}

export function MakeDraftBoard({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="make-draft-board"
      className="rounded-2xl border p-4"
      style={{ background: MAKE_PANEL, borderColor: "rgba(143, 150, 163, 0.18)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: MAKE_INK }}>
          {draftBoardTitle(count)}
        </p>
        <p className="text-[11px] font-medium tracking-wide" style={{ color: MAKE_MUTED }}>
          {IDENTIFY_RETRY_COPY.sequential}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">{children}</div>
    </div>
  );
}
