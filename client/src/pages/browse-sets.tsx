import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Paintbrush, Users, Hash, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

interface BrowseSet {
  id: string;
  setName: string;
  sport: string;
  brand: string;
  year: number;
  makerNote: string | null;
  makerUsername: string | null;
  cardCount: number;
  playCount: number;
  createdAt: string;
}

function SetCard({ set }: { set: BrowseSet }) {
  return (
    <Link href={`/sets/${set.id}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{set.setName}</p>
              {set.makerUsername && (
                <p className="text-xs text-muted-foreground">by {set.makerUsername}</p>
              )}
            </div>
            <Badge variant="outline" className="shrink-0 text-xs capitalize">{set.sport}</Badge>
          </div>

          {set.makerNote && (
            <p className="text-xs text-muted-foreground italic line-clamp-2">"{set.makerNote}"</p>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />{set.cardCount} cards
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />{set.playCount} plays
            </span>
            <span className="ml-auto">{set.year} · {set.brand}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SetCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-3 w-full" />
        <div className="flex gap-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function BrowseSets() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ sets: BrowseSet[] }>({
    queryKey: ["/api/sets"],
    queryFn: async () => {
      const res = await fetch("/api/sets?limit=50");
      return res.json();
    },
    staleTime: 60_000,
  });

  const sets = data?.sets ?? [];

  const filtered = search.trim()
    ? sets.filter(s =>
        s.setName.toLowerCase().includes(search.toLowerCase()) ||
        s.makerUsername?.toLowerCase().includes(search.toLowerCase()) ||
        s.makerNote?.toLowerCase().includes(search.toLowerCase())
      )
    : sets;

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-6 space-y-1">
          <div className="flex items-center gap-2">
            <Paintbrush className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Community Sets</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Sets built by players — upload your cards and build one too
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sets or makers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => <SetCardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <Paintbrush className="h-12 w-12 text-muted-foreground/40" />
            {search ? (
              <>
                <p className="font-medium text-muted-foreground">No sets match "{search}"</p>
                <p className="text-sm text-muted-foreground">Try a different search</p>
              </>
            ) : (
              <>
                <p className="font-medium text-muted-foreground">No community sets yet</p>
                <p className="text-sm text-muted-foreground">Be the first to build one</p>
                <Link href="/make">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <Paintbrush className="h-4 w-4" /> Make a Set
                  </span>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-4">{filtered.length} set{filtered.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filtered.map(set => <SetCard key={set.id} set={set} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
