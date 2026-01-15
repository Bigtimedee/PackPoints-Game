import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Ticket, Copy, CheckCircle2, Users, Share2, Loader2 } from "lucide-react";

interface FoundersPass {
  id: number;
  status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "DEACTIVATED";
  createdAt: string;
  expiresAt: string | null;
  consumedAt: string | null;
  shareUrl?: string;
}

export function FoundersPassCard() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: passData, isLoading } = useQuery<{ pass: FoundersPass | null; shareUrl?: string }>({
    queryKey: ["/api/founders-pass/mine"],
    retry: false,
  });

  const handleCopyLink = async () => {
    if (passData?.shareUrl) {
      try {
        await navigator.clipboard.writeText(passData.shareUrl);
        setCopied(true);
        toast({
          title: "Link Copied!",
          description: "Share this link with a friend to give them instant access.",
        });
        setTimeout(() => setCopied(false), 3000);
      } catch (err) {
        toast({
          title: "Copy Failed",
          description: "Please select and copy the link manually.",
          variant: "destructive",
        });
      }
    }
  };

  const handleShare = async () => {
    if (passData?.shareUrl && navigator.share) {
      try {
        await navigator.share({
          title: "Join PackPoints as a Founder!",
          text: "Use my Founders Pass to skip the waitlist and become one of the first 500 PackPoints Founders!",
          url: passData.shareUrl,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          handleCopyLink();
        }
      }
    } else {
      handleCopyLink();
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!passData?.pass) {
    return null;
  }

  const pass = passData.pass;
  const isActive = pass.status === "ACTIVE";
  const isConsumed = pass.status === "CONSUMED";
  const isDeactivated = pass.status === "DEACTIVATED";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ticket className="w-5 h-5" />
            Your Founders Pass
          </CardTitle>
          <Badge 
            variant={isActive ? "default" : "secondary"}
            className={isActive ? "bg-green-500 text-white" : ""}
          >
            {pass.status}
          </Badge>
        </div>
        <CardDescription>
          {isActive && "Share this one-time pass with a friend to grant them instant access."}
          {isConsumed && "Your pass has been used. Thanks for spreading the word!"}
          {isDeactivated && "All 500 Founder spots are filled. Passes are no longer active."}
          {pass.status === "EXPIRED" && "This pass has expired and can no longer be used."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isActive && passData.shareUrl && (
          <>
            <div className="flex gap-2">
              <Input
                value={passData.shareUrl}
                readOnly
                className="font-mono text-sm"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                data-testid="input-founders-pass-url"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyLink}
                data-testid="button-copy-pass-link"
              >
                {copied ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
            <Button 
              className="w-full" 
              onClick={handleShare}
              data-testid="button-share-pass"
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share Your Pass
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              This pass can only be used once. When your friend signs up, they become a Founder and get their own pass to share.
            </p>
          </>
        )}

        {isConsumed && (
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Pass Used</p>
            <p className="text-xs text-muted-foreground">
              Someone joined PackPoints using your pass on{" "}
              {pass.consumedAt && new Date(pass.consumedAt).toLocaleDateString()}
            </p>
          </div>
        )}

        {isDeactivated && (
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm font-medium">500 Founders Reached!</p>
            <p className="text-xs text-muted-foreground">
              Congratulations on being an early Founder. All passes have been deactivated as we've reached capacity.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
