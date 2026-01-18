import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Loader2, 
  Plus, 
  Edit, 
  RefreshCw,
  Download,
  Search,
  Layers,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface GameSet {
  id: string;
  sport: string;
  brand: string;
  year: number;
  setName: string;
  league: string | null;
  isActive: boolean;
  cardhedgeSetQuery: string | null;
  cardhedgeCategory: string | null;
  cardsImportedCount: number;
  lastImportAt: string | null;
  marketplaceKeywords: string[];
  createdAt: string;
}

interface ImportRun {
  id: string;
  gameSetId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  pageSize: number;
  pagesFetched: number;
  cardsImported: number;
  error: string | null;
}

interface CardHedgeSearchResult {
  cards: Array<{
    card_id: string;
    description: string;
    player: string;
    set: string;
    number: string;
    image: string;
  }>;
  page: number;
  pages: number;
  total: number;
}

interface SetFormData {
  sport: string;
  brand: string;
  year: number;
  setName: string;
  cardhedgeSetQuery: string;
  cardhedgeCategory: string;
  isActive: boolean;
}

interface SetLookupResult {
  setName: string;
  cardCount: number;
  category: string;
}

const defaultFormData: SetFormData = {
  sport: "baseball",
  brand: "",
  year: new Date().getFullYear(),
  setName: "",
  cardhedgeSetQuery: "",
  cardhedgeCategory: "Baseball",
  isActive: true,
};

const sports = ["baseball", "basketball", "football", "hockey"];
const categories = ["Baseball", "Basketball", "Football", "Hockey"];

