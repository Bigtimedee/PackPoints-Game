import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, UserPlus, Search, Check, X, Gamepad2, Clock } from "lucide-react";

interface Friend {
  friendshipId: string;
  friendId: string;
  friendUsername: string;
  profileImageUrl: string | null;
  status: string;
}

interface PendingRequest {
  friendshipId: string;
  userId: string;
  username: string;
  profileImageUrl: string | null;
  sentAt: Date;
}

interface FriendsData {
  accepted: Friend[];
  pendingIncoming: PendingRequest[];
  pendingOutgoing: PendingRequest[];
}

interface SearchUser {
  id: string;
  username: string;
  profileImageUrl: string | null;
}

function FriendCard({ 
  friend, 
  onInvite 
}: { 
  friend: Friend; 
  onInvite: (friendId: string) => void;
}) {
  return (
    <Card className="hover-elevate">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            {friend.profileImageUrl && (
              <AvatarImage src={friend.profileImageUrl} alt={friend.friendUsername} />
            )}
            <AvatarFallback>
              {friend.friendUsername.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate" data-testid={`text-friend-name-${friend.friendId}`}>
              {friend.friendUsername}
            </p>
          </div>
          <Button 
            size="sm" 
            onClick={() => onInvite(friend.friendId)}
            data-testid={`button-invite-friend-${friend.friendId}`}
          >
            <Gamepad2 className="h-4 w-4 mr-1" />
            Play
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingRequestCard({ 
  request, 
  type, 
  onAccept, 
  onDecline 
}: { 
  request: PendingRequest; 
  type: "incoming" | "outgoing";
  onAccept?: (friendshipId: string) => void;
  onDecline?: (friendshipId: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            {request.profileImageUrl && (
              <AvatarImage src={request.profileImageUrl} alt={request.username} />
            )}
            <AvatarFallback>
              {request.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{request.username}</p>
            <p className="text-xs text-muted-foreground">
              {type === "incoming" ? "Wants to be friends" : "Request sent"}
            </p>
          </div>
          {type === "incoming" && onAccept && onDecline && (
            <div className="flex gap-2">
              <Button 
                size="icon" 
                variant="ghost"
                onClick={() => onAccept(request.friendshipId)}
                data-testid={`button-accept-request-${request.friendshipId}`}
              >
                <Check className="h-4 w-4 text-green-500" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost"
                onClick={() => onDecline(request.friendshipId)}
                data-testid={`button-decline-request-${request.friendshipId}`}
              >
                <X className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          )}
          {type === "outgoing" && (
            <Badge variant="secondary">
              <Clock className="h-3 w-3 mr-1" />
              Pending
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FriendsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Friends() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const { data: friends, isLoading } = useQuery<FriendsData>({
    queryKey: ["/api/friends"],
  });

  const { data: searchResults, refetch: searchUsers } = useQuery<{ users: SearchUser[] }>({
    queryKey: ["/api/users/search", searchQuery],
    enabled: false,
  });

  const sendRequest = useMutation({
    mutationFn: async (toUserId: string) => {
      return apiRequest("POST", "/api/friends/request", { toUserId });
    },
    onSuccess: () => {
      toast({ title: "Friend request sent!" });
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      setSearchQuery("");
      setIsSearching(false);
    },
    onError: () => {
      toast({ title: "Failed to send friend request", variant: "destructive" });
    },
  });

  const respondToRequest = useMutation({
    mutationFn: async ({ friendshipId, action }: { friendshipId: string; action: "ACCEPT" | "DECLINE" }) => {
      return apiRequest("POST", "/api/friends/respond", { friendshipId, action });
    },
    onSuccess: (_, variables) => {
      toast({ title: variables.action === "ACCEPT" ? "Friend added!" : "Request declined" });
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
    },
    onError: () => {
      toast({ title: "Failed to respond to request", variant: "destructive" });
    },
  });

  const inviteToMatch = useMutation({
    mutationFn: async (toUserId: string) => {
      return apiRequest("POST", "/api/matches/friends/invite", { toUserId });
    },
    onSuccess: () => {
      toast({ title: "Match invite sent!" });
    },
    onError: () => {
      toast({ title: "Failed to send invite", variant: "destructive" });
    },
  });

  const handleSearch = async () => {
    if (searchQuery.length < 3) {
      toast({ title: "Enter at least 3 characters to search", variant: "destructive" });
      return;
    }
    setIsSearching(true);
    await searchUsers();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen pb-20 md:pb-8">
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <h1 className="text-2xl font-bold mb-6">Friends</h1>
          <FriendsSkeleton />
        </div>
      </div>
    );
  }

  const acceptedFriends = friends?.accepted || [];
  const pendingIncoming = friends?.pendingIncoming || [];
  const pendingOutgoing = friends?.pendingOutgoing || [];

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center gap-2 mb-6">
          <Users className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Friends</h1>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserPlus className="h-5 w-5" />
              Add Friend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Search by username (min 3 chars)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                data-testid="input-friend-search"
              />
              <Button onClick={handleSearch} data-testid="button-search-users">
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {isSearching && searchResults?.users && searchResults.users.length > 0 && (
              <div className="mt-4 space-y-2">
                {searchResults.users.map((user) => (
                  <div key={user.id} className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                    <Avatar className="h-8 w-8">
                      {user.profileImageUrl && (
                        <AvatarImage src={user.profileImageUrl} alt={user.username} />
                      )}
                      <AvatarFallback>
                        {user.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 font-medium">{user.username}</span>
                    <Button 
                      size="sm" 
                      onClick={() => sendRequest.mutate(user.id)}
                      disabled={sendRequest.isPending}
                      data-testid={`button-add-friend-${user.id}`}
                    >
                      <UserPlus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {isSearching && searchResults?.users && searchResults.users.length === 0 && (
              <p className="mt-4 text-center text-muted-foreground">No users found</p>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="friends" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="friends" data-testid="tab-friends">
              Friends ({acceptedFriends.length})
            </TabsTrigger>
            <TabsTrigger value="incoming" data-testid="tab-incoming">
              Incoming ({pendingIncoming.length})
            </TabsTrigger>
            <TabsTrigger value="outgoing" data-testid="tab-outgoing">
              Outgoing ({pendingOutgoing.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="space-y-3">
            {acceptedFriends.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No friends yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Search for players to add them as friends
                  </p>
                </CardContent>
              </Card>
            ) : (
              acceptedFriends.map((friend) => (
                <FriendCard
                  key={friend.friendshipId}
                  friend={friend}
                  onInvite={(friendId) => inviteToMatch.mutate(friendId)}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="incoming" className="space-y-3">
            {pendingIncoming.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground">No pending requests</p>
                </CardContent>
              </Card>
            ) : (
              pendingIncoming.map((request) => (
                <PendingRequestCard
                  key={request.friendshipId}
                  request={request}
                  type="incoming"
                  onAccept={(id) => respondToRequest.mutate({ friendshipId: id, action: "ACCEPT" })}
                  onDecline={(id) => respondToRequest.mutate({ friendshipId: id, action: "DECLINE" })}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="outgoing" className="space-y-3">
            {pendingOutgoing.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground">No outgoing requests</p>
                </CardContent>
              </Card>
            ) : (
              pendingOutgoing.map((request) => (
                <PendingRequestCard
                  key={request.friendshipId}
                  request={request}
                  type="outgoing"
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
