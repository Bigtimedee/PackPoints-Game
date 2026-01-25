import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, 
  Plus, 
  Edit, 
  RefreshCw,
  Download,
  Layers,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Trash2,
  Play,
  Activity,
  FileText
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type Sport = "Baseball" | "Basketball" | "Football" | "Hockey";

interface CardSet {
  id: string;
  sport: Sport;
  year: number;
  brand: string | null;
  setName: string;
  keywords: string[];
  expectedCardCount: number | null;
  isActive: boolean;
  createdAt: string;
  linkedCardCount: number;
  latestJob: {
    id: string;
    status: string;
    cardsLinked: number;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
}

interface ImportJob {
  id: string;
  setId: string;
  provider: string;
  status: string;
  totalPages: number;
  pagesFetched: number;
  cardsFound: number;
  cardsInserted: number;
  cardsLinked: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface JobLog {
  id: string;
  level: string;
  message: string;
  meta: unknown;
  createdAt: string;
}

interface CatalogCard {
  id: string;
  player: string | null;
  description: string | null;
  cardNumber: string | null;
  variant: string | null;
  imageUrl: string | null;
  setName: string | null;
}

interface SetFormData {
  sport: Sport;
  year: number;
  brand: string;
  setName: string;
  keywords: string;
  expectedCardCount: string;
}

const defaultFormData: SetFormData = {
  sport: "Baseball",
  year: new Date().getFullYear(),
  brand: "",
  setName: "",
  keywords: "",
  expectedCardCount: "",
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "SUCCEEDED":
      return <Badge variant="default" data-testid="badge-status-succeeded"><CheckCircle className="w-3 h-3 mr-1" /> Success</Badge>;
    case "RUNNING":
      return <Badge variant="secondary" data-testid="badge-status-running"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running</Badge>;
    case "PARTIAL":
      return <Badge variant="outline" data-testid="badge-status-partial"><AlertCircle className="w-3 h-3 mr-1" /> Partial</Badge>;
    case "FAILED":
      return <Badge variant="destructive" data-testid="badge-status-failed"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    case "PENDING":
      return <Badge variant="secondary" data-testid="badge-status-pending"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-status-unknown">{status}</Badge>;
  }
}

export default function AdminCardSets() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedSet, setSelectedSet] = useState<CardSet | null>(null);
  const [formData, setFormData] = useState<SetFormData>(defaultFormData);
  const [activeTab, setActiveTab] = useState("progress");

  const { data: setsData, isLoading: setsLoading, refetch: refetchSets } = useQuery<{ sets: CardSet[] }>({
    queryKey: ["/api/admin/card-sets"],
  });

  const { data: jobData, refetch: refetchJob } = useQuery<{ job: ImportJob; logs: JobLog[] }>({
    queryKey: ["/api/admin/set-import-jobs", selectedSet?.latestJob?.id],
    enabled: !!selectedSet?.latestJob?.id && showDetailsDialog,
    refetchInterval: selectedSet?.latestJob?.status === "RUNNING" ? 2000 : false,
  });

  const { data: cardsData, isLoading: cardsLoading } = useQuery<{ cards: CatalogCard[]; pagination: { totalCount: number } }>({
    queryKey: ["/api/admin/card-sets", selectedSet?.id, "cards"],
    enabled: !!selectedSet?.id && showDetailsDialog && activeTab === "cards",
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<CardSet>) => {
      return apiRequest("POST", "/api/admin/card-sets", data);
    },
    onSuccess: () => {
      toast({ title: "Card set created successfully" });
      setShowCreateDialog(false);
      setFormData(defaultFormData);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/card-sets"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create card set", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CardSet> }) => {
      return apiRequest("PUT", `/api/admin/card-sets/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Card set updated successfully" });
      setShowEditDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/card-sets"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update card set", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/card-sets/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Card set deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/card-sets"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete card set", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/admin/card-sets/${id}/import`);
    },
    onSuccess: () => {
      toast({ title: "Import started" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/card-sets"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start import", description: error.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    const keywords = formData.keywords.split(",").map(k => k.trim()).filter(Boolean);
    createMutation.mutate({
      sport: formData.sport,
      year: formData.year,
      brand: formData.brand || undefined,
      setName: formData.setName,
      keywords,
      expectedCardCount: formData.expectedCardCount ? parseInt(formData.expectedCardCount) : undefined,
    } as Partial<CardSet>);
  };

  const handleUpdate = () => {
    if (!selectedSet) return;
    const keywords = formData.keywords.split(",").map(k => k.trim()).filter(Boolean);
    updateMutation.mutate({
      id: selectedSet.id,
      data: {
        sport: formData.sport,
        year: formData.year,
        brand: formData.brand || null,
        setName: formData.setName,
        keywords,
        expectedCardCount: formData.expectedCardCount ? parseInt(formData.expectedCardCount) : null,
      } as Partial<CardSet>,
    });
  };

  const openEditDialog = (set: CardSet) => {
    setSelectedSet(set);
    setFormData({
      sport: set.sport,
      year: set.year,
      brand: set.brand || "",
      setName: set.setName,
      keywords: set.keywords.join(", "),
      expectedCardCount: set.expectedCardCount?.toString() || "",
    });
    setShowEditDialog(true);
  };

  const openDetailsDialog = (set: CardSet) => {
    setSelectedSet(set);
    setActiveTab("progress");
    setShowDetailsDialog(true);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Card Set Importer</h1>
          <p className="text-muted-foreground">Import and manage card sets from CardHedge</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => refetchSets()}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-set">
            <Plus className="w-4 h-4 mr-2" />
            New Set
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Card Sets
          </CardTitle>
          <CardDescription>
            Define sets and import cards from CardHedge using keywords and set names
          </CardDescription>
        </CardHeader>
        <CardContent>
          {setsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set Name</TableHead>
                  <TableHead>Sport</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Cards</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {setsData?.sets?.map((set) => (
                  <TableRow key={set.id} data-testid={`row-set-${set.id}`}>
                    <TableCell className="font-medium">{set.setName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{set.sport}</Badge>
                    </TableCell>
                    <TableCell>{set.year}</TableCell>
                    <TableCell>{set.brand || "—"}</TableCell>
                    <TableCell>
                      <span className="font-mono">{set.linkedCardCount}</span>
                      {set.expectedCardCount && (
                        <span className="text-muted-foreground">/{set.expectedCardCount}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {set.latestJob ? (
                        <StatusBadge status={set.latestJob.status} />
                      ) : (
                        <Badge variant="secondary" data-testid={`badge-not-imported-${set.id}`}>Not imported</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openDetailsDialog(set)}
                          data-testid={`button-view-${set.id}`}
                        >
                          <Activity className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => importMutation.mutate(set.id)}
                          disabled={importMutation.isPending || set.latestJob?.status === "RUNNING"}
                          data-testid={`button-import-${set.id}`}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditDialog(set)}
                          data-testid={`button-edit-${set.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(set.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${set.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!setsData?.sets || setsData.sets.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No card sets defined. Click "New Set" to create one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Card Set</DialogTitle>
            <DialogDescription>
              Define a card set to import from CardHedge
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sport</Label>
                <Select 
                  value={formData.sport} 
                  onValueChange={(value: Sport) => setFormData({ ...formData, sport: value })}
                >
                  <SelectTrigger data-testid="select-sport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Baseball">Baseball</SelectItem>
                    <SelectItem value="Basketball">Basketball</SelectItem>
                    <SelectItem value="Football">Football</SelectItem>
                    <SelectItem value="Hockey">Hockey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Year</Label>
                <Input
                  type="number"
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || new Date().getFullYear() })}
                  data-testid="input-year"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Brand</Label>
              <Input
                placeholder="e.g., Topps, Panini, Upper Deck"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                data-testid="input-brand"
              />
            </div>
            <div className="space-y-2">
              <Label>Set Name</Label>
              <Input
                placeholder="e.g., Chrome, Prizm, Series 1"
                value={formData.setName}
                onChange={(e) => setFormData({ ...formData, setName: e.target.value })}
                data-testid="input-set-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Keywords (comma separated)</Label>
              <Textarea
                placeholder="e.g., rookie, base set, chrome"
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                data-testid="input-keywords"
              />
            </div>
            <div className="space-y-2">
              <Label>Expected Card Count (optional)</Label>
              <Input
                type="number"
                placeholder="e.g., 500"
                value={formData.expectedCardCount}
                onChange={(e) => setFormData({ ...formData, expectedCardCount: e.target.value })}
                data-testid="input-expected-count"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-create-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={createMutation.isPending || !formData.setName}
              data-testid="button-create-submit"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Set
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Card Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sport</Label>
                <Select 
                  value={formData.sport} 
                  onValueChange={(value: Sport) => setFormData({ ...formData, sport: value })}
                >
                  <SelectTrigger data-testid="select-edit-sport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Baseball">Baseball</SelectItem>
                    <SelectItem value="Basketball">Basketball</SelectItem>
                    <SelectItem value="Football">Football</SelectItem>
                    <SelectItem value="Hockey">Hockey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Year</Label>
                <Input
                  type="number"
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || new Date().getFullYear() })}
                  data-testid="input-edit-year"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Brand</Label>
              <Input
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                data-testid="input-edit-brand"
              />
            </div>
            <div className="space-y-2">
              <Label>Set Name</Label>
              <Input
                value={formData.setName}
                onChange={(e) => setFormData({ ...formData, setName: e.target.value })}
                data-testid="input-edit-set-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Keywords (comma separated)</Label>
              <Textarea
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                data-testid="input-edit-keywords"
              />
            </div>
            <div className="space-y-2">
              <Label>Expected Card Count (optional)</Label>
              <Input
                type="number"
                value={formData.expectedCardCount}
                onChange={(e) => setFormData({ ...formData, expectedCardCount: e.target.value })}
                data-testid="input-edit-expected-count"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="button-edit-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleUpdate} 
              disabled={updateMutation.isPending}
              data-testid="button-update-submit"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update Set
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedSet?.setName}</DialogTitle>
            <DialogDescription>
              {selectedSet?.year} {selectedSet?.brand} - {selectedSet?.sport}
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="progress" data-testid="tab-progress">Import Progress</TabsTrigger>
              <TabsTrigger value="logs" data-testid="tab-logs">Logs</TabsTrigger>
              <TabsTrigger value="cards" data-testid="tab-cards">Cards ({selectedSet?.linkedCardCount})</TabsTrigger>
            </TabsList>
            
            <TabsContent value="progress" className="space-y-4">
              {jobData?.job ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <StatusBadge status={jobData.job.status} />
                    <span className="text-sm text-muted-foreground">
                      Started: {jobData.job.startedAt ? format(new Date(jobData.job.startedAt), "PPp") : "—"}
                    </span>
                    {jobData.job.finishedAt && (
                      <span className="text-sm text-muted-foreground">
                        Finished: {format(new Date(jobData.job.finishedAt), "PPp")}
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">{jobData.job.pagesFetched}</div>
                        <div className="text-xs text-muted-foreground">Pages Fetched</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">{jobData.job.cardsFound}</div>
                        <div className="text-xs text-muted-foreground">Cards Found</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">{jobData.job.cardsInserted}</div>
                        <div className="text-xs text-muted-foreground">New Cards</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">{jobData.job.cardsLinked}</div>
                        <div className="text-xs text-muted-foreground">Cards Linked</div>
                      </CardContent>
                    </Card>
                  </div>

                  {jobData.job.lastError && (
                    <Card className="border-destructive">
                      <CardContent className="pt-4">
                        <p className="text-sm text-destructive">{jobData.job.lastError}</p>
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex gap-2">
                    <Button 
                      onClick={() => {
                        importMutation.mutate(selectedSet!.id);
                        refetchJob();
                      }}
                      disabled={importMutation.isPending || jobData.job.status === "RUNNING"}
                      data-testid="button-reimport"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {jobData.job.status === "RUNNING" ? "Running..." : "Re-import"}
                    </Button>
                    <Button variant="outline" onClick={() => refetchJob()} data-testid="button-refresh-job">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No import has been run yet.</p>
                  <Button 
                    className="mt-4"
                    onClick={() => importMutation.mutate(selectedSet!.id)}
                    disabled={importMutation.isPending}
                    data-testid="button-start-import"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Start Import
                  </Button>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="logs">
              <div className="max-h-96 overflow-y-auto space-y-2">
                {jobData?.logs?.map((log) => (
                  <div 
                    key={log.id}
                    data-testid={`log-entry-${log.id}`}
                    className={`p-2 rounded text-sm font-mono ${
                      log.level === "ERROR" ? "bg-destructive/20 text-destructive" :
                      log.level === "WARN" ? "bg-accent/50" :
                      "bg-muted"
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {format(new Date(log.createdAt), "HH:mm:ss")}
                    </span>
                    {" "}
                    <Badge variant="outline" className="text-xs" data-testid={`badge-log-level-${log.id}`}>{log.level}</Badge>
                    {" "}
                    {log.message}
                  </div>
                ))}
                {(!jobData?.logs || jobData.logs.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    No logs available
                  </div>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="cards">
              {cardsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4 max-h-96 overflow-y-auto">
                  {cardsData?.cards?.map((card) => (
                    <div key={card.id} className="border rounded-lg p-2" data-testid={`card-item-${card.id}`}>
                      {card.imageUrl ? (
                        <img 
                          src={card.imageUrl} 
                          alt={card.player || "Card"} 
                          className="w-full aspect-[3/4] object-cover rounded mb-2"
                        />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-muted rounded mb-2 flex items-center justify-center">
                          <Layers className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="text-sm font-medium truncate" data-testid={`text-player-${card.id}`}>{card.player || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground" data-testid={`text-card-number-${card.id}`}>#{card.cardNumber || "—"}</div>
                    </div>
                  ))}
                  {(!cardsData?.cards || cardsData.cards.length === 0) && (
                    <div className="col-span-4 text-center py-8 text-muted-foreground">
                      No cards imported yet
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
