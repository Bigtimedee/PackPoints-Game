import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";

interface AuditEntry {
  id: number;
  adminUserId: string;
  action: string;
  targetUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function AdminAuditLog() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data, isLoading, error } = useQuery<AuditLogResponse>({
    queryKey: ["/api/admin/audit-log", page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });
      const response = await fetch(`/api/admin/audit-log?${params}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch audit log");
      }
      return response.json();
    },
    enabled: isAuthenticated && user?.isAdmin,
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">
            <p>Failed to load audit log.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getActionBadgeVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    if (action.includes("revoke") || action.includes("delete")) return "destructive";
    if (action.includes("grant") || action.includes("adjust")) return "default";
    if (action.includes("toggle")) return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-audit-title">Audit Log</h1>
        <p className="text-muted-foreground">Track all administrative actions</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No audit entries found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target User</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.map((entry) => (
                    <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                      <TableCell className="font-mono text-sm">
                        {format(new Date(entry.createdAt), "MMM dd, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.adminUserId.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(entry.action)}>
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.targetUserId ? `${entry.targetUserId.slice(0, 8)}...` : "-"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {entry.metadata ? JSON.stringify(entry.metadata) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {data.pagination && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} entries)
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
