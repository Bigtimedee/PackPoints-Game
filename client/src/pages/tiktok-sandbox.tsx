import { useEffect, useState } from "react";
import { useSearch } from "wouter";

const PHOTO_URL = "https://packpts.com/og-image.png";
const REQUESTED_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;

type PostMode = "MEDIA_UPLOAD" | "DIRECT_POST";

interface SandboxSession {
  configured: boolean;
  missingEnv: string[];
  connected: boolean;
  displayName: string | null;
  scopes: string[];
  missingScopes: string[];
  requestedScopes: string[];
  redirectUri: string;
  photoUrl: string;
}

interface PublishState {
  postMode: PostMode | null;
  publishId: string | null;
  status: string | null;
  kind: "pending" | "success" | "error" | null;
  message: string | null;
}

function MaskedPMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="PackPTS"
      className="rounded-md"
    >
      <rect width="1024" height="1024" fill="#0b0f16" />
      <path
        fill="#ffffff"
        fillRule="evenodd"
        d="M292 196 H560 C720 196 820 280 820 420 C820 560 720 644 560 644 H452 V828 H292 Z M452 340 V500 H548 C620 500 668 470 668 420 C668 370 620 340 548 340 Z"
      />
      <rect x="292" y="448" width="528" height="96" fill="#F5C518" />
    </svg>
  );
}

function readApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as { message?: string; error?: string; missingScopes?: string[] };
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.error === "string" && body.error) return body.error;
  return fallback;
}

