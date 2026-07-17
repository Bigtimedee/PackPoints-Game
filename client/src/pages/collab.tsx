import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle2, Clock, Loader2, Paintbrush, Share2, ThumbsUp, Upload, Users } from "lucide-react";

interface CollabSession {
  id: string;
  hostUserId: string;
  guestUserId: string | null;
  status: string;
  nominatedCards: NominatedCard[];
  approvedCards: NominatedCard[];
  hostUsername: string | null;
  guestUsername: string | null;
  publishedSetId: string | null;
}

interface NominatedCard {
  id: string;
  nominatedBy: string;
  playerName: string;
  sport: string;
  brand: string;
  year: number;
  cardhedgeCardId: string;
  imageUrl?: string;
}

function SharePanel({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/collab/${sessionId}`;

  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardContent className="py-4 space-y-3">
        <p className="text-sm font-medium">Waiting for your co-creator to join…</p>
        <div className="flex gap-2">
          <Input readOnly value={url} className="text-xs font-mono" />
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Share this link with your co-creator</p>
      </CardContent>
    </Card>
  );
}

function NominateForm({ sessionId, userId, onNominated }: { sessionId: string; userId: string; onNominated: () => void }) {
  const { toast } = useToast();
  const [playerName, setPlayerName] = useState("");
  const [isPending, setIsPending] = useState(false);

  const submit = async () => {
    if (!playerName.trim()) return;
    setIsPending(true);
    try {
      await apiRequest("POST", `/api/collab/${sessionId}/nominate`, {
        card: {
          cardhedgeCardId: `snap2set:manual:${Date.now()}`,
          playerName: playerName.trim(),
          sport: "baseball",
          brand: "Custom",
          year: new Date().getFullYear(),
        },
      });
      setPlayerName("");
      onNominated();
    } catch {
      toast({ title: "Failed to nominate card", variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          Nominate a Card
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Player name (e.g. Babe Ruth)"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
          />
          <Button size="sm" onClick={submit} disabled={isPending || !playerName.trim()}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Your co-creator must approve the card to include it</p>
      </CardContent>
    </Card>
  );
}

function CardList({ cards, currentUserId, sessionId, onApprove }: {
  cards: NominatedCard[];
  currentUserId: string;
  sessionId: string;
  onApprove: () => void;
}) {
  const { toast } = useToast();
  const [approving, setApproving] = useState<string | null>(null);

  const approve = async (nominationId: string) => {
    setApproving(nominationId);
    try {
      await apiRequest("POST", `/api/collab/${sessionId}/approve`, { nominationId });
      onApprove();
    } catch {
      toast({ title: "Failed to approve card", variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  if (cards.length === 0) return (
    <p className="text-sm text-muted-foreground text-center py-6">No cards nominated yet</p>
  );

  return (
    <div className="space-y-2">
      {cards.map(card => {
        const isMyCard = card.nominatedBy === currentUserId;
        return (
          <div key={card.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border bg-card">
            <div>
              <p className="font-medium text-sm">{card.playerName}</p>
              <p className="text-xs text-muted-foreground">{card.year} · {card.brand}</p>
            </div>
            <div className="flex items-center gap-2">
              {isMyCard ? (
                <Badge variant="outline" className="text-xs">Mine</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approve(card.id)}
                  disabled={approving === card.id}
                >
                  {approving === card.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <><ThumbsUp className="h-3 w-3 mr-1" />Approve</>
                  }
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PublishForm({ sessionId, approvedCount, onPublished }: {
  sessionId: string;
  approvedCount: number;
  onPublished: (setId: string) => void;
}) {
  const { toast } = useToast();
  const [setName, setSetName] = useState("");
  const [makerNote, setMakerNote] = useState("");
  const [isPending, setIsPending] = useState(false);

  const publish = async () => {
    if (!setName.trim()) return;
    setIsPending(true);
    try {
      const res = await apiRequest("POST", `/api/collab/${sessionId}/publish`, {
        setName: setName.trim(),
        makerNote: makerNote.trim() || undefined,
      });
      const data = await res.json();
      onPublished(data.setId);
    } catch {
      toast({ title: "Failed to publish", variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  const canPublish = approvedCount >= 5;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Publish Your Set</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canPublish && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {approvedCount}/5 cards approved — need {5 - approvedCount} more to publish
          </p>
        )}
        <Input
          placeholder="Set name (e.g. Our Rookie Picks)"
          value={setName}
          onChange={e => setSetName(e.target.value.slice(0, 60))}
          maxLength={60}
        />
        <Textarea
          placeholder="Add a note for players… (optional)"
          value={makerNote}
          onChange={e => setMakerNote(e.target.value.slice(0, 140))}
          maxLength={140}
          rows={2}
          className="resize-none"
        />
        <Button className="w-full" onClick={publish} disabled={isPending || !canPublish || !setName.trim()}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paintbrush className="mr-2 h-4 w-4" />}
          Publish Set ({approvedCount} cards)
        </Button>
      </CardContent>
    </Card>
  );
}

export default function CollabPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { send, on, connect } = useWebSocket({ autoReconnect: true });

  const { data: session, isLoading, error, refetch } = useQuery<CollabSession>({
    queryKey: [`/api/collab/${id}`],
    enabled: !!id && !!user,
    refetchInterval: false,
  });

  const joinMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/collab/${id}/join`, {}),
    onSuccess: () => refetch(),
    onError: () => toast({ title: "Couldn't join session", variant: "destructive" }),
  });

  // Connect WS and join collab room
  useEffect(() => {
    if (!user || !id) return;
    connect();
  }, [user, id, connect]);

  useEffect(() => {
    if (!id) return;
    send("collab:join", { collabId: id });
  }, [id, send]);

  // Realtime events
  useEffect(() => {
    const refresh = () => refetch();
    on("collab:guest_joined", refresh);
    on("collab:card_nominated", refresh);
    on("collab:card_approved", refresh);
    on("collab:published", (payload: { setId: string }) => {
      navigate(`/sets/${payload.setId}`);
    });
  }, [on, refetch, navigate]);

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-sm w-full">
        <CardContent className="py-8 text-center space-y-3">
          <Users className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="font-medium">Sign in to join this collab session</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </CardContent>
      </Card>
    </div>
  );

  if (isLoading) return (
    <div className="min-h-screen p-4">
      <div className="max-w-lg mx-auto pt-8 space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );

  if (error || !session) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        <p className="text-lg font-semibold">Session not found</p>
        <Button variant="outline" onClick={() => navigate("/")}>Go home</Button>
      </div>
    </div>
  );

  const myId = (user as any)?.id;
  const isHost = session.hostUserId === myId;
  const isGuest = session.guestUserId === myId;
  const isMember = isHost || isGuest;
  const isWaiting = session.status === "waiting";
  const isActive = session.status === "active";
  const isPublished = session.status === "published";

  const nominatedByOther = (session.nominatedCards || []).filter(c => c.nominatedBy !== myId);

  if (isPublished && session.publishedSetId) {
    navigate(`/sets/${session.publishedSetId}`);
    return null;
  }

  return (
    <div className="min-h-screen pb-16 p-4">
      <div className="max-w-lg mx-auto pt-6 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Paintbrush className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Co-Create a Set</h1>
          </div>
          {session.hostUsername && (
            <p className="text-sm text-muted-foreground">
              {session.hostUsername}
              {session.guestUsername ? ` & ${session.guestUsername}` : " (waiting for co-creator)"}
            </p>
          )}
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          {isWaiting && <Badge variant="outline" className="flex items-center gap-1"><Clock className="h-3 w-3" />Waiting</Badge>}
          {isActive && <Badge className="flex items-center gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />Active</Badge>}
          <Badge variant="secondary">{(session.approvedCards || []).length} approved cards</Badge>
        </div>

        {/* Host: share link while waiting */}
        {isHost && isWaiting && <SharePanel sessionId={id!} />}

        {/* Not a member: join prompt */}
        {!isMember && isWaiting && (
          <Card>
            <CardContent className="py-6 text-center space-y-3">
              <p className="font-medium">You've been invited to co-create a set</p>
              <p className="text-sm text-muted-foreground">
                {session.hostUsername} started this session. Join to collaborate!
              </p>
              <Button onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending}>
                {joinMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Join Session
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Not waiting — session taken */}
        {!isMember && !isWaiting && (
          <Card>
            <CardContent className="py-6 text-center">
              <p className="text-muted-foreground">This session is no longer accepting new members.</p>
            </CardContent>
          </Card>
        )}

        {/* Active: nomination + approval UI */}
        {isMember && isActive && (
          <>
            <NominateForm sessionId={id!} userId={myId} onNominated={() => refetch()} />

            {/* Cards waiting for my approval */}
            {nominatedByOther.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-primary">Needs your approval ({nominatedByOther.length})</p>
                <CardList
                  cards={nominatedByOther}
                  currentUserId={myId}
                  sessionId={id!}
                  onApprove={() => refetch()}
                />
              </div>
            )}

            {/* All nominated cards */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">All nominations ({(session.nominatedCards || []).length})</p>
              <CardList
                cards={session.nominatedCards || []}
                currentUserId={myId}
                sessionId={id!}
                onApprove={() => refetch()}
              />
            </div>

            {/* Approved cards */}
            {(session.approvedCards || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Approved ({(session.approvedCards || []).length})
                </p>
                <div className="space-y-1">
                  {(session.approvedCards || []).map(card => (
                    <div key={card.id} className="flex items-center justify-between px-4 py-2 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/20">
                      <p className="text-sm font-medium">{card.playerName}</p>
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300">{card.year}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Publish (host only) */}
            {isHost && (
              <PublishForm
                sessionId={id!}
                approvedCount={(session.approvedCards || []).length}
                onPublished={(setId) => navigate(`/sets/${setId}`)}
              />
            )}

            {!isHost && (
              <Card className="border-dashed">
                <CardContent className="py-4 text-center text-sm text-muted-foreground">
                  {session.hostUsername} will publish the set once enough cards are approved
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
