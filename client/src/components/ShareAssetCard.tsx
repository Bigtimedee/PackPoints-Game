import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy, Share2, ImageIcon, Loader2 } from "lucide-react";

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
  downloadFilename?: string;
  shareUrl?: string;
  shareText?: string;
}

async function fetchLatestAsset(matchId?: string, challengeId?: string): Promise<ContentAsset | null> {
  const param = matchId ? `matchId=${matchId}` : `challengeId=${challengeId}`;
  const res = await fetch(`/api/content-assets/latest?${param}`);
  if (!res.ok) return null;
  const data = await res.json();
  const asset = data.assets?.find((a: ContentAsset) => a.metadata?.imageUrl);
  return asset ?? null;
}

export function ShareAssetCard({
  matchId,
  challengeId,
  downloadFilename = "packpts-score.png",
  shareUrl = "https://packpts.com",
  shareText = "I just played PackPTS! Check it out at packpts.com",
}: ShareAssetCardProps) {
  const { toast } = useToast();
  const [imageLoaded, setImageLoaded] = useState(false);

  // Poll every 3 seconds for up to 30 seconds while the image is being generated
  const { data: asset, isLoading } = useQuery({
    queryKey: ["content-asset", matchId, challengeId],
    queryFn: () => fetchLatestAsset(matchId, challengeId),
    refetchInterval: (query) => {
      if (query.state.data?.metadata?.imageUrl) return false;
      return 3000;
    },
    retry: false,
    enabled: !!(matchId || challengeId),
  });

  const imageUrl = asset?.metadata?.imageUrl;

  const handleDownload = () => {
    if (!imageUrl) {
      toast({ title: "Not ready", description: "Score card is still generating, try again in a moment", variant: "destructive" });
      return;
    }
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = downloadFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Downloading!", description: "Score card image saving to your device" });
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
      if (imageUrl && navigator.canShare?.({ files: [] })) {
        const imgRes = await fetch(imageUrl);
        const blob = await imgRes.blob();
        const file = new File([blob], downloadFilename, { type: "image/png" });
        await navigator.share({ files: [file], title: "My PackPTS Score", text: shareText });
      } else {
        await navigator.share({ title: "My PackPTS Score", text: shareText, url: shareUrl });
      }
    } catch {
      // User cancelled or share failed silently
    }
  };

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Image preview */}
        <div className="relative bg-muted aspect-[9/16] max-h-72 overflow-hidden flex items-center justify-center">
          {isLoading && !imageUrl && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm p-4 text-center">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Generating your score card&hellip;</span>
            </div>
          )}
          {!isLoading && !imageUrl && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm p-4 text-center">
              <ImageIcon className="h-6 w-6" />
              <span>Score card unavailable</span>
            </div>
          )}
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Your PackPTS score card"
              className={`w-full h-full object-contain transition-opacity duration-300 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImageLoaded(true)}
            />
          )}
        </div>

        {/* Action buttons */}
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
      </CardContent>
    </Card>
  );
}
