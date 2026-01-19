import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Flag, Check, X, AlertTriangle, Loader2, Image, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PlayableCard {
  id: string;
  cardNumber: string;
  player: string;
  imageUrl: string | null;
  setId: number;
  reportCount: number;
  imageReviewStatus: string;
  blockedReason: string | null;
  isPlayable: boolean;
}

interface CardReport {
  id: string;
  cardId: string;
  reporterId: string | null;
  sessionId: string | null;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
}

interface ReportsResponse {
  reports: Array<{ report: CardReport; card: PlayableCard | null }>;
  total: number;
  limit: number;
  offset: number;
}

interface FlaggedCardsResponse {
  cards: PlayableCard[];
}

const REASON_LABELS: Record<string, string> = {
  wrong_sport: "Wrong Sport",
  wrong_player: "Wrong Player",
  wrong_set: "Wrong Set",
  bad_image: "Bad/Unclear Image",
  other: "Other Issue",
};

export default function AdminCardReports() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState("flagged");
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<PlayableCard | null>(null);
  const [resolution, setResolution] = useState("");

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const { data: flaggedCards, isLoading: flaggedLoading, refetch: refetchFlagged } = useQuery<FlaggedCardsResponse>({
    queryKey: ["/api/admin/card-reports/flagged"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: pendingReports, isLoading: reportsLoading, refetch: refetchReports } = useQuery<ReportsResponse>({
    queryKey: ["/api/admin/card-reports?status=pending"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: resolvedReports, isLoading: resolvedLoading, refetch: refetchResolved } = useQuery<ReportsResponse>({
    queryKey: ["/api/admin/card-reports?status=resolved"],
    enabled: isAuthenticated && user?.isAdmin && activeTab === "resolved",
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ cardId, action, resolution }: { cardId: string; action: "approve" | "reject"; resolution?: string }) => {
      return apiRequest("POST", `/api/admin/cards/${cardId}/review`, { action, resolution });
    },
    onSuccess: () => {
      refetchFlagged();
      refetchReports();
      refetchResolved();
      setReviewDialogOpen(false);
      setSelectedCard(null);
      setResolution("");
    },
  });

  const handleReview = (card: PlayableCard) => {
    setSelectedCard(card);
    setReviewDialogOpen(true);
  };

  const handleApprove = () => {
    if (selectedCard) {
      reviewMutation.mutate({ cardId: selectedCard.id, action: "approve", resolution });
    }
  };

  const handleReject = () => {
    if (selectedCard) {
      reviewMutation.mutate({ cardId: selectedCard.id, action: "reject", resolution: resolution || "Image mismatch confirmed" });
    }
  };

  const refreshAll = () => {
    refetchFlagged();
    refetchReports();
    refetchResolved();
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const flaggedCount = flaggedCards?.cards?.length || 0;
  const pendingCount = pendingReports?.total || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-card-reports-title">Card Image Reports</h1>
          <p className="text-muted-foreground">Review and moderate flagged card images</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-stat-flagged">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Flag className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Flagged Cards</span>
            </div>
            <p className="text-2xl font-bold font-mono">{flaggedCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-pending">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Pending Reports</span>
            </div>
            <p className="text-2xl font-bold font-mono">{pendingCount}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-reports">
          <TabsTrigger value="flagged" data-testid="tab-flagged">
            Flagged Cards ({flaggedCount})
          </TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending Reports ({pendingCount})
          </TabsTrigger>
          <TabsTrigger value="resolved" data-testid="tab-resolved">
            Resolved
          </TabsTrigger>
        </TabsList>

        <TabsContent value="flagged" className="mt-4">
          {flaggedLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : flaggedCards?.cards?.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <p>No flagged cards to review</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {flaggedCards?.cards?.map((card) => (
                <Card key={card.id} className="overflow-hidden" data-testid={`card-flagged-${card.id}`}>
                  <div className="relative aspect-[3/4] bg-muted">
                    {card.imageUrl ? (
                      <img
                        src={card.imageUrl}
                        alt={card.player}
                        className="w-full h-full object-contain"
                        data-testid={`img-card-${card.id}`}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <Image className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    <Badge 
                      variant="destructive" 
                      className="absolute top-2 right-2"
                      data-testid={`badge-reports-${card.id}`}
                    >
                      {card.reportCount} reports
                    </Badge>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold truncate" data-testid={`text-player-${card.id}`}>
                      {card.player || "Unknown Player"}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {card.cardNumber}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {card.imageReviewStatus}
                      </Badge>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="flex-1"
                        onClick={() => handleReview(card)}
                        data-testid={`button-review-${card.id}`}
                      >
                        Review
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          {reportsLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : pendingReports?.reports?.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <p>No pending reports</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingReports?.reports?.map(({ report, card }) => (
                <Card key={report.id} data-testid={`card-report-${report.id}`}>
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      <div className="w-24 h-32 bg-muted rounded overflow-hidden flex-shrink-0">
                        {card?.imageUrl ? (
                          <img
                            src={card.imageUrl}
                            alt={card.player}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <Image className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{card?.player || "Unknown"}</h3>
                          <Badge variant="secondary">
                            {REASON_LABELS[report.reason] || report.reason}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Card: {card?.cardNumber || report.cardId}
                        </p>
                        {report.description && (
                          <p className="text-sm mt-2 p-2 bg-muted rounded">
                            "{report.description}"
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          Reported {new Date(report.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {card && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleReview(card)}
                            data-testid={`button-review-report-${report.id}`}
                          >
                            Review Card
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resolved" className="mt-4">
          {resolvedLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : resolvedReports?.reports?.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>No resolved reports yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {resolvedReports?.reports?.map(({ report, card }) => (
                <Card key={report.id} className="opacity-75" data-testid={`card-resolved-${report.id}`}>
                  <CardContent className="p-4">
                    <div className="flex gap-4 items-center">
                      <div className="w-16 h-20 bg-muted rounded overflow-hidden flex-shrink-0">
                        {card?.imageUrl ? (
                          <img
                            src={card.imageUrl}
                            alt={card.player}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <Image className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{card?.player || "Unknown"}</h3>
                        <p className="text-sm text-muted-foreground">
                          {REASON_LABELS[report.reason] || report.reason}
                        </p>
                      </div>
                      <Badge variant={card?.imageReviewStatus === "approved" ? "default" : "destructive"}>
                        {card?.imageReviewStatus || "resolved"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Card Image</DialogTitle>
            <DialogDescription>
              Decide whether this card image is correct or should be removed from gameplay.
            </DialogDescription>
          </DialogHeader>
          {selectedCard && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-48 h-64 bg-muted rounded overflow-hidden flex-shrink-0">
                  {selectedCard.imageUrl ? (
                    <img
                      src={selectedCard.imageUrl}
                      alt={selectedCard.player}
                      className="w-full h-full object-contain"
                      data-testid="img-review-card"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Image className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold" data-testid="text-review-player">
                    {selectedCard.player || "Unknown Player"}
                  </h3>
                  <p className="text-sm text-muted-foreground">{selectedCard.cardNumber}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="destructive">
                      {selectedCard.reportCount} reports
                    </Badge>
                    <Badge variant="outline">
                      {selectedCard.imageReviewStatus}
                    </Badge>
                  </div>
                  {selectedCard.blockedReason && (
                    <p className="text-sm mt-2 p-2 bg-muted rounded">
                      Current reason: {selectedCard.blockedReason}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resolution">Resolution Notes (optional)</Label>
                <Textarea
                  id="resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="Add notes about your decision..."
                  data-testid="input-resolution"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setReviewDialogOpen(false)}
              data-testid="button-cancel-review"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleApprove}
              disabled={reviewMutation.isPending}
              data-testid="button-approve"
            >
              {reviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Approve (Keep)
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={reviewMutation.isPending}
              data-testid="button-reject"
            >
              {reviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              Reject (Remove)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
