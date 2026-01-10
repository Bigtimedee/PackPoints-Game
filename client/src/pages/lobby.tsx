import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Copy, Check, Loader2, ArrowLeft, Play, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";

function generateUserId(): string {
  const stored = localStorage.getItem("packpoints_user_id");
  if (stored) return stored;
  
  const id = crypto.randomUUID();
  localStorage.setItem("packpoints_user_id", id);
  return id;
}

function getUsername(): string {
  const stored = localStorage.getItem("packpoints_username");
  if (stored) return stored;
  
  const adjectives = ["Swift", "Bold", "Lucky", "Sharp", "Quick", "Wise"];
  const nouns = ["Collector", "Hunter", "Expert", "Master", "Ace", "Pro"];
  const name = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${Math.floor(Math.random() * 99)}`;
  localStorage.setItem("packpoints_username", name);
  return name;
}

interface LobbyState {
  id: string;
  joinCode: string;
  hostId: string;
  hostUsername: string;
  guestId: string | null;
  guestUsername: string | null;
  status: string;
  totalQuestions: number;
  membershipSecret?: string;
}

export default function Lobby() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/lobby/:action");
  const action = params?.action;
  
  const [joinCode, setJoinCode] = useState("");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  
  const userId = generateUserId();
  const username = getUsername();
  
  const { isConnected, connect, send, on } = useWebSocket({
    onOpen: () => {
      if (lobby) {
        send("join_lobby", { userId, username, lobbyId: lobby.id });
      }
    },
  });

  useEffect(() => {
    const cleanup1 = on("lobby_update", (updatedLobby: LobbyState) => {
      setLobby(updatedLobby);
    });
    
    const cleanup2 = on("lobby_closed", () => {
      toast({ title: "Lobby Closed", description: "The host has left the lobby.", variant: "destructive" });
      navigate("/");
    });
    
    const cleanup3 = on("match_started", (matchState: any) => {
      navigate(`/match/${matchState.matchId}`);
    });
    
    return () => {
      cleanup1();
      cleanup2();
      cleanup3();
    };
  }, [on, toast, navigate]);

  useEffect(() => {
    if (lobby && !isConnected) {
      connect();
    }
  }, [lobby, isConnected, connect]);

  useEffect(() => {
    if (lobby && isConnected && lobby.membershipSecret) {
      send("join_lobby", { userId, username, lobbyId: lobby.id, membershipSecret: lobby.membershipSecret });
    }
  }, [lobby, isConnected, send, userId, username]);

  const createLobby = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/lobby/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: userId, hostUsername: username, totalQuestions: 10 }),
      });
      
      if (!response.ok) throw new Error("Failed to create lobby");
      
      const newLobby = await response.json();
      setLobby(newLobby);
      toast({ title: "Lobby Created!", description: `Share code: ${newLobby.joinCode}` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to create lobby", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const joinLobby = async () => {
    if (joinCode.length !== 6) {
      toast({ title: "Invalid Code", description: "Enter a 6-character code", variant: "destructive" });
      return;
    }
    
    setIsLoading(true);
    try {
      const response = await fetch("/api/lobby/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: joinCode.toUpperCase(), guestId: userId, guestUsername: username }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to join lobby");
      }
      
      const joinedLobby = await response.json();
      setLobby(joinedLobby);
      toast({ title: "Joined!", description: `Joined ${joinedLobby.hostUsername}'s lobby` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const copyCode = () => {
    if (lobby) {
      navigator.clipboard.writeText(lobby.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startMatch = () => {
    if (lobby && isConnected) {
      send("start_match", { lobbyId: lobby.id, hostId: userId });
    }
  };

  const leaveLobby = () => {
    if (lobby && isConnected) {
      send("leave_lobby", { lobbyId: lobby.id, userId });
    }
    setLobby(null);
    navigate("/");
  };

  const isHost = lobby?.hostId === userId;
  const canStart = lobby?.guestId && lobby?.guestUsername && isHost;

  if (lobby) {
    return (
      <div className="min-h-screen pb-20 md:pb-8 pt-8">
        <div className="container mx-auto px-4 max-w-lg">
          <Button variant="ghost" onClick={leaveLobby} className="mb-4 gap-2" data-testid="button-leave-lobby">
            <ArrowLeft className="h-4 w-4" />
            Leave Lobby
          </Button>
          
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <CardTitle>Waiting Room</CardTitle>
              <CardDescription>
                Share the code with a friend to start the match
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Join Code</p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-4xl font-mono font-bold tracking-widest" data-testid="text-join-code">
                    {lobby.joinCode}
                  </span>
                  <Button size="icon" variant="outline" onClick={copyCode} data-testid="button-copy-code">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Players ({lobby.guestId ? 2 : 1}/2)</p>
                
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-sm font-medium">{lobby.hostUsername?.charAt(0)}</span>
                    </div>
                    <span className="font-medium" data-testid="text-host-username">{lobby.hostUsername}</span>
                  </div>
                  <Badge>Host</Badge>
                </div>
                
                {lobby.guestId ? (
                  <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-secondary/20 flex items-center justify-center">
                        <span className="text-sm font-medium">{lobby.guestUsername?.charAt(0)}</span>
                      </div>
                      <span className="font-medium" data-testid="text-guest-username">{lobby.guestUsername}</span>
                    </div>
                    <Badge variant="secondary">Guest</Badge>
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-3 rounded-md border-2 border-dashed border-muted-foreground/20">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Waiting for opponent...</span>
                    </div>
                  </div>
                )}
              </div>
              
              {isHost && (
                <Button 
                  className="w-full gap-2" 
                  size="lg" 
                  onClick={startMatch} 
                  disabled={!canStart}
                  data-testid="button-start-match"
                >
                  <Play className="h-5 w-5" />
                  {canStart ? "Start Match" : "Waiting for Player..."}
                </Button>
              )}
              
              {!isHost && (
                <div className="text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  <p>Waiting for host to start...</p>
                </div>
              )}
              
              <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 text-sm">
                <span className="text-muted-foreground">Questions</span>
                <span className="font-medium">{lobby.totalQuestions}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-8 pt-8">
      <div className="container mx-auto px-4 max-w-lg">
        <Button variant="ghost" onClick={() => navigate("/")} className="mb-4 gap-2" data-testid="button-back-home">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold" data-testid="text-lobby-title">1v1 Battle</h1>
            <p className="text-muted-foreground">Challenge a friend to see who knows their cards best</p>
          </div>
          
          {action === "create" || !action ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Create a Lobby
                </CardTitle>
                <CardDescription>
                  Create a lobby and share the code with your friend
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  className="w-full gap-2" 
                  size="lg" 
                  onClick={createLobby}
                  disabled={isLoading}
                  data-testid="button-create-lobby"
                >
                  {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-5 w-5" />}
                  Create Lobby
                </Button>
              </CardContent>
            </Card>
          ) : null}
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Join a Lobby
              </CardTitle>
              <CardDescription>
                Enter the 6-character code from your friend
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Enter code (e.g., ABC123)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                className="text-center text-xl font-mono tracking-widest uppercase"
                maxLength={6}
                data-testid="input-join-code"
              />
              <Button 
                className="w-full gap-2" 
                size="lg" 
                onClick={joinLobby}
                disabled={isLoading || joinCode.length !== 6}
                data-testid="button-join-lobby"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                Join Lobby
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
