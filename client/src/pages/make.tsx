import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { prepareIdentifyImage } from "@/lib/prepareIdentifyImage";
import { useAuth } from "@/hooks/use-auth";
import {
  Loader2,
  Camera,
  Images,
  X,
  Check,
  Copy,
  Paintbrush,
  Users2,
  Share2,
} from "lucide-react";

const MAKE_PENDING_INTENT_KEY = "packpts:make:pendingIntent";
const MAX_LIBRARY_PICK = 20;
const SETS_CTA_URL = "https://packpts.com/sets";

type MakeIntent = "camera" | "library";

interface IdentifiedCard {
  playerName: string;
  year: number;
  brand: string;
  sport: string;
  setName: string;
  confidence: "high" | "medium" | "low";
  rawText: string;
  imageUrl?: string | null;
}

interface CardEntry {
  id: string;
  file: File;
  status: "queued" | "loading" | "ok" | "error";
  card?: IdentifiedCard;
  error?: string;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "bg-green-500/10 text-green-700",
  medium: "bg-yellow-500/10 text-yellow-700",
  low: "bg-red-500/10 text-red-700",
};

function friendlyIdentifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/429|too many|rate|hour/i.test(msg)) {
    return "You've hit today's identify pace — try again in a bit";
  }
  if (/401|unauthorized|unauth/i.test(msg)) {
    return "Sign in to identify cards";
  }
  return msg || "Could not identify this card";
}

