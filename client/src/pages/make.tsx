import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { prepareIdentifyImage } from "@/lib/prepareIdentifyImage";
import { useAuth } from "@/hooks/use-auth";
import { MakeEmptyState } from "@/components/MakeEmptyState";
import { MakeDraftBoard, MakeIdentifySlot } from "@/components/MakeIdentifySlot";
import { MakeMatchResult } from "@/components/MakeMatchResult";
import {
  IDENTIFY_RETRY_COPY,
  MAKE_CANVAS,
  MAKE_GOLD,
  MAKE_INK,
  MAKE_MUTED,
  QA_IDENTIFY_FAIL_ENTRY_ID,
  consumeQaIdentifyFailStorage,
  friendlyIdentifyError,
  makeQaIdentifyFailEntry,
  makeQaPreviewFile,
  staffWantsQaIdentifyFail,
} from "@/lib/makeIdentifyUi";
import type { CatalogMatchResponse } from "@shared/catalogMatch";

const MAKE_PENDING_INTENT_KEY = "packpts:make:pendingIntent";
const MAKE_START_LOGGED_KEY = "packpts:make:startedSession";
const MAX_LIBRARY_PICK = 20;
const IDENTIFY_REQUEST_TIMEOUT_MS = 45_000;

type MakeIntent = "camera" | "library";

interface CardEntry {
  id: string;
  file: File;
  status: "queued" | "loading" | "ok" | "error";
  error?: string;
  match?: CatalogMatchResponse;
}

function MaskedPMark() {
  return (
    <svg width={22} height={22} viewBox="0 0 1024 1024" aria-hidden className="rounded-sm">
      <rect width="1024" height="1024" fill={MAKE_CANVAS} />
      <path
        fill="#ffffff"
        fillRule="evenodd"
        d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"
      />
      <rect x="292" y="448" width="528" height="96" fill={MAKE_GOLD} />
    </svg>
  );
}

