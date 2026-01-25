import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, X, ArrowLeft, Play, LogIn, Shuffle, Radio, Gamepad2 } from "lucide-react";
import { CardSetPicker } from "@/components/CardSetPicker";
import { MobileSelect } from "@/components/MobileSelect";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAuth } from "@/hooks/use-auth";
import type { PlayableSet } from "@shared/schema";

interface PresenceStats {
  online: number;
  searching: number;
  inMatch: number;
  queueSize: number;
  queuesByBucket: Record<string, number>;
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

  const { data: playableSets, isLoading: setsLoading } = useQuery<PlayableSet[]>({
    queryKey: ["/api/playable-sets"],
    enabled: isAuthenticated,
  });

  const { data: presenceStats } = useQuery<PresenceStats>({
    queryKey: ["/api/presence/stats"],
    refetchInterval: status === "idle" ? 10000 : 5000,
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
    }
  }, [navigate]);

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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
                onClick={() => navigate("/login")}
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {status === "idle" && (
          <Button variant="ghost" onClick={() => navigate("/")} className="mb-4 gap-2" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
              <Users className="h-8 w-8 text-primary" />
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
      </div>
    </div>
  );
}