export default function MakePage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entries, setEntries] = useState<CardEntry[]>([]);
  const [setName, setSetName] = useState("");
  const [makerNote, setMakerNote] = useState("");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [identifyingBusy, setIdentifyingBusy] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const identifyMutation = useMutation({
    mutationFn: async (imageBase64: string) => {
      const res = await apiRequest("POST", "/api/sets/identify-card", { imageBase64 });
      return res.json();
    },
  });

  const startCollabMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/collab/create", {});
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/collab/${data.id}`);
    },
    onError: () => {
      toast({ title: "Couldn't start a collab session", variant: "destructive" });
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

  const openPicker = useCallback((intent: MakeIntent) => {
    const el = intent === "camera" ? cameraInputRef.current : libraryInputRef.current;
    // Reset so picking the same file again still fires change
    if (el) el.value = "";
    el?.click();
  }, []);

  const requireAuthThen = useCallback(
    (intent: MakeIntent) => {
      if (authLoading) return;
      if (!isAuthenticated) {
        try {
          sessionStorage.setItem(MAKE_PENDING_INTENT_KEY, intent);
        } catch {
          /* ignore quota / private mode */
        }
        setLocation(`/auth?redirect=${encodeURIComponent("/make")}`);
        return;
      }
      openPicker(intent);
    },
    [authLoading, isAuthenticated, openPicker, setLocation],
  );

  // After auth redirect back to /make, resume the CTA intent once.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let intent: string | null = null;
    try {
      intent = sessionStorage.getItem(MAKE_PENDING_INTENT_KEY);
      if (intent) sessionStorage.removeItem(MAKE_PENDING_INTENT_KEY);
    } catch {
      return;
    }
    if (intent === "camera" || intent === "library") {
      // Defer so the hidden inputs are mounted
      requestAnimationFrame(() => openPicker(intent as MakeIntent));
    }
  }, [authLoading, isAuthenticated, openPicker]);

  async function identifyOne(entryId: string, file: File) {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, status: "loading", error: undefined } : e)),
    );
    try {
      const prepared = await prepareIdentifyImage(file);
      const data = await identifyMutation.mutateAsync(prepared.base64);
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: "ok", card: data.card } : e)),
      );
    } catch (err: unknown) {
      const msg = friendlyIdentifyError(err);
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: "error", error: msg } : e)),
      );
      if (/identify pace|too many|429/i.test(msg)) {
        toast({ title: msg, variant: "destructive" });
      }
    }
  }

  async function handleFiles(files: FileList | File[], opts?: { replaceId?: string }) {
    const list = Array.from(files);
    if (list.length === 0) return;

    // Single-slot retry: replace the failed entry's file and re-run just that one
    if (opts?.replaceId) {
      const file = list[0];
      setEntries((prev) =>
        prev.map((e) =>
          e.id === opts.replaceId
            ? { ...e, file, status: "queued", card: undefined, error: undefined }
            : e,
        ),
      );
      setIdentifyingBusy(true);
      try {
        await identifyOne(opts.replaceId, file);
      } finally {
        setIdentifyingBusy(false);
      }
      return;
    }

    const room = MAX_LIBRARY_PICK - entries.length;
    if (room <= 0) {
      toast({
        title: "That's enough for one set",
        description: `You can identify up to ${MAX_LIBRARY_PICK} cards at a time.`,
      });
      return;
    }
    if (list.length > room) {
      toast({
        title: `Keeping the first ${room}`,
        description: `Library picks are capped at ${MAX_LIBRARY_PICK} per set.`,
      });
    }

    const sliced = list.slice(0, room);
    const newEntries: CardEntry[] = sliced.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued" as const,
    }));

    setEntries((prev) => [...prev, ...newEntries]);
    setIdentifyingBusy(true);
    try {
      // Sequential identify — never parallelize (rate limit + Design §3)
      for (const entry of newEntries) {
        await identifyOne(entry.id, entry.file);
      }
    } finally {
      setIdentifyingBusy(false);
    }
  }

  function retryEntry(entry: CardEntry) {
    // Re-open the matching picker for a fresh still, or re-run the same file
    void identifyOne(entry.id, entry.file).finally(() => setIdentifyingBusy(false));
    setIdentifyingBusy(true);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const okCards = entries.filter((e) => e.status === "ok" && e.card);
  const loadingCount = entries.filter((e) => e.status === "loading" || e.status === "queued").length;
  const canProceedToReview = okCards.length >= 5 && loadingCount === 0 && !identifyingBusy;
  const canPublish =
    setName.trim().length > 0 && makerNote.trim().length > 0 && okCards.length >= 5;

  function handlePublish() {
    createMutation.mutate({
      cards: okCards.map((e) => e.card!),
      setName: setName.trim(),
      makerNote: makerNote.trim(),
    });
  }

  function copyLink() {
    if (!publishedUrl) return;
    void navigator.clipboard.writeText(publishedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function shareLink() {
    if (!publishedUrl) return;
    const shareData = {
      title: setName.trim() || "PackPTS set",
      text: makerNote.trim() || "I made this set on PackPTS",
      url: publishedUrl,
    };
    try {
      if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      /* user cancelled or share failed — fall through to copy */
    }
    copyLink();
    toast({ title: "Link copied", description: "Share sheet wasn't available on this device." });
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-16">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 pt-4">
          <Paintbrush className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Snap cards. Build a set.</h1>
            <p className="text-sm text-muted-foreground">
              Rainy-Saturday co-create — file upload only, no live camera viewfinder.
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm">
          {([1, 2, 3] as const).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${step === s ? "bg-primary text-primary-foreground" : step > s ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {step > s ? <Check className="h-3 w-3" /> : s}
              </div>
              <span className={step === s ? "font-medium" : "text-muted-foreground"}>
                {s === 1 ? "Upload" : s === 2 ? "Review" : "Publish"}
              </span>
              {s < 3 && <div className="w-8 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 1 — Upload (two file-input CTAs only) */}
        {step === 1 && (
          <div className="space-y-4">
            {!isAuthenticated && !authLoading && (
              <Card className="border-dashed">
                <CardContent className="py-4 text-sm text-muted-foreground">
                  Sign in to snap cards into a set.{" "}
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline font-medium"
                    onClick={() => setLocation(`/auth?redirect=${encodeURIComponent("/make")}`)}
                  >
                    Sign in
                  </button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="border-2">
                <CardContent className="flex flex-col items-center justify-center gap-3 py-10">
                  <Camera className="h-9 w-9 text-muted-foreground" />
                  <div className="text-center px-2">
                    <p className="font-medium">Take photo</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Rear camera when the OS allows it. One card at a time.
                    </p>
                  </div>
                  <Button
                    onClick={() => requireAuthThen("camera")}
                    disabled={authLoading || identifyingBusy || entries.length >= MAX_LIBRARY_PICK}
                  >
                    Take photo
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-2 border-dashed">
                <CardContent className="flex flex-col items-center justify-center gap-3 py-10">
                  <Images className="h-9 w-9 text-muted-foreground" />
                  <div className="text-center px-2">
                    <p className="font-medium">Choose from library</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Up to {MAX_LIBRARY_PICK} stills. HEIC converts on device.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => requireAuthThen("library")}
                    disabled={authLoading || identifyingBusy || entries.length >= MAX_LIBRARY_PICK}
                  >
                    Choose from library
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Take photo: capture=environment, single file — never multiple */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
              }}
            />
            {/* Library: multiple, no capture (capture kills multi-select on iOS) */}
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
              }}
            />

            {entries.length === 0 && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <Users2 className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Make it together</p>
                      <p className="text-xs text-muted-foreground">
                        Invite a friend — you nominate cards, they approve.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!isAuthenticated) {
                        setLocation(`/auth?redirect=${encodeURIComponent("/make")}`);
                        return;
                      }
                      startCollabMutation.mutate();
                    }}
                    disabled={startCollabMutation.isPending}
                  >
                    {startCollabMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Start"
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {entries.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="relative rounded-lg border bg-card p-3 flex flex-col gap-1"
                  >
                    <button
                      type="button"
                      className="absolute top-2 right-2 rounded-full p-0.5 hover:bg-muted"
                      onClick={() => removeEntry(entry.id)}
                      aria-label="Remove card"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <p className="text-xs text-muted-foreground truncate pr-5">{entry.file.name}</p>
                    {entry.status === "queued" && (
                      <p className="text-xs text-muted-foreground">Queued</p>
                    )}
                    {entry.status === "loading" && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Identifying…
                      </div>
                    )}
                    {entry.status === "ok" && entry.card && (
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold">{entry.card.playerName}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.card.year} · {entry.card.brand}
                        </p>
                        <Badge className={`text-xs ${CONFIDENCE_COLOR[entry.card.confidence]}`}>
                          {entry.card.confidence} confidence
                        </Badge>
                      </div>
                    )}
                    {entry.status === "error" && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{entry.error}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={identifyingBusy}
                          onClick={() => retryEntry(entry)}
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {okCards.length} card{okCards.length !== 1 ? "s" : ""} identified
                {loadingCount > 0 && ` · ${loadingCount} in queue…`}
                {okCards.length > 0 && okCards.length < 5 && " · need at least 5"}
              </p>
              <Button disabled={!canProceedToReview} onClick={() => setStep(2)}>
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
              {okCards.map((entry) => (
                <div key={entry.id} className="relative rounded-lg border bg-card p-3 space-y-1">
                  <button
                    type="button"
                    className="absolute top-2 right-2 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => removeEntry(entry.id)}
                    aria-label="Remove card"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="text-sm font-semibold pr-5">{entry.card!.playerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.card!.year} · {entry.card!.brand}
                  </p>
                  <p className="text-xs text-muted-foreground">{entry.card!.setName}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                ← Back
              </Button>
              <Button disabled={okCards.length < 5} onClick={() => setStep(3)}>
                Name Your Set →
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — Publish */}
        {step === 3 && !publishedUrl && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Set Name <span className="text-muted-foreground">(max 60 chars)</span>
              </label>
              <Input
                placeholder="Untitled set"
                maxLength={60}
                value={setName}
                onChange={(e) => setSetName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground text-right">{setName.length}/60</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Mixtape note <span className="text-muted-foreground">(one line, max 140)</span>
              </label>
              <Textarea
                placeholder="One-line note for the stack…"
                maxLength={140}
                rows={2}
                value={makerNote}
                onChange={(e) => setMakerNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground text-right">{makerNote.length}/140</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              {okCards.length} cards · PackPTS set
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                ← Back
              </Button>
              <Button disabled={!canPublish || createMutation.isPending} onClick={handlePublish}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Publish set
              </Button>
            </div>
          </div>
        )}

        {/* Success — Share URL + Copy; CTA packpts.com/sets */}
        {step === 3 && publishedUrl && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{setName.trim() || "Your set"} is live</h2>
              {makerNote.trim() && (
                <p className="text-sm text-muted-foreground mt-1 italic">“{makerNote.trim()}”</p>
              )}
              <p className="text-sm text-muted-foreground mt-2">
                Share the link — quiet pride, no confetti cannons.
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-2">
              <p className="text-sm font-mono truncate flex-1 text-left">{publishedUrl}</p>
              <Button size="sm" variant="outline" onClick={copyLink} aria-label="Copy link">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button variant="outline" onClick={() => void shareLink()}>
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </Button>
              <Button variant="outline" onClick={copyLink}>
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button asChild>
                <a href={SETS_CTA_URL} target="_blank" rel="noopener noreferrer">
                  packpts.com/sets
                </a>
              </Button>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="ghost" onClick={() => setLocation("/")}>
                Back to Home
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEntries([]);
                  setSetName("");
                  setMakerNote("");
                  setPublishedUrl(null);
                  setStep(1);
                }}
              >
                Make another
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
