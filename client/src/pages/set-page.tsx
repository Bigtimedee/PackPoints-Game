import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Paintbrush, Play, Users, Hash, Loader2 } from "lucide-react";

interface SetDetail {
  id: string;
  setName: string;
  sport: string;
  brand: string;
  year: number;
  makerNote: string | null;
  isUserCreated: boolean;
  createdByUserId: string | null;
  makerUsername: string | null;
  cardCount: number;
  playCount: number;
}

export default function SetPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: set, isLoading, error } = useQuery<SetDetail>({
    queryKey: [`/api/sets/${id}`],
    enabled: !!id,
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/game/start", {
        mode: "solo",
        totalQuestions: 10,
        setId: id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/game/solo`);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start game", description: err.message, variant: "destructive" });
    },
  });

  const isOwner = user && set?.createdByUserId === (user as any)?.id;

  if (isLoading) {
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-lg mx-auto pt-8 space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (error || !set) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Set not found</p>
          <Button variant="outline" onClick={() => setLocation("/")}>Go home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-16">
      <div className="max-w-lg mx-auto pt-6 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold leading-tight">{set.setName}</h1>
            {set.isUserCreated && (
              <Badge variant="secondary" className="shrink-0 flex items-center gap-1 mt-0.5">
                <Paintbrush className="h-3 w-3" />
                Fan Made
              </Badge>
            )}
          </div>
          {set.makerUsername && (
            <p className="text-sm text-muted-foreground">by {set.makerUsername}</p>
          )}
        </div>

        {/* Maker note */}
        {set.makerNote && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="py-4 px-5">
              <p className="text-sm italic text-foreground/80">"{set.makerNote}"</p>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="py-4 flex items-center gap-3">
              <Hash className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xl font-bold">{Number(set.cardCount)}</p>
                <p className="text-xs text-muted-foreground">Cards</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xl font-bold">{Number(set.playCount)}</p>
                <p className="text-xs text-muted-foreground">Times Played</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Set info */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{set.year}</Badge>
          <Badge variant="outline">{set.brand}</Badge>
          <Badge variant="outline" className="capitalize">{set.sport}</Badge>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            className="w-full"
            size="lg"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending || Number(set.cardCount) === 0}
          >
            {startMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Play This Set
          </Button>
          {Number(set.cardCount) === 0 && (
            <p className="text-xs text-center text-muted-foreground">
              This set has no playable cards yet.
            </p>
          )}
          {isOwner && (
            <Button variant="outline" className="w-full" onClick={() => setLocation("/make")}>
              <Paintbrush className="mr-2 h-4 w-4" />
              Make Another Set
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
