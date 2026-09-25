import sharp from "sharp";
import Tesseract from "tesseract.js";
import type { OcrWordBox } from "./nameLocalization";

/** Hard cap for one recognize. The worker is terminated; the promise is not left running. */
export const OCR_HARD_DEADLINE_MS = 8_000;

const OCR_DOWNSCALE_WIDTH = 700;

export interface OcrWordResult {
  words: OcrWordBox[];
  timedOut: boolean;
  ms: number;
}

export interface OcrJob {
  promise: Promise<{ words: OcrWordBox[] }>;
  /** Stop the worker thread or child process. Must not depend on recognize settling. */
  cancel: () => void;
}

type OcrJobFactory = (buffer: Buffer, originalWidth: number) => OcrJob;

let deadlineOverride: number | null = null;
let jobFactoryOverride: OcrJobFactory | null = null;

export function ocrDeadlineMs(): number {
  return deadlineOverride ?? OCR_HARD_DEADLINE_MS;
}

export function setOcrDeadlineForTests(ms: number | null): void {
  deadlineOverride = ms;
}

export function setOcrJobFactoryForTests(factory: OcrJobFactory | null): void {
  jobFactoryOverride = factory;
}

export function resetOcrRuntimeForTests(): void {
  deadlineOverride = null;
  jobFactoryOverride = null;
}

type KillableRuntime = {
  terminate?: () => Promise<unknown> | unknown;
  worker?: { terminate?: () => Promise<unknown> | unknown; pid?: number };
  pid?: number;
};

/**
 * Stop a tesseract runtime. Node's worker is a Worker thread (`worker.terminate()`).
 * A child pid, when one is exposed, is SIGKILLed. `terminate()` on the public API
 * does not reject an in-flight `recognize`, so callers race that promise separately.
 */
export async function terminateOcrRuntime(runtime: KillableRuntime): Promise<void> {
  const pid = runtime.pid ?? runtime.worker?.pid;
  if (typeof pid === "number" && pid > 0) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
  try {
    const inner = runtime.worker?.terminate?.();
    if (inner && typeof (inner as Promise<unknown>).then === "function") {
      await Promise.race([inner, new Promise((resolve) => setTimeout(resolve, 200))]);
    }
  } catch {
    // already dead
  }
  try {
    const outer = runtime.terminate?.();
    if (outer && typeof (outer as Promise<unknown>).then === "function") {
      await Promise.race([outer, new Promise((resolve) => setTimeout(resolve, 200))]);
    }
  } catch {
    // already dead
  }
}

function boxesFromRecognize(
  result: { data?: { words?: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> } },
  scaleFactor: number,
): OcrWordBox[] {
  const words = result.data?.words || [];
  const boxes: OcrWordBox[] = [];
  for (const word of words) {
    const text = (word.text || "").trim();
    const bbox = word.bbox;
    if (!text || !bbox) continue;
    const confidence = typeof word.confidence === "number" && Number.isFinite(word.confidence)
      ? word.confidence
      : undefined;
    boxes.push({
      text,
      x: Math.round(bbox.x0 * scaleFactor),
      y: Math.round(bbox.y0 * scaleFactor),
      w: Math.round((bbox.x1 - bbox.x0) * scaleFactor),
      h: Math.round((bbox.y1 - bbox.y0) * scaleFactor),
      ...(confidence != null ? { confidence } : {}),
    });
  }
  return boxes;
}

function startTesseractJob(imageBuffer: Buffer, originalWidth: number): OcrJob {
  let runtime: KillableRuntime | null = null;
  let cancelled = false;
  const promise = (async () => {
    const scaledBuffer = await sharp(imageBuffer)
      .resize(OCR_DOWNSCALE_WIDTH)
      .grayscale()
      .normalize()
      .toBuffer();
    const scaledMeta = await sharp(scaledBuffer).metadata();
    const scaleFactor = originalWidth / (scaledMeta.width || OCR_DOWNSCALE_WIDTH);
    const worker = await Tesseract.createWorker("eng", 1, { logger: () => {} });
    runtime = worker as KillableRuntime;
    if (cancelled) {
      await terminateOcrRuntime(runtime);
      return { words: [] as OcrWordBox[] };
    }
    try {
      const result = await worker.recognize(scaledBuffer);
      return { words: boxesFromRecognize(result as Parameters<typeof boxesFromRecognize>[0], scaleFactor) };
    } finally {
      if (!cancelled) await terminateOcrRuntime(runtime);
    }
  })();
  promise.catch(() => {});
  return {
    promise,
    cancel() {
      cancelled = true;
      if (runtime) void terminateOcrRuntime(runtime);
    },
  };
}

/** One OCR pass. On the deadline the worker is killed and this resolves as a timeout. */
export async function recognizeWords(imageBuffer: Buffer, originalWidth: number): Promise<OcrWordResult> {
  const started = Date.now();
  const job = (jobFactoryOverride ?? startTesseractJob)(imageBuffer, originalWidth);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
      job.cancel();
    }, ocrDeadlineMs());
  });
  const work = job.promise
    .then((value) => ({ kind: "ok" as const, words: value.words }))
    .catch(() => ({ kind: "ok" as const, words: [] as OcrWordBox[] }));
  work.catch(() => {});
  timeout.catch(() => {});
  try {
    const winner = await Promise.race([work, timeout]);
    const ms = Date.now() - started;
    if (winner === "timeout") {
      return { words: [], timedOut: true, ms };
    }
    return { words: winner.words, timedOut: false, ms };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
