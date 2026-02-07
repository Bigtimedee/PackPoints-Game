import { useState, useEffect, useRef } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Users, Copy, Check, Loader2, ArrowLeft, Play, UserPlus, Share2, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAuth } from "@/hooks/use-auth";

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
  
  // Check for code in URL query params (from shared invite link)
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get("code")?.toUpperCase() || "";
  
  const [joinCode, setJoinCode] = useState(codeFromUrl);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState("10");
  const { toast } = useToast();
  const lobbyRef = useRef<LobbyState | null>(null);
  
  // Use authenticated user data instead of localStorage
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const userId = user?.id || "";
  const username = user?.username || "";
  
  const { isConnected, connect, send, on } = useWebSocket({
    onOpen: () => {
      const currentLobby = lobbyRef.current;
      if (currentLobby && currentLobby.membershipSecret) {
        send("join_lobby", { userId, username, lobbyId: currentLobby.id, membershipSecret: currentLobby.membershipSecret });
      }
    },
  });

  useEffect(() => {
    lobbyRef.current = lobby;
  }, [lobby]);

  useEffect(() => {
    const cleanup1 = on("lobby_update", (updatedLobby: LobbyState) => {
      setLobby(prev => ({
        ...updatedLobby,
        membershipSecret: updatedLobby.membershipSecret || prev?.membershipSecret,
      }));
    });
    
    const cleanup2 = on("lobby_closed", () => {
      toast({ title: "Lobby Closed", description: "The host has left the lobby.", variant: "destructive" });
      navigate("/");
    });
    
    const cleanup3 = on("match_started", (matchState: any) => {
      if (lobbyRef.current?.membershipSecret) {
        localStorage.setItem("packpoints_match_secret", lobbyRef.current.membershipSecret);
      }
      navigate(`/match/${matchState.matchId}`);
    });

    const cleanup4 = on("error", (data: any) => {
      const message = typeof data === "string" ? data : data?.message || "Something went wrong";
      toast({ title: "Error", description: message, variant: "destructive" });
    });

    const cleanup5 = on("start_match_error", (data: any) => {
      const message = typeof data === "string" ? data : data?.message || "Failed to start match";
      toast({ title: "Match Error", description: message, variant: "destructive" });
    });
    
    return () => {
      cleanup1();
      cleanup2();
      cleanup3();
      cleanup4();
      cleanup5();
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
        credentials: "include",
        body: JSON.stringify({ totalQuestions: parseInt(selectedQuestions) }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create lobby");
      }
      
      const newLobby = await response.json();
      setLobby(newLobby);
      toast({ title: "Lobby Created!", description: `Share code: ${newLobby.joinCode}` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
        credentials: "include",
        body: JSON.stringify({ joinCode: joinCode.toUpperCase() }),
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

  const shareInvite = async () => {
    if (!lobby) return;
    
    const shareData = {
      title: "PackPTS 1v1 Battle",
      text: `Join my PackPTS game! Use code: ${lobby.joinCode}`,
      url: `${window.location.origin}/lobby/join?code=${lobby.joinCode}`,
    };
    
    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          copyCode();
          toast({ title: "Code Copied", description: "Share link copied to clipboard" });
        }
      }
    } else {
      copyCode();
      toast({ title: "Code Copied", description: "Share not available - code copied to clipboard" });
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

  // Show loading while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen pb-20 md:pb-8 pt-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Require authentication for 1v1 Friend mode
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen pb-20 md:pb-8 pt-8">
        <div className="container mx-auto px-4 max-w-lg">
          <Button variant="ghost" onClick={() => navigate("/")} className="mb-4 gap-2" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
                <LogIn className="h-8 w-8 text-primary" />
              </div>
              <CardTitle>Login Required</CardTitle>
              <CardDescription>
                You need to be logged in to play 1v1 Friend matches
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-center text-muted-foreground text-sm">
                Create an account or log in to challenge your friends and track your wins!
              </p>
              <Button 
                className="w-full gap-2" 
                size="lg" 
                onClick={() => navigate("/auth")}
                data-testid="button-login-to-play"
              >
                <LogIn className="h-5 w-5" />
                Log In to Play
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground mb-2">Join Code</p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-4xl font-mono font-bold tracking-widest" data-testid="text-join-code">
                    {lobby.joinCode}
                  </span>
                  <Button size="icon" variant="outline" onClick={copyCode} data-testid="button-copy-code">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <Button 
                  variant="secondary" 
                  className="gap-2" 
                  onClick={shareInvite}
                  data-testid="button-share-invite"
                >
                  <Share2 className="h-4 w-4" />
                  Share Invite
                </Button>
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
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="card-count">Number of Cards</Label>
                  <Select value={selectedQuestions} onValueChange={setSelectedQuestions}>
                    <SelectTrigger id="card-count" data-testid="select-card-count">
                      <SelectValue placeholder="Select cards" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 Cards</SelectItem>
                      <SelectItem value="10">10 Cards</SelectItem>
                      <SelectItem value="15">15 Cards</SelectItem>
                      <SelectItem value="20">20 Cards</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
