import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Plus, ArrowLeft, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SetOfWeekEntry {
  id: string;
  setId: string;
  multiplier: number;
  startsAt: string;
  endsAt: string;
  createdAt: string | null;
  setName: string;
  brand: string;
  year: number;
}

interface GameSet {
  id: string;
  setName: string;
  brand: string;
  year: number;
  isActive: boolean;
}

export default function AdminSetOfWeek() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState({
    setId: "",
    multiplier: "1.5",
    startsAt: "",
    endsAt: "",
  });

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !(user as any)?.isAdmin)) {
      navigate("/admin/login");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const { data: entriesData, isLoading: entriesLoading } = useQuery<{ entries: SetOfWeekEntry[] }>({
    queryKey: ["/api/admin/set-of-week"],
    enabled: isAuthenticated && !!(user as any)?.isAdmin,
  });

  const { data: setsData, isLoading: setsLoading } = useQuery<{ sets: GameSet[] }>({
    queryKey: ["/api/admin/card-sets"],
    enabled: isAuthenticated && !!(user as any)?.isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async (body: typeof form) => {
      return apiRequest("POST", "/api/admin/set-of-week", {
        setId: body.setId,
        multiplier: Number(body.multiplier),
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/set-of-week"] });
      setForm({ setId: "", multiplier: "1.5", startsAt: "", endsAt: "" });
      toast({ title: "Set of the Week created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create", description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/set-of-week/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/set-of-week"] });
      toast({ title: "Entry deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err?.message, variant: "destructive" });
    },
  });

  const entries = entriesData?.entries ?? [];
  const sets = setsData?.sets ?? [];

  const now = new Date();

  function getStatus(entry: SetOfWeekEntry): "active" | "upcoming" | "past" {
    const start = new Date(entry.startsAt);
    const end = new Date(entry.endsAt);
    if (now >= start && now <= end) return "active";
    if (now < start) return "upcoming";
    return "past";
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.setId || !form.startsAt || !form.endsAt) {
      toast({ title: "All fields required", variant: "destructive" });
      return;
    }
    createMutation.mutate(form);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Star className="h-6 w-6 text-yellow-500" />
          <h1 className="text-2xl font-bold">Set of the Week</h1>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create New Entry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="setId">Game Set</Label>
                {setsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <select
                    id="setId"
                    value={form.setId}
                    onChange={(e) => setForm((f) => ({ ...f, setId: e.target.value }))}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  >
                    <option value="">Select a set…</option>
                    {sets.map((s: GameSet) => (
                      <option key={s.id} value={s.id}>
                        {s.year} {s.brand} — {s.setName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="multiplier">Multiplier</Label>
                <Input
                  id="multiplier"
                  type="number"
                  step="0.1"
                  min="1"
                  max="10"
                  value={form.multiplier}
                  onChange={(e) => setForm((f) => ({ ...f, multiplier: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="startsAt">Starts At</Label>
                <Input
                  id="startsAt"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="endsAt">Ends At</Label>
                <Input
                  id="endsAt"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create Entry
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set</TableHead>
                  <TableHead>Multiplier</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const status = getStatus(entry);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {entry.year} {entry.brand} — {entry.setName}
                      </TableCell>
                      <TableCell>{entry.multiplier}x</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(entry.startsAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(entry.endsAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            status === "active"
                              ? "default"
                              : status === "upcoming"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(entry.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
