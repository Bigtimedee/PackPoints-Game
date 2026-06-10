import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ChevronLeft, ChevronRight, User, Loader2, Mail, Shield, Calendar } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

interface UserData {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  status: string;
  isAdmin: boolean;
  authProvider: string;
  createdAt: string | null;
  points: number;
  gamesPlayed: number;
  correctAnswers: number;
  totalAnswers: number;
  accuracy: number;
}

interface UsersResponse {
  users: UserData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface UserDetails extends UserData {
  avgPointsPerGame: number;
}

export default function AdminUsers() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ["/api/admin/users", searchQuery, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        search: searchQuery,
        page: page.toString(),
        limit: "15",
      });
      const response = await fetch(`/api/admin/users?${params}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }
      return response.json();
    },
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: userDetails, isLoading: detailsLoading } = useQuery<UserDetails>({
    queryKey: ["/api/admin/users", selectedUser],
    queryFn: async () => {
      if (!selectedUser) return null;
      const response = await fetch(`/api/admin/users/${selectedUser}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch user details");
      }
      return response.json();
    },
    enabled: !!selectedUser && isAuthenticated && user?.isAdmin,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(search);
    setPage(1);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-users-title">User Management</h1>
        <p className="text-muted-foreground">View and manage platform users</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle>All Users</CardTitle>
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-[200px]"
                  data-testid="input-search-users"
                />
              </div>
              <Button type="submit" size="sm" data-testid="button-search">
                Search
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              Failed to load users.
            </div>
          ) : data ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="text-right">Games</TableHead>
                      <TableHead className="text-right">Accuracy</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.users.map((u) => (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell>
                          <div className="font-medium">{u.username}</div>
                          {u.displayName && <div className="text-xs text-muted-foreground">{u.displayName}</div>}
                          {u.isAdmin && <Badge variant="default" className="text-xs mt-0.5">Admin</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="font-mono text-xs">{u.email || <span className="text-muted-foreground italic">—</span>}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            u.status === "ACTIVE" ? "default" :
                            u.status === "BANNED" ? "destructive" :
                            "secondary"
                          } className="text-xs">
                            {u.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{u.points.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{u.gamesPlayed}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={u.accuracy >= 80 ? "default" : u.accuracy >= 60 ? "secondary" : "outline"}>
                            {u.accuracy}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedUser(u.id)}
                            data-testid={`button-view-user-${u.id}`}
                          >
                            <User className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {((page - 1) * 15) + 1} to {Math.min(page * 15, data.pagination.total)} of {data.pagination.total} users
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="flex items-center px-3 text-sm">
                      Page {page} of {data.pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))}
                      disabled={page === data.pagination.totalPages}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          {detailsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : userDetails ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold">{userDetails.username}</h3>
                    {userDetails.isAdmin && <Badge variant="default" className="text-xs">Admin</Badge>}
                    <Badge variant={
                      userDetails.status === "ACTIVE" ? "default" :
                      userDetails.status === "BANNED" ? "destructive" :
                      "secondary"
                    } className="text-xs">{userDetails.status}</Badge>
                  </div>
                  {userDetails.displayName && <p className="text-sm text-muted-foreground">{userDetails.displayName}</p>}
                </div>
              </div>

              <div className="space-y-2 text-sm border rounded-md p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono">{userDetails.email || <span className="text-muted-foreground italic">No email on file</span>}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="capitalize">{userDetails.authProvider} auth</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span>{userDetails.createdAt ? format(new Date(userDetails.createdAt), "MMM d, yyyy") : "Unknown join date"}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Points</p>
                    <p className="text-2xl font-bold font-mono">{userDetails.points.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Games Played</p>
                    <p className="text-2xl font-bold font-mono">{userDetails.gamesPlayed}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Accuracy</p>
                    <p className="text-2xl font-bold font-mono">{userDetails.accuracy}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Avg Points/Game</p>
                    <p className="text-2xl font-bold font-mono">{userDetails.avgPointsPerGame}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>Correct Answers: {userDetails.correctAnswers} / {userDetails.totalAnswers}</p>
              </div>
              
              <div className="pt-4 border-t">
                <Button 
                  className="w-full"
                  onClick={() => {
                    setSelectedUser(null);
                    navigate(`/admin/users/${userDetails.id}`);
                  }}
                  data-testid="button-manage-user"
                >
                  Manage Wallet & Entitlements
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
