import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users, X } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";

function getOrCreateUserId(): string {
  let id = localStorage.getItem("packpoints_user_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("packpoints_user_id", id);
  }
  return id;
}

function getOrCreateUsername(): string {
  let name = localStorage.getItem("packpoints_username");
  if (!name) {
    const adjectives = ["Swift", "Lucky", "Clever", "Bold", "Quick"];
    const nouns = ["Collector", "Trader", "Scout", "Pro", "Champ"];
    name = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${Math.floor(Math.random() * 1000)}`;
    localStorage.setItem("packpoints_username", name);
  }
  return name;
}

export default function Queue() {
  const [, navigate] = useLocation();
  const [userId] = useState(getOrCreateUserId);
  const [username] = useState(getOrCreateUsername);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [searchTime, setSearchTime] = useState(0);
  const [status, setStatus] = useState<"connecting" | "searching" | "matched">("connecting");

  const handleMessage = useCallback((message: { type: string; payload: any }) => {
    const { type, payload } = message;
    switch (type) {
      case "queue_joined":
        setQueuePosition(payload.position);
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
        navigate("/");
        break;
      case "error":
        console.error("Queue error:", payload);
        break;
    }
  }, [navigate]);

  const { isConnected, connect, send, disconnect } = useWebSocket({ onMessage: handleMessage });

  useEffect(() => {
    if (!isConnected) {
      connect();
    }
  }, [isConnected, connect]);

  useEffect(() => {
    if (isConnected && status === "connecting") {
      send("join_queue", { userId, username });
    }
  }, [isConnected, status, send, userId, username]);

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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl flex items-center justify-center gap-2">
            <Users className="w-6 h-6" />
            1v1 Random Match
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
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
        </CardContent>
      </Card>
    </div>
  );
}
