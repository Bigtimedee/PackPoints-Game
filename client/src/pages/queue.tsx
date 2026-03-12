import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Users, X, ArrowLeft, Play, LogIn, Shuffle, Radio, Gamepad2, UserPlus, Clock, Check, Mail } from "lucide-react";
import { CardSetPicker } from "@/components/CardSetPicker";
import { MobileSelect } from "@/components/MobileSelect";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlayableSet } from "@shared/schema";

interface PresenceStats {
  online: number;
  searching: number;
  inMatch: number;
  queueSize: number;
  queuesByBucket: Record<string, number>;
}

interface Friend {
  friendshipId: string;
  friendId: string;
  friendUsername: string;
  profileImageUrl: string | null;
  status: string;
}

interface FriendsData {
  accepted: Friend[];
  pendingIncoming: any[];
  pendingOutgoing: any[];
}

interface InboxInvite {
  inviteId: string;
  fromUserId: string;
  fromUsername: string;
  fromProfileImageUrl: string | null;
  bucket: string;
  expiresAt: string;
  createdAt: string;
}

interface MatchInbox {
  incoming: InboxInvite[];
  outgoing: any[];
}

export default function Queue() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [searchTime, setSearchTime] = useState(0);
  const [status, setStatus] = useState<"idle" | "connecting" | "searching" | "matched" | "expired">("idle");
  const [selectedCardCount, setSelectedCardCount] = useState("10");
  const [selectedSetId, setSelectedSetId] = useState("random");
  const [activeTab, setActiveTab] = useState<"random" | "friends">("random");
  const { toast } = useToast();

  const { data: playableSets, isLoading: setsLoading } = useQuery<PlayableSet[]>({
    queryKey: ["/api/playable-sets"],
    enabled: isAuthenticated,
  });

  const { data: presenceStats } = useQuery<PresenceStats>({
    queryKey: ["/api/presence/stats"],
    refetchInterval: status === "idle" ? 10000 : 5000,
  });

  const { data: friends, isLoading: friendsLoading } = useQuery<FriendsData>({
    queryKey: ["/api/friends"],
    enabled: isAuthenticated && activeTab === "friends",
  });

  const { data: matchInbox, refetch: refetchInbox } = useQuery<MatchInbox>({
    queryKey: ["/api/matches/friends/inbox"],
    enabled: isAuthenticated && activeTab === "friends",
    refetchInterval: activeTab === "friends" ? 5000 : false,
  });

  const inviteToMatch = useMutation({
    mutationFn: async (toUserId: string) => {
      return apiRequest("POST", "/api/matches/friends/invite", { toUserId });
    },
    onSuccess: () => {
      toast({ title: "Match invite sent!" });
      refetchInbox();
    },
    onError: () => {
      toast({ title: "Failed to send invite", variant: "destructive" });
    },
  });

  const respondToInvite = useMutation({
    mutationFn: async ({ inviteId, action }: { inviteId: string; action: "ACCEPT" | "DECLINE" }) => {
      const response = await apiRequest("POST", "/api/matches/friends/respond", { inviteId, action });
      return response.json();
    },
    onSuccess: (data, variables) => {
      if (variables.action === "ACCEPT" && data.matchId) {
        toast({ title: "Match starting!" });
        localStorage.setItem("packpoints_match_secret", data.membershipSecret || "");
        navigate(`/match/${data.matchId}`);
      } else {
        toast({ title: "Invite declined" });
      }
      refetchInbox();
    },
    onError: () => {
      toast({ title: "Failed to respond", variant: "destructive" });
    },
  });

  const availableSets = playableSets?.filter(s => s.cardsImportedCount > 0) || [];
  const userId = user?.id || "";
  const username = user?.username || user?.firstName || "Player";

  const handleMessage = useCallback((message: { type: string; payload: any }) => {
    const { type, payload } = message;
    switch (type) {
      case "queue_joined":
        setQueuePosition(payload.position);
        setTicketId(payload.ticketId);
        setQueueSize(payload.queueSize);
        setStatus("searching");
        break;
      case "search_status":
        setQueuePosition(payload.yourPosition);
        setQueueSize(payload.playersInQueue);
        break;
      case "matched":
        setStatus("matched");
        localStorage.setItem("packpoints_match_secret", payload.membershipSecret);
        setTimeout(() => {
          navigate(`/match/${payload.matchId}`);
        }, 1500);
        break;
      case "queue_left":
        setTicketId(null);
        navigate("/");
        break;
      case "queue_expired":
        setStatus("expired");
        setTicketId(null);
        break;
      case "error":
        console.error("Queue error:", payload);
        break;
      case "FRIEND_MATCH_INVITE":
        queryClient.invalidateQueries({ queryKey: ["/api/matches/friends/inbox"] });
        toast({ title: `${payload.fromUsername} wants to play!` });
        break;
      case "FRIEND_MATCH_INVITE_CANCELLED":
        queryClient.invalidateQueries({ queryKey: ["/api/matches/friends/inbox"] });
        toast({ title: "Match invite was cancelled" });
        break;
      case "FRIEND_MATCH_INVITE_EXPIRED":
        queryClient.invalidateQueries({ queryKey: ["/api/matches/friends/inbox"] });
        break;
      case "FRIEND_MATCH_ACCEPTED":
        if (payload.matchId && payload.membershipSecret) {
          toast({ title: "Match starting!" });
          localStorage.setItem("packpoints_match_secret", payload.membershipSecret);
          navigate(`/match/${payload.matchId}`);
        }
        break;
    }
  }, [navigate, toast]);

  const { isConnected, connect, send, disconnect } = useWebSocket({ onMessage: handleMessage });

  useEffect(() => {
    if (status === "connecting" && !isConnected) {
      connect();
    }
  }, [isConnected, connect, status]);

  useEffect(() => {
    if (status === "connecting") {
      if (isConnected) {
        // Already connected, send join immediately
        send("join_queue", { 
          userId, 
          username, 
          totalQuestions: parseInt(selectedCardCount),
          gameSetId: selectedSetId === "random" ? null : selectedSetId 
        });
        setStatus("searching");
      }
      // If not connected, the connect() effect will trigger and then this will run again
    }
  }, [isConnected, status, send, userId, username, selectedCardCount, selectedSetId]);

  const handleStartSearch = () => {
    // Reset state for a fresh search
    setQueuePosition(null);
    setQueueSize(0);
    setSearchTime(0);
    setStatus("connecting");
  };

  useEffect(() => {
    if (status === "searching") {
      const interval = setInterval(() => {
        setSearchTime(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status]);

  const handleCancel = () => {
    send("leave_queue", { userId });
    disconnect();
    navigate("/");
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 max-w-md mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-32 rounded-full" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Button variant="ghost" onClick={() => navigate("/")} className="mb-4 gap-2" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">1v1 Random Match</CardTitle>
              <CardDescription>
                Sign in to challenge other players
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-center text-muted-foreground">
                You need to be logged in to play 1v1 matches. Create an account or sign in to compete against other collectors.
              </p>
              <Button 
                className="w-full gap-2" 
                size="lg" 
                onClick={() => navigate("/auth")}
                data-testid="button-login-to-play"
              >
                <LogIn className="h-5 w-5" />
                Sign In to Play
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const acceptedFriends = friends?.accepted || [];
  const incomingInvites = matchInbox?.incoming || [];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {status === "idle" && (
          <Button variant="ghost" onClick={() => navigate("/")} className="mb-4 gap-2" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}

        {status === "idle" && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "random" | "friends")} className="mb-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="random" data-testid="tab-random">
                <Shuffle className="h-4 w-4 mr-2" />
                Random
              </TabsTrigger>
              <TabsTrigger value="friends" data-testid="tab-friends">
                <Users className="h-4 w-4 mr-2" />
                Friends
                {incomingInvites.length > 0 && (
                  <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1">
                    {incomingInvites.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        
        {activeTab === "random" && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
              <Shuffle className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">1v1 Random Match</CardTitle>
            {status === "idle" && (
              <CardDescription>
                Find a random opponent online for a quick match
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {status === "idle" && (
              <div className="space-y-6" data-testid="status-idle">
                {presenceStats && (presenceStats.online > 0 || presenceStats.searching > 0) && (
                  <div className="flex items-center justify-center gap-4 py-2 px-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2" data-testid="presence-online">
                      <Radio className="h-3 w-3 text-green-500 animate-pulse" />
                      <span className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{presenceStats.online}</span> online
                      </span>
                    </div>
                    {presenceStats.searching > 0 && (
                      <div className="flex items-center gap-2" data-testid="presence-searching">
                        <Gamepad2 className="h-3 w-3 text-primary" />
                        <span className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{presenceStats.searching}</span> searching
                        </span>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="card-set">Card Set</Label>
                  <CardSetPicker
                    sets={availableSets}
                    value={selectedSetId}
                    onValueChange={setSelectedSetId}
                    placeholder="Select a card set"
                    id="card-set"
                    data-testid="select-card-set"
                    showRandomOption={true}
                    randomOptionLabel="Let PackPTS Choose"
                    isLoading={setsLoading}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="card-count">Number of Cards</Label>
                  <MobileSelect
                    options={[
                      { value: "5", label: "5 Cards" },
                      { value: "10", label: "10 Cards" },
                      { value: "15", label: "15 Cards" },
                      { value: "20", label: "20 Cards" },
                    ]}
                    value={selectedCardCount}
                    onValueChange={setSelectedCardCount}
                    placeholder="Select cards"
                    id="card-count"
                    data-testid="select-card-count"
                  />
                </div>
                
                <Button 
                  className="w-full gap-2" 
                  size="lg" 
                  onClick={handleStartSearch}
                  data-testid="button-find-match"
                >
                  <Play className="h-5 w-5" />
                  Find Match
                </Button>
              </div>
            )}

            {status === "connecting" && (
              <div className="text-center space-y-4" data-testid="status-connecting">
                <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary" />
                <p className="text-muted-foreground">Connecting to server...</p>
              </div>
            )}

          {status === "searching" && (
            <div className="text-center space-y-6" data-testid="status-searching">
              <div className="relative">
                <div className="w-24 h-24 mx-auto rounded-full border-4 border-primary/20 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-12 h-12 animate-spin text-primary" />
                </div>
              </div>
              
              <div className="space-y-2">
                <p className="text-lg font-semibold">Finding opponent...</p>
                <p className="text-3xl font-mono text-primary">{formatTime(searchTime)}</p>
              </div>

              <div className="bg-muted rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Your position:</span>
                  <span className="font-medium">#{queuePosition}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Players in queue:</span>
                  <span className="font-medium">{queueSize}</span>
                </div>
              </div>

              <Button 
                variant="outline" 
                onClick={handleCancel}
                className="w-full"
                data-testid="button-cancel-queue"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel Search
              </Button>
            </div>
          )}

          {status === "matched" && (
            <div className="text-center space-y-4" data-testid="status-matched">
              <div className="w-24 h-24 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                <Users className="w-12 h-12 text-green-500" />
              </div>
              <p className="text-xl font-semibold text-green-500">Opponent Found!</p>
              <p className="text-muted-foreground">Starting match...</p>
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-green-500" />
            </div>
          )}

          {status === "expired" && (
            <div className="text-center space-y-4" data-testid="status-expired">
              <div className="w-24 h-24 mx-auto rounded-full bg-amber-500/20 flex items-center justify-center">
                <X className="w-12 h-12 text-amber-500" />
              </div>
              <p className="text-xl font-semibold text-amber-600 dark:text-amber-400">Search Expired</p>
              <p className="text-muted-foreground">
                No opponents found after 5 minutes. Try again later when more players are online.
              </p>
              <div className="flex flex-col gap-2">
                <Button 
                  className="w-full gap-2" 
                  onClick={() => {
                    setStatus("idle");
                    setSearchTime(0);
                  }}
                  data-testid="button-search-again"
                >
                  <Play className="h-5 w-5" />
                  Try Again
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => navigate("/")}
                  data-testid="button-go-home"
                >
                  Back to Home
                </Button>
              </div>
            </div>
          )}
          </CardContent>
        </Card>
        )}

        {activeTab === "friends" && status === "idle" && (
          <div className="space-y-4">
            {incomingInvites.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Mail className="h-5 w-5 text-primary" />
                    Match Invites
                    <Badge variant="destructive">{incomingInvites.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {incomingInvites.map((invite) => (
                    <div key={invite.inviteId} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <Avatar className="h-10 w-10">
                        {invite.fromProfileImageUrl && (
                          <AvatarImage src={invite.fromProfileImageUrl} alt={invite.fromUsername} />
                        )}
                        <AvatarFallback>
                          {invite.fromUsername.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{invite.fromUsername}</p>
                        <p className="text-xs text-muted-foreground">wants to play</p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm"
                          onClick={() => respondToInvite.mutate({ inviteId: invite.inviteId, action: "ACCEPT" })}
                          disabled={respondToInvite.isPending}
                          data-testid={`button-accept-invite-${invite.inviteId}`}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Accept
                        </Button>
                        <Button 
                          size="sm"
                          variant="outline"
                          onClick={() => respondToInvite.mutate({ inviteId: invite.inviteId, action: "DECLINE" })}
                          disabled={respondToInvite.isPending}
                          data-testid={`button-decline-invite-${invite.inviteId}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Challenge a Friend
                </CardTitle>
                <CardDescription>
                  Invite a friend to play a 1v1 match
                </CardDescription>
              </CardHeader>
              <CardContent>
                {friendsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : acceptedFriends.length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">No friends yet</p>
                    <Button variant="outline" onClick={() => navigate("/friends")} data-testid="button-add-friends">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Add Friends
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {acceptedFriends.map((friend) => (
                      <div 
                        key={friend.friendshipId} 
                        className="flex items-center gap-3 p-3 rounded-lg hover-elevate"
                      >
                        <Avatar className="h-10 w-10">
                          {friend.profileImageUrl && (
                            <AvatarImage src={friend.profileImageUrl} alt={friend.friendUsername} />
                          )}
                          <AvatarFallback>
                            {friend.friendUsername.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{friend.friendUsername}</p>
                        </div>
                        <Button 
                          size="sm"
                          onClick={() => inviteToMatch.mutate(friend.friendId)}
                          disabled={inviteToMatch.isPending}
                          data-testid={`button-invite-${friend.friendId}`}
                        >
                          <Gamepad2 className="h-4 w-4 mr-1" />
                          Invite
                        </Button>
                      </div>
                    ))}
                    
                    <div className="pt-3 border-t">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={() => navigate("/friends")}
                        data-testid="button-manage-friends"
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Manage Friends
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