export default function AdminPlayableSets() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [showSetLookupDialog, setShowSetLookupDialog] = useState(false);
  const [editingSet, setEditingSet] = useState<GameSet | null>(null);
  const [formData, setFormData] = useState<SetFormData>(defaultFormData);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState("Baseball");
  const [selectedSetForImport, setSelectedSetForImport] = useState<GameSet | null>(null);
  const [setLookupQuery, setSetLookupQuery] = useState("");
  const [setLookupResults, setSetLookupResults] = useState<SetLookupResult[]>([]);

  const { data: gameSets, isLoading } = useQuery<GameSet[]>({
    queryKey: ["/api/admin/game-sets"],
    queryFn: async () => {
      const res = await fetch("/api/admin/game-sets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch game sets");
      return res.json();
    },
  });

  const searchMutation = useMutation({
    mutationFn: async ({ search, category }: { search: string; category: string }) => {
      const res = await apiRequest("POST", "/api/admin/cardhedge/search", {
        search,
        category,
        page_size: 20,
      });
      return res.json() as Promise<CardHedgeSearchResult>;
    },
    onError: (error: Error) => {
      toast({ title: "Search failed", description: error.message, variant: "destructive" });
    },
  });

  const setLookupMutation = useMutation({
    mutationFn: async ({ search, category }: { search: string; category: string }) => {
      const res = await apiRequest("POST", "/api/admin/cardhedge/search", {
        search,
        category,
        page_size: 100,
      });
      return res.json() as Promise<CardHedgeSearchResult>;
    },
    onSuccess: (data) => {
      const setMap = new Map<string, { count: number; category: string }>();
      data.cards?.forEach((card) => {
        if (card.set) {
          const existing = setMap.get(card.set);
          setMap.set(card.set, {
            count: (existing?.count || 0) + 1,
            category: searchCategory,
          });
        }
      });
      const results: SetLookupResult[] = Array.from(setMap.entries()).map(([setName, info]) => ({
        setName,
        cardCount: info.count,
        category: info.category,
      }));
      results.sort((a, b) => b.cardCount - a.cardCount);
      setSetLookupResults(results);
    },
    onError: (error: Error) => {
      toast({ title: "Lookup failed", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SetFormData) => {
      return apiRequest("POST", "/api/admin/playable-sets", data);
    },
    onSuccess: () => {
      toast({ title: "Set created", description: "The playable set has been created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/game-sets"] });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create set", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SetFormData> }) => {
      return apiRequest("PUT", `/api/admin/playable-sets/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Set updated", description: "The playable set has been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/game-sets"] });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update set", variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (setId: string) => {
      const res = await apiRequest("POST", `/api/admin/playable-sets/${setId}/import`, {
        page_size: 100,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Import completed", 
        description: `Imported ${data.cardsImported} cards from ${data.pagesFetched} pages` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/game-sets"] });
      setSelectedSetForImport(null);
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
      setSelectedSetForImport(null);
    },
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingSet(null);
    setFormData(defaultFormData);
  };

  const openCreateDialog = () => {
    setFormData(defaultFormData);
    setEditingSet(null);
    setShowDialog(true);
  };

  const openEditDialog = (set: GameSet) => {
    setEditingSet(set);
    setFormData({
      sport: set.sport,
      brand: set.brand,
      year: set.year,
      setName: set.setName,
      cardhedgeSetQuery: set.cardhedgeSetQuery || "",
      cardhedgeCategory: set.cardhedgeCategory || "Baseball",
      isActive: set.isActive,
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (editingSet) {
      updateMutation.mutate({ id: editingSet.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleImport = (set: GameSet) => {
    if (!set.cardhedgeSetQuery) {
      toast({ 
        title: "Cannot import", 
        description: "This set has no Card Hedge query configured", 
        variant: "destructive" 
      });
      return;
    }
    setSelectedSetForImport(set);
    importMutation.mutate(set.id);
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    searchMutation.mutate({ search: searchQuery, category: searchCategory });
  };

  const openSetLookupDialog = () => {
    setSetLookupQuery(`${formData.year} ${formData.brand}`.trim() || `${formData.sport}`);
    setSetLookupResults([]);
    setShowSetLookupDialog(true);
  };

  const handleSetLookup = () => {
    if (!setLookupQuery.trim()) return;
    setLookupMutation.mutate({ search: setLookupQuery, category: formData.cardhedgeCategory });
  };

  const selectSetFromLookup = (setName: string) => {
    setFormData({ ...formData, cardhedgeSetQuery: setName });
    setShowSetLookupDialog(false);
    toast({ title: "Set selected", description: `"${setName}" has been applied` });
  };

  const getStatusBadge = (set: GameSet) => {
    if (set.cardsImportedCount > 0) {
      return <Badge variant="default" className="bg-green-600">{set.cardsImportedCount} cards</Badge>;
    }
    return <Badge variant="secondary">No cards</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Playable Sets</h1>
          <p className="text-muted-foreground">Manage card sets for gameplay from Card Hedge</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => setShowSearchDialog(true)}
            data-testid="button-search-cardhedge"
          >
            <Search className="h-4 w-4 mr-2" />
            Search Card Hedge
          </Button>
          <Button onClick={openCreateDialog} data-testid="button-create-set">
            <Plus className="h-4 w-4 mr-2" />
            Create Set
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Game Sets
          </CardTitle>
          <CardDescription>
            Configure sets with Card Hedge queries and import cards for gameplay
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Set</TableHead>
                <TableHead>Sport</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Card Hedge Query</TableHead>
                <TableHead>Cards</TableHead>
                <TableHead>Last Import</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gameSets?.map((set) => (
                <TableRow key={set.id} data-testid={`row-set-${set.id}`}>
                  <TableCell className="font-medium">
                    {set.brand} {set.setName}
                  </TableCell>
                  <TableCell className="capitalize">{set.sport}</TableCell>
                  <TableCell>{set.year}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {set.cardhedgeSetQuery || <span className="text-yellow-600">Not configured</span>}
                  </TableCell>
                  <TableCell>{getStatusBadge(set)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {set.lastImportAt 
                      ? format(new Date(set.lastImportAt), "MMM d, yyyy h:mm a")
                      : "Never"
                    }
                  </TableCell>
                  <TableCell>
                    {set.isActive 
                      ? <Badge variant="outline" className="text-green-600 border-green-600">Active</Badge>
                      : <Badge variant="outline" className="text-gray-500">Inactive</Badge>
                    }
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => openEditDialog(set)}
                        data-testid={`button-edit-${set.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleImport(set)}
                        disabled={importMutation.isPending && selectedSetForImport?.id === set.id}
                        data-testid={`button-import-${set.id}`}
                      >
                        {importMutation.isPending && selectedSetForImport?.id === set.id 
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Download className="h-4 w-4" />
                        }
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!gameSets || gameSets.length === 0) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No game sets configured. Create one to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSet ? "Edit Set" : "Create Set"}</DialogTitle>
            <DialogDescription>
              {editingSet 
                ? "Update the playable set configuration"
                : "Create a new playable set for Card Hedge import"
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sport">Sport</Label>
                <Select 
                  value={formData.sport} 
                  onValueChange={(v) => setFormData({ ...formData, sport: v })}
                >
                  <SelectTrigger data-testid="select-sport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sports.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input 
                  id="year"
                  type="number" 
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || 0 })}
                  data-testid="input-year"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand">Brand</Label>
              <Input 
                id="brand"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                placeholder="Topps, Upper Deck, Panini..."
                data-testid="input-brand"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="setName">Set Name</Label>
              <Input 
                id="setName"
                value={formData.setName}
                onChange={(e) => setFormData({ ...formData, setName: e.target.value })}
                placeholder="1987 Topps Baseball"
                data-testid="input-set-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cardhedgeSetQuery">Card Hedge Set Query</Label>
              <div className="flex gap-2">
                <Input 
                  id="cardhedgeSetQuery"
                  value={formData.cardhedgeSetQuery}
                  onChange={(e) => setFormData({ ...formData, cardhedgeSetQuery: e.target.value })}
                  placeholder="Exact set name for Card Hedge API"
                  data-testid="input-cardhedge-query"
                  className="flex-1"
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={openSetLookupDialog}
                  data-testid="button-lookup-set"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Click the search button to find and select the exact set name
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cardhedgeCategory">Card Hedge Category</Label>
              <Select 
                value={formData.cardhedgeCategory} 
                onValueChange={(v) => setFormData({ ...formData, cardhedgeCategory: v })}
              >
                <SelectTrigger data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch 
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-is-active"
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button 
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-set"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingSet ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSearchDialog} onOpenChange={setShowSearchDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Search Card Hedge</DialogTitle>
            <DialogDescription>
              Find cards and set names from the Card Hedge API
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input 
                  placeholder="Search for cards, players, or sets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  data-testid="input-search-query"
                />
              </div>
              <Select value={searchCategory} onValueChange={setSearchCategory}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={handleSearch}
                disabled={searchMutation.isPending}
                data-testid="button-search"
              >
                {searchMutation.isPending 
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Search className="h-4 w-4" />
                }
              </Button>
            </div>

            {searchMutation.data && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Found {searchMutation.data.total || searchMutation.data.cards?.length || 0} results
                </p>
                <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
                  {searchMutation.data.cards?.map((card, i) => (
                    <div key={card.card_id || i} className="p-3 flex gap-3">
                      {card.image && (
                        <img 
                          src={card.image.startsWith("//") ? `https:${card.image}` : card.image}
                          alt={card.description}
                          className="w-16 h-20 object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{card.description}</p>
                        <p className="text-sm text-muted-foreground">{card.player}</p>
                        <p className="text-xs text-muted-foreground">Set: {card.set}</p>
                        <p className="text-xs text-muted-foreground">#{card.number}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSetLookupDialog} onOpenChange={setShowSetLookupDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Find Card Hedge Set Name</DialogTitle>
            <DialogDescription>
              Search for sets to find the exact name for the Card Hedge API
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input 
                placeholder="Search by year, brand, or set name..."
                value={setLookupQuery}
                onChange={(e) => setSetLookupQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetLookup()}
                data-testid="input-set-lookup-query"
                className="flex-1 min-w-[200px]"
              />
              <Button 
                onClick={handleSetLookup}
                disabled={setLookupMutation.isPending}
                data-testid="button-set-lookup-search"
              >
                {setLookupMutation.isPending 
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Search className="h-4 w-4" />
                }
              </Button>
            </div>

            {setLookupResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Found {setLookupResults.length} set name{setLookupResults.length !== 1 ? "s" : ""}. Click to select:
                </p>
                <div className="border rounded-md p-2 space-y-1 max-h-[300px] overflow-y-auto">
                  {setLookupResults.map((result, i) => (
                    <Button
                      key={`${result.setName}-${i}`}
                      type="button"
                      variant="ghost"
                      className="w-full justify-between gap-2"
                      onClick={() => selectSetFromLookup(result.setName)}
                      data-testid={`button-select-set-${i}`}
                    >
                      <span className="font-medium truncate">{result.setName}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {result.cardCount} card{result.cardCount !== 1 ? "s" : ""}
                      </Badge>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {setLookupMutation.isSuccess && setLookupResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No sets found. Try a different search term.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowSetLookupDialog(false)}
              data-testid="button-cancel-lookup"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