export default function MakePage() {
  const [entries, setEntries] = useState<CardEntry[]>([]);
  const [pickedByEntry, setPickedByEntry] = useState<Record<string, string>>({});
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const pendingAuthIntentRef = useRef<MakeIntent | null>(null);
  const entriesRef = useRef<CardEntry[]>([]);
  const identifyQueue = useRef<{ id: string; file: File }[]>([]);
  const drainingRef = useRef(false);
  const [identifyingBusy, setIdentifyingBusy] = useState(false);
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const identifyMutation = useMutation({
    mutationFn: async (imageBase64: string) => {
      const res = await apiRequest(
        "POST",
        "/api/make/identify",
        { imageBase64 },
        { timeoutMs: IDENTIFY_REQUEST_TIMEOUT_MS },
      );
      return res.json() as Promise<CatalogMatchResponse>;
    },
  });

  const openPicker = useCallback((intent: MakeIntent) => {
    const el = intent === "camera" ? cameraInputRef.current : libraryInputRef.current;
    if (el) el.value = "";
    el?.click();
  }, []);

  const requireAuthThen = useCallback(
    (intent: MakeIntent) => {
      if (authLoading) {
        pendingAuthIntentRef.current = intent;
        return;
      }
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

  useEffect(() => {
    if (authLoading) return;
    const queued = pendingAuthIntentRef.current;
    if (!queued) return;
    pendingAuthIntentRef.current = null;
    requireAuthThen(queued);
  }, [authLoading, requireAuthThen]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(MAKE_START_LOGGED_KEY)) return;
      sessionStorage.setItem(MAKE_START_LOGGED_KEY, "1");
    } catch {
      /* private mode — still log */
    }
    void apiRequest("POST", "/api/make/start", {}).catch(() => {});
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof window === "undefined" || window.location.hash !== "#design-retry") return;
    const blank = makeQaPreviewFile();
    setEntries([
      { id: "design-2", file: blank, status: "loading" },
      { id: "design-3", file: blank, status: "error", error: IDENTIFY_RETRY_COPY.failed },
      { id: "design-4", file: blank, status: "queued" },
    ]);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (typeof window === "undefined") return;
    const readStorage = (key: string) => {
      try {
        return sessionStorage.getItem(key) ?? localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    if (
      !staffWantsQaIdentifyFail({
        isAdmin: user?.isAdmin,
        search: window.location.search,
        readStorage,
      })
    ) {
      return;
    }
    consumeQaIdentifyFailStorage((key) => {
      try {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      } catch {
        /* private mode */
      }
    });
    setEntries((prev) => {
      if (prev.some((entry) => entry.id === QA_IDENTIFY_FAIL_ENTRY_ID)) return prev;
      return [...prev, makeQaIdentifyFailEntry(makeQaPreviewFile())];
    });
  }, [authLoading, user?.isAdmin]);

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
      requestAnimationFrame(() => openPicker(intent as MakeIntent));
    }
  }, [authLoading, isAuthenticated, openPicker]);

  async function identifyOne(entryId: string, file: File) {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === entryId ? { ...entry, status: "loading", error: undefined, match: undefined } : entry,
      ),
    );
    try {
      const prepared = await prepareIdentifyImage(file);
      const data = await identifyMutation.mutateAsync(prepared.base64);
      setEntries((prev) =>
        prev.map((entry) => (entry.id === entryId ? { ...entry, status: "ok", match: data } : entry)),
      );
    } catch (err: unknown) {
      const msg = friendlyIdentifyError(err);
      setEntries((prev) =>
        prev.map((entry) => (entry.id === entryId ? { ...entry, status: "error", error: msg, match: undefined } : entry)),
      );
    }
  }

  function enqueueIdentify(jobs: { id: string; file: File }[]) {
    identifyQueue.current.push(...jobs);
    void drainIdentifyQueue();
  }

  async function drainIdentifyQueue() {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setIdentifyingBusy(true);
    try {
      while (identifyQueue.current.length > 0) {
        const job = identifyQueue.current.shift();
        if (!job) break;
        if (!entriesRef.current.some((entry) => entry.id === job.id)) continue;
        await identifyOne(job.id, job.file);
      }
    } finally {
      drainingRef.current = false;
      setIdentifyingBusy(false);
    }
    if (identifyQueue.current.length > 0) {
      void drainIdentifyQueue();
    }
  }

  function resetCapture() {
    identifyQueue.current = [];
    setPickedByEntry({});
    setEntries([]);
    entriesRef.current = [];
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    const room = MAX_LIBRARY_PICK - entries.length;
    if (room <= 0) return;
    const sliced = list.slice(0, room);
    const newEntries: CardEntry[] = sliced.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued" as const,
    }));

    setEntries((prev) => {
      const next = [...prev, ...newEntries];
      entriesRef.current = next;
      return next;
    });
    enqueueIdentify(newEntries.map((entry) => ({ id: entry.id, file: entry.file })));
  }

  function retryEntry(entry: CardEntry) {
    if (entry.id === QA_IDENTIFY_FAIL_ENTRY_ID) {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? { ...item, status: "error" as const, match: undefined, error: IDENTIFY_RETRY_COPY.failed }
            : item,
        ),
      );
      return;
    }
    setEntries((prev) => {
      const next = prev.map((item) =>
        item.id === entry.id ? { ...item, status: "queued" as const, match: undefined, error: undefined } : item,
      );
      entriesRef.current = next;
      return next;
    });
    enqueueIdentify([{ id: entry.id, file: entry.file }]);
  }

  function skipEntry(id: string) {
    identifyQueue.current = identifyQueue.current.filter((job) => job.id !== id);
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.id !== id);
      entriesRef.current = next;
      return next;
    });
  }

  const pending = entries.some((entry) => entry.status === "queued" || entry.status === "loading");
  const results = entries.filter((entry) => entry.status === "ok" && entry.match);
  const errors = entries.filter((entry) => entry.status === "error");
  const showResults = results.length > 0 && !pending && !identifyingBusy;
  const showIdentify = entries.length > 0 && !showResults;

  return (
    <div className="min-h-screen p-4 pb-16" style={{ background: MAKE_CANVAS, color: MAKE_INK }}>
      <div className="mx-auto max-w-md space-y-6">
        <header className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <MaskedPMark />
            <span className="text-sm font-semibold tracking-wide">PackPTS</span>
          </div>
          <p className="text-[11px]" style={{ color: MAKE_MUTED }}>
            /make
          </p>
        </header>

        {entries.length === 0 && (
          <MakeEmptyState
            onTakePhoto={() => requireAuthThen("camera")}
            onChooseLibrary={() => requireAuthThen("library")}
            photoDisabled={authLoading || identifyingBusy}
            libraryDisabled={authLoading || identifyingBusy}
            showSoftAuth={!isAuthenticated && !authLoading}
            onSignIn={() => setLocation(`/auth?redirect=${encodeURIComponent("/make")}`)}
          />
        )}

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          data-testid="make-camera-input"
          onChange={(event) => {
            if (event.target.files?.length) void handleFiles(event.target.files);
          }}
        />
        {/* Library: multiple, no capture (capture kills multi-select on iOS) */}
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-testid="make-library-input"
          onChange={(event) => {
            if (!event.target.files?.length) return;
            void handleFiles(event.target.files);
          }}
        />

        {showIdentify && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.22em]" style={{ color: MAKE_MUTED }}>
                {IDENTIFY_RETRY_COPY.eyebrow}
              </p>
              <div className="mt-3 flex items-start justify-between gap-3">
                <h1 className="text-[1.85rem] font-bold leading-tight" style={{ color: MAKE_INK }}>
                  {IDENTIFY_RETRY_COPY.headline}
                </h1>
                <p className="pt-2 text-[11px]" style={{ color: MAKE_MUTED }}>
                  {IDENTIFY_RETRY_COPY.crumb}
                </p>
              </div>
              <p className="mt-2 text-sm" style={{ color: MAKE_MUTED }}>
                {IDENTIFY_RETRY_COPY.subline}
              </p>
            </div>
            <MakeDraftBoard count={entries.length}>
              {entries.map((entry, index) => (
                <MakeIdentifySlot
                  key={entry.id}
                  index={index}
                  file={entry.file}
                  status={entry.status}
                  card={
                    entry.match?.card
                      ? {
                          playerName: entry.match.card.playerName,
                          year: entry.match.card.year ?? undefined,
                          brand: entry.match.card.brand ?? undefined,
                        }
                      : undefined
                  }
                  detail={entry.error}
                  onTryAgain={() => retryEntry(entry)}
                  onSkip={() => skipEntry(entry.id)}
                />
              ))}
            </MakeDraftBoard>
          </div>
        )}

        {showResults && (
          <div className="space-y-10">
            {errors.length > 0 && (
              <MakeDraftBoard count={errors.length}>
                {errors.map((entry, index) => (
                  <MakeIdentifySlot
                    key={entry.id}
                    index={index}
                    file={entry.file}
                    status={entry.status}
                    detail={entry.error}
                    onTryAgain={() => retryEntry(entry)}
                    onSkip={() => skipEntry(entry.id)}
                  />
                ))}
              </MakeDraftBoard>
            )}
            {results.map((entry) => {
              const match = entry.match!;
              return (
                <MakeMatchResult
                  key={entry.id}
                  status={match.match.status}
                  file={entry.file}
                  label={match.card?.label ?? null}
                  sets={match.match.sets}
                  pickedSetId={pickedByEntry[entry.id] ?? null}
                  onPick={(setId) => setPickedByEntry((prev) => ({ ...prev, [entry.id]: setId }))}
                  onPlay={(path) => setLocation(path)}
                  onSnapAnother={resetCapture}
                  onBrowse={() => setLocation("/sets")}
                  onTryAnother={resetCapture}
                  onDaily5={() => setLocation("/daily5")}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
