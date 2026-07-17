import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Upload, X, Check, Copy, Paintbrush } from "lucide-react";

interface IdentifiedCard {
  playerName: string;
  year: number;
  brand: string;
  sport: string;
  setName: string;
  confidence: "high" | "medium" | "low";
  rawText: string;
}

interface CardEntry {
  id: string;
  file: File;
  status: "pending" | "loading" | "ok" | "error";
  card?: IdentifiedCard;
  error?: string;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "bg-green-500/10 text-green-700",
  medium: "bg-yellow-500/10 text-yellow-700",
  low: "bg-red-500/10 text-red-700",
};

export default function MakePage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entries, setEntries] = useState<CardEntry[]>([]);
  const [setName, setSetName] = useState("");
  const [makerNote, setMakerNote] = useState("");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const identifyMutation = useMutation({
    mutationFn: async (imageBase64: string) => {
      const res = await apiRequest("POST", "/api/sets/identify-card", { imageBase64 });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: { cards: IdentifiedCard[]; setName: string; makerNote: string }) => {
      const res = await apiRequest("POST", "/api/sets/create", body);
      return res.json();
    },
    onSuccess: (data) => {
      const url = `${window.location.origin}${data.setUrl}`;
      setPublishedUrl(url);
      setStep(3);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to publish", description: err.message, variant: "destructive" });
    },
  });

  async function handleFiles(files: FileList) {
    const newEntries: CardEntry[] = Array.from(files).slice(0, 20 - entries.length).map(file => ({
      id: crypto.randomUUID(),
      file,
      status: "loading" as const,
    }));

    setEntries(prev => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      try {
        const b64 = await toBase64(entry.file);
        const data = await identifyMutation.mutateAsync(b64);
        setEntries(prev => prev.map(e =>
          e.id === entry.id ? { ...e, status: "ok", card: data.card } : e
        ));
      } catch (err: any) {
        const msg = err?.message || "Could not identify this card";
        setEntries(prev => prev.map(e =>
          e.id === entry.id ? { ...e, status: "error", error: msg } : e
        ));
      }
    }
  }

  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  const okCards = entries.filter(e => e.status === "ok" && e.card);
  const loadingCount = entries.filter(e => e.status === "loading").length;
  const canProceedToReview = okCards.length >= 5 && loadingCount === 0;
  const canPublish = setName.trim().length > 0 && makerNote.trim().length > 0 && okCards.length >= 5;

  function handlePublish() {
    createMutation.mutate({
      cards: okCards.map(e => e.card!),
      setName: setName.trim(),
      makerNote: makerNote.trim(),
    });
  }

  function copyLink() {
    if (publishedUrl) {
      navigator.clipboard.writeText(publishedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-16">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 pt-4">
          <Paintbrush className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Make a Set</h1>
            <p className="text-sm text-muted-foreground">Upload cards → Review → Publish</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm">
          {([1, 2, 3] as const).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${step === s ? "bg-primary text-primary-foreground" : step > s ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"}`}>
                {step > s ? <Check className="h-3 w-3" /> : s}
              </div>
              <span className={step === s ? "font-medium" : "text-muted-foreground"}>
                {s === 1 ? "Upload" : s === 2 ? "Review" : "Publish"}
              </span>
              {s < 3 && <div className="w-8 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 1 — Upload */}
        {step === 1 && (
          <div className="space-y-4">
            <Card
              className="border-2 border-dashed cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Upload card photos</p>
                  <p className="text-sm text-muted-foreground">Select up to 20 images. Need at least 5.</p>
                </div>
                <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                  Choose Photos
                </Button>
              </CardContent>
            </Card>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)}
            />

            {entries.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {entries.map(entry => (
                  <div key={entry.id} className="relative rounded-lg border bg-card p-3 flex flex-col gap-1">
                    <button
                      className="absolute top-2 right-2 rounded-full p-0.5 hover:bg-muted"
                      onClick={() => removeEntry(entry.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <p className="text-xs text-muted-foreground truncate pr-5">{entry.file.name}</p>
                    {entry.status === "loading" && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Identifying…
                      </div>
                    )}
                    {entry.status === "ok" && entry.card && (
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold">{entry.card.playerName}</p>
                        <p className="text-xs text-muted-foreground">{entry.card.year} · {entry.card.brand}</p>
                        <Badge className={`text-xs ${CONFIDENCE_COLOR[entry.card.confidence]}`}>
                          {entry.card.confidence} confidence
                        </Badge>
                      </div>
                    )}
                    {entry.status === "error" && (
                      <p className="text-xs text-destructive">{entry.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {okCards.length} card{okCards.length !== 1 ? "s" : ""} identified
                {loadingCount > 0 && ` · ${loadingCount} processing…`}
              </p>
              <Button
                disabled={!canProceedToReview}
                onClick={() => setStep(2)}
              >
                Review Cards →
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — Review */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Remove any cards that don't belong. You need at least 5 to publish.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {okCards.map(entry => (
                <div key={entry.id} className="relative rounded-lg border bg-card p-3 space-y-1">
                  <button
                    className="absolute top-2 right-2 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => removeEntry(entry.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="text-sm font-semibold pr-5">{entry.card!.playerName}</p>
                  <p className="text-xs text-muted-foreground">{entry.card!.year} · {entry.card!.brand}</p>
                  <p className="text-xs text-muted-foreground">{entry.card!.setName}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button
                disabled={okCards.length < 5}
                onClick={() => setStep(3)}
              >
                Name Your Set →
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — Publish */}
        {step === 3 && !publishedUrl && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Set Name <span className="text-muted-foreground">(max 60 chars)</span></label>
              <Input
                placeholder="e.g. 1990s Basketball Legends"
                maxLength={60}
                value={setName}
                onChange={e => setSetName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground text-right">{setName.length}/60</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mixtape Note <span className="text-muted-foreground">(max 140 chars)</span></label>
              <Textarea
                placeholder="Why do these cards belong together?"
                maxLength={140}
                rows={3}
                value={makerNote}
                onChange={e => setMakerNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground text-right">{makerNote.length}/140</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              {okCards.length} cards · User-created set
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button disabled={!canPublish || createMutation.isPending} onClick={handlePublish}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Publish Set
              </Button>
            </div>
          </div>
        )}

        {/* Success */}
        {step === 3 && publishedUrl && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Your set is live!</h2>
              <p className="text-sm text-muted-foreground mt-1">Share it with friends and see who knows these cards.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-2">
              <p className="text-sm font-mono truncate flex-1">{publishedUrl}</p>
              <Button size="sm" variant="outline" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => setLocation("/")}>Back to Home</Button>
              <Button onClick={() => {
                setEntries([]);
                setSetName("");
                setMakerNote("");
                setPublishedUrl(null);
                setStep(1);
              }}>
                Make Another
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
