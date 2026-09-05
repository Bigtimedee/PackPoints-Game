import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy, Share2, Loader2 } from "lucide-react";
import { isUsableImageUrl } from "@/lib/shareAssetUrl";

interface ContentAsset {
  id: string;
  assetType: string;
  metadata: { imageUrl?: string } | null;
  imagePath: string | null;
  createdAt: string;
}

interface ShareAssetCardProps {
  matchId?: string;
  challengeId?: string;
  initialImageUrl?: string;
  downloadFilename?: string;
  shareUrl?: string;
  shareText?: string;
}

const GENERATE_WAIT_MS = 8_000;

async function fetchLatestAsset(matchId?: string, challengeId?: string): Promise<ContentAsset | null> {
  const param = matchId ? `matchId=${encodeURIComponent(matchId)}` : `challengeId=${encodeURIComponent(challengeId ?? "")}`;
  const res = await fetch(`/api/content-assets/latest?${param}`, { credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  const asset = data.assets?.find((a: ContentAsset) => isUsableImageUrl(a.metadata?.imageUrl));
  return asset ?? null;
}

function MaskedPMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="PackPTS"
      className="rounded-md"
    >
      <rect width="1024" height="1024" fill="#0b0f16" />
      <path fill="#ffffff" fillRule="evenodd" d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z" />
      <rect x="292" y="448" width="528" height="96" fill="#F5C518" />
    </svg>
  );
}

function ScoreCardEmptyState({
  retrying,
  onRetry,
  onShareWithoutCard,
}: {
  retrying: boolean;
  onRetry: () => void;
  onShareWithoutCard: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center min-h-[20rem] w-full"
      style={{ backgroundColor: "#0b0f16" }}
      data-testid="score-card-empty-state"
    >
      <MaskedPMark />
      <div>
        <p className="text-base font-semibold text-white">Score card didn’t load.</p>
        <p className="text-sm text-white/60 mt-1">Your points are saved. Try again.</p>
      </div>
      <Button
        className="text-white hover:opacity-90"
        style={{ backgroundColor: "#2B6CEE" }}
        onClick={onRetry}
        disabled={retrying}
        data-testid="button-share-asset-retry"
      >
        {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Retry
      </Button>
      <button
        type="button"
        className="text-sm text-white/60 underline underline-offset-4"
        onClick={onShareWithoutCard}
        data-testid="button-share-without-card"
      >
        Share without card
      </button>
    </div>
  );
}

export function ShareAssetCard({
  matchId,
  challengeId,
  initialImageUrl,
  downloadFilename = "packpts-score.png",
  shareUrl = "https://packpts.com/daily",
  shareText = "I just played PackPTS! Check it out at packpts.com/daily",
}: ShareAssetCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const queryKey = ["content-asset", matchId, challengeId];

  const { data: asset, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchLatestAsset(matchId, challengeId),
    refetchInterval: (query) => {
      if (isUsableImageUrl(query.state.data?.metadata?.imageUrl)) return false;
      if (timedOut) return false;
      return 500;
    },
    retry: false,
    enabled: !!(matchId || challengeId),
  });

  const fetchedUrl = isUsableImageUrl(asset?.metadata?.imageUrl) ? asset.metadata.imageUrl : undefined;
  const seededUrl = isUsableImageUrl(initialImageUrl) ? initialImageUrl : undefined;
  const rawUrl = fetchedUrl || seededUrl;
  const imageUrl = imageFailed ? undefined : rawUrl;

  useEffect(() => {
    if (imageUrl) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), GENERATE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [imageUrl, matchId, challengeId, retrying]);

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [rawUrl]);

  const handleRetry = async () => {
    if (!matchId && !challengeId) return;
    setRetrying(true);
    setTimedOut(false);
    setImageFailed(false);
    try {
      const res = await fetch("/api/content-assets/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ matchId, challengeId }),
      });
      if (!res.ok) {
        throw new Error("retry failed");
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      setTimedOut(true);
      toast({ title: "Still unavailable", description: "Could not generate the score card. Try again in a moment.", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  const handleShareWithoutCard = async () => {
    const payload = `${shareText}\n\n${shareUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My PackPTS Score", text: shareText, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(payload);
      toast({ title: "Copied!", description: "Share link copied to clipboard" });
    } catch {
      try {
        await navigator.clipboard.writeText(payload);
        toast({ title: "Copied!", description: "Share link copied to clipboard" });
      } catch {
        toast({ title: "Error", description: "Failed to share without card", variant: "destructive" });
      }
    }
  };

  const handleDownload = async () => {
    if (!imageUrl) {
      toast({ title: "Not ready", description: "Score card is still generating, try again in a moment", variant: "destructive" });
      return;
    }
    try {
      const imgRes = await fetch(imageUrl, { credentials: "include" });
      if (!imgRes.ok) throw new Error("download fetch failed");
      const blob = await imgRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      toast({ title: "Downloading!", description: "Score card image saving to your device" });
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n\n${shareUrl}`);
      toast({ title: "Copied!", description: "Share link copied to clipboard" });
    } catch {
      toast({ title: "Error", description: "Failed to copy to clipboard", variant: "destructive" });
    }
  };

  const handleNativeShare = async () => {
    try {
      if (imageUrl) {
        const imgRes = await fetch(imageUrl, { credentials: "include" });
        const blob = await imgRes.blob();
        const file = new File([blob], downloadFilename, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "My PackPTS Score", text: shareText });
          return;
        }
      }
      await navigator.share({ title: "My PackPTS Score", text: shareText, url: shareUrl });
    } catch {
      // User cancelled or share failed silently
    }
  };

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;
  const waitingForImage = !imageUrl && (isLoading || isFetching || retrying || !timedOut);
  const showEmpty = !imageUrl && !waitingForImage;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex justify-center" style={{ backgroundColor: "#0b0f16" }}>
          <div className="relative w-full max-w-sm aspect-square overflow-hidden flex items-center justify-center">
            {waitingForImage && (
              <div className="flex flex-col items-center gap-2 text-white/60 text-sm p-4 text-center">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span>Generating your score card&hellip;</span>
              </div>
            )}
            {showEmpty && (
              <ScoreCardEmptyState
                retrying={retrying}
                onRetry={handleRetry}
                onShareWithoutCard={handleShareWithoutCard}
              />
            )}
            {imageUrl && !imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/60" />
              </div>
            )}
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Your PackPTS score card"
                className={`w-full h-full object-contain transition-opacity duration-300 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageFailed(true)}
              />
            ) : null}
          </div>
        </div>

        {!showEmpty && (
          <div className="p-3 flex flex-col gap-2">
            <Button
              variant="default"
              size="sm"
              className="w-full gap-2"
              onClick={handleDownload}
              disabled={!imageUrl}
              data-testid="button-share-asset-download"
            >
              <Download className="h-4 w-4" />
              Download Image
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-2"
                onClick={handleCopyLink}
                data-testid="button-share-asset-copy"
              >
                <Copy className="h-4 w-4" />
                Copy Link
              </Button>
              {canNativeShare && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={handleNativeShare}
                  data-testid="button-share-asset-native"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