export default function TiktokSandbox() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlError = params.get("error");
  const urlDetail = params.get("detail");

  const [session, setSession] = useState<SandboxSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PostMode | null>(null);
  const [publish, setPublish] = useState<PublishState>({
    postMode: null,
    publishId: null,
    status: null,
    kind: null,
    message: null,
  });

  useEffect(() => {
    const prev = document.title;
    document.title = "PackPTS";
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/review/tiktok-sandbox/session", { credentials: "include" });
        const data = (await res.json()) as SandboxSession;
        if (!cancelled) setSession(data);
      } catch {
        if (!cancelled) setSessionError("Could not load TikTok sandbox session.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!publish.publishId || publish.kind === "success" || publish.kind === "error") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/review/tiktok-sandbox/status?publish_id=${encodeURIComponent(publish.publishId!)}`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.ok === false) {
          setPublish((prev) => ({
            ...prev,
            kind: "error",
            message: readApiError(data, "Status poll failed."),
          }));
          return;
        }
        setPublish((prev) => ({
          ...prev,
          status: data.status,
          kind: data.kind,
          message: data.failReason ?? null,
        }));
      } catch {
        if (!cancelled) {
          setPublish((prev) => ({
            ...prev,
            kind: "error",
            message: "Status poll failed.",
          }));
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [publish.publishId, publish.kind]);

  const startPublish = async (postMode: PostMode) => {
    setBusy(postMode);
    setPublish({
      postMode,
      publishId: null,
      status: "starting",
      kind: "pending",
      message: null,
    });
    try {
      const res = await fetch("/api/review/tiktok-sandbox/publish", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postMode }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setPublish({
          postMode,
          publishId: null,
          status: null,
          kind: "error",
          message: readApiError(data, `${postMode} failed.`),
        });
        return;
      }
      setPublish({
        postMode,
        publishId: data.publishId,
        status: "PROCESSING",
        kind: "pending",
        message: null,
      });
    } catch {
      setPublish({
        postMode,
        publishId: null,
        status: null,
        kind: "error",
        message: `${postMode} failed — network error.`,
      });
    } finally {
      setBusy(null);
    }
  };

  const connected = !!session?.connected;
  const granted = session?.scopes ?? [];
  const canMediaUpload = granted.includes("video.upload");
  const canDirectPost = granted.includes("video.publish");

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: "#0b0f16" }}>
      <div className="mx-auto max-w-xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3">
          <MaskedPMark />
          <div>
            <p className="text-xl font-black tracking-tight">PackPTS</p>
            <p className="text-xs uppercase tracking-[0.18em] text-white/45">TikTok App Review sandbox</p>
          </div>
        </header>

        <p className="mb-6 text-sm leading-6 text-white/70">
          Daily 5 shows the same five masked cards to everyone. Name the player — names stay hidden
          until you answer. This page is a review-only Login Kit + Content Posting demo. It is not
          linked from the main nav.
        </p>

        {(urlError || sessionError || (session && !session.configured)) && (
          <div
            className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100"
            data-testid="tiktok-sandbox-error"
          >
            {urlError && (
              <p>
                <span className="font-semibold">{urlError}</span>
                {urlDetail ? ` — ${urlDetail}` : ""}
              </p>
            )}
            {sessionError && <p>{sessionError}</p>}
            {session && !session.configured && (
              <p>
                TikTok sandbox OAuth is not configured. Missing:{" "}
                {session.missingEnv.join(", ") || "TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET"}.
              </p>
            )}
          </div>
        )}

        <section className="mb-6 rounded-lg border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-2 text-sm font-semibold">Continue with TikTok (sandbox)</h2>
          <p className="mb-3 text-sm text-white/60">Login Kit OAuth requests these scopes:</p>
          <ul className="mb-4 space-y-1 font-mono text-xs text-white/80">
            {REQUESTED_SCOPES.map((scope) => (
              <li key={scope} data-testid={`tiktok-scope-${scope}`}>
                {scope}
              </li>
            ))}
          </ul>
          <a
            href="/api/auth/tiktok/sandbox/start"
            className="inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-white"
            style={{ backgroundColor: "#2B6CEE" }}
            data-testid="button-tiktok-continue"
          >
            Continue with TikTok (sandbox)
          </a>
          {connected && (
            <p className="mt-3 text-sm text-emerald-300" data-testid="tiktok-sandbox-connected">
              Connected{session?.displayName ? ` as ${session.displayName}` : ""}. Granted:{" "}
              {granted.length > 0 ? granted.join(", ") : "(none returned)"}.
            </p>
          )}
          {connected && session && session.missingScopes.length > 0 && (
            <p className="mt-2 text-sm text-amber-200">
              Missing granted scopes: {session.missingScopes.join(", ")}. Publish actions that need
              them will fail clearly instead of silently.
            </p>
          )}
        </section>

        <section className="mb-6 rounded-lg border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-2 text-sm font-semibold">Photo asset</h2>
          <p className="mb-3 font-mono text-xs text-white/55">
            post_mode MEDIA_UPLOAD or DIRECT_POST · media_type PHOTO · PULL_FROM_URL
            <br />
            {PHOTO_URL}
          </p>
          <img
            src={PHOTO_URL}
            alt="PackPTS Daily 5 masked-card share image"
            className="mb-4 w-full rounded-md border border-white/10"
          />

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={!connected || !canMediaUpload || busy !== null}
              onClick={() => void startPublish("MEDIA_UPLOAD")}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-md border border-white/15 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="button-tiktok-media-upload"
            >
              {busy === "MEDIA_UPLOAD" ? "Uploading…" : "MEDIA_UPLOAD photo"}
            </button>
            <button
              type="button"
              disabled={!connected || !canDirectPost || busy !== null}
              onClick={() => void startPublish("DIRECT_POST")}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: "#2B6CEE" }}
              data-testid="button-tiktok-direct-post"
            >
              {busy === "DIRECT_POST" ? "Posting…" : "Direct Post photo"}
            </button>
          </div>
          {!connected && (
            <p className="mt-3 text-xs text-white/45">Authorize first. Publish stays disabled until then.</p>
          )}
          {connected && !canMediaUpload && (
            <p className="mt-3 text-xs text-amber-200">MEDIA_UPLOAD needs video.upload. That scope was not granted.</p>
          )}
          {connected && !canDirectPost && (
            <p className="mt-3 text-xs text-amber-200">Direct Post needs video.publish. That scope was not granted.</p>
          )}
          <p className="mt-4 text-xs text-white/45">
            By posting, you agree to TikTok&apos;s Music Usage Confirmation. Sandbox Direct Post uses
            SELF_ONLY until the app is audited.
          </p>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5" data-testid="tiktok-sandbox-status">
          <h2 className="mb-2 text-sm font-semibold">Publish status</h2>
          {!publish.postMode && <p className="text-sm text-white/45">No publish started yet.</p>}
          {publish.postMode && (
            <dl className="space-y-2 font-mono text-xs text-white/80">
              <div>
                <dt className="text-white/45">post_mode</dt>
                <dd>{publish.postMode}</dd>
              </div>
              <div>
                <dt className="text-white/45">publish_id</dt>
                <dd data-testid="tiktok-publish-id">{publish.publishId ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-white/45">status</dt>
                <dd data-testid="tiktok-publish-status">{publish.status ?? "—"}</dd>
              </div>
              {publish.kind === "success" && (
                <p className="text-sm font-sans text-emerald-300">
                  {publish.status === "SEND_TO_USER_INBOX"
                    ? "Sandbox success — photo sent to the TikTok inbox (MEDIA_UPLOAD)."
                    : "Sandbox success — PUBLISH_COMPLETE."}
                </p>
              )}
              {publish.kind === "error" && (
                <p className="text-sm font-sans text-red-200">{publish.message ?? "Publish failed."}</p>
              )}
              {publish.kind === "pending" && publish.publishId && (
                <p className="text-sm font-sans text-white/55">Polling until PUBLISH_COMPLETE or a clear sandbox result…</p>
              )}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
