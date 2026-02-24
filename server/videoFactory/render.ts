import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import sharp from "sharp";
import { FFMPEG_PATH } from "./ffmpegPath";

const FONT_PATH = path.resolve("assets/fonts/DejaVuSans-Bold.ttf");
const FONT_REGULAR_PATH = path.resolve("assets/fonts/DejaVuSans.ttf");

export interface RenderInput {
  cardImagePath: string;
  hookText: string;
  answerText: string;
  ctaText: string;
  outputDir: string;
  templateId?: string;
  durationSec?: number;
  voiceAudioPath?: string | null;
  width?: number;
  height?: number;
}

export interface RenderOutput {
  videoPath: string;
  thumbnailPath: string;
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
}

function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\\\:")
    .replace(/%/g, "\\\\%")
    .replace(/\n/g, " ");
}

async function generateBlurredBackground(
  cardImagePath: string,
  outputPath: string,
  width: number,
  height: number
): Promise<string> {
  await sharp(cardImagePath)
    .resize(width, height, { fit: "cover" })
    .blur(40)
    .modulate({ brightness: 0.4 })
    .toFile(outputPath);
  return outputPath;
}

async function resizeCardForOverlay(
  cardImagePath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number
): Promise<{ width: number; height: number }> {
  const cardW = Math.round(targetWidth * 0.7);
  const cardH = Math.round(targetHeight * 0.6);

  const resized = await sharp(cardImagePath)
    .resize(cardW, cardH, { fit: "inside", withoutEnlargement: false })
    .png()
    .toFile(outputPath);

  return { width: resized.width || cardW, height: resized.height || cardH };
}

function runFFmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg timed out after 120s"));
    }, 120000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function renderClassicCountdown(input: RenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 12;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const bgPath = path.join(outputDir, "bg_blurred.png");
  const cardOverlayPath = path.join(outputDir, "card_overlay.png");
  const videoPath = path.join(outputDir, "output.mp4");
  const thumbnailPath = path.join(outputDir, "thumbnail.jpg");

  await generateBlurredBackground(input.cardImagePath, bgPath, W, H);
  const cardSize = await resizeCardForOverlay(input.cardImagePath, cardOverlayPath, W, H);

  const cardX = Math.round((W - cardSize.width) / 2);
  const cardY = Math.round((H - cardSize.height) / 2) - Math.round(H * 0.02);

  const hookEsc = escapeDrawText(input.hookText);
  const answerEsc = escapeDrawText(`Answer: ${input.answerText}`);
  const ctaEsc = escapeDrawText(input.ctaText);
  const whoEsc = escapeDrawText("Who is this player?");

  const fontFile = FONT_PATH.replace(/:/g, "\\:");
  const fontRegular = FONT_REGULAR_PATH.replace(/:/g, "\\:");

  const filterParts: string[] = [];

  filterParts.push(`[0:v]loop=loop=${duration * 25}:size=1:start=0,setpts=N/25/TB,scale=${W}:${H},format=yuv420p[bg]`);
  filterParts.push(`[1:v]scale=${cardSize.width}:${cardSize.height},format=yuva420p[card]`);
  filterParts.push(`[bg][card]overlay=${cardX}:${cardY}[composed]`);

  const drawTextFilters: string[] = [];

  drawTextFilters.push(
    `drawtext=fontfile='${fontFile}':text='${hookEsc}':fontcolor=white:fontsize=56:` +
    `x=(w-text_w)/2:y=h*0.15:enable='between(t,0,2)':` +
    `borderw=3:bordercolor=black@0.7`
  );

  drawTextFilters.push(
    `drawtext=fontfile='${fontRegular}':text='${whoEsc}':fontcolor=white:fontsize=44:` +
    `x=(w-text_w)/2:y=h*0.12:enable='between(t,2,6)':` +
    `borderw=2:bordercolor=black@0.7`
  );

  drawTextFilters.push(
    `drawtext=fontfile='${fontFile}':text='3':fontcolor=#FFD700:fontsize=140:` +
    `x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,2,3)':` +
    `borderw=4:bordercolor=black@0.8`
  );
  drawTextFilters.push(
    `drawtext=fontfile='${fontFile}':text='2':fontcolor=#FFD700:fontsize=140:` +
    `x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,4)':` +
    `borderw=4:bordercolor=black@0.8`
  );
  drawTextFilters.push(
    `drawtext=fontfile='${fontFile}':text='1':fontcolor=#FFD700:fontsize=140:` +
    `x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,4,5)':` +
    `borderw=4:bordercolor=black@0.8`
  );

  drawTextFilters.push(
    `drawtext=fontfile='${fontFile}':text='${answerEsc}':fontcolor=#00FF88:fontsize=52:` +
    `x=(w-text_w)/2:y=h*0.82:enable='between(t,6,10)':` +
    `borderw=3:bordercolor=black@0.8`
  );

  drawTextFilters.push(
    `drawtext=fontfile='${fontFile}':text='${ctaEsc}':fontcolor=white:fontsize=42:` +
    `x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,10,${duration})':` +
    `borderw=3:bordercolor=black@0.7`
  );

  filterParts.push(`[composed]${drawTextFilters.join(",")}[textout]`);

  let finalLabel = "textout";

  if (input.voiceAudioPath && fs.existsSync(input.voiceAudioPath)) {
    filterParts.push(`[2:a]apad,atrim=0:${duration}[voice]`);
    finalLabel = "textout";
  }

  const filterComplex = filterParts.join(";");

  const hasVoice = !!(input.voiceAudioPath && fs.existsSync(input.voiceAudioPath));

  const ffmpegArgs: string[] = [
    "-y",
    "-i", bgPath,
    "-i", cardOverlayPath,
  ];

  if (hasVoice) {
    ffmpegArgs.push("-i", input.voiceAudioPath!);
  } else {
    ffmpegArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }

  ffmpegArgs.push(
    "-filter_complex", filterComplex,
    "-map", `[${finalLabel}]`,
  );

  if (hasVoice) {
    ffmpegArgs.push("-map", "[voice]");
  } else {
    ffmpegArgs.push("-map", "2:a", "-shortest");
  }

  ffmpegArgs.push(
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-t", String(duration),
    "-movflags", "+faststart",
    videoPath
  );

  console.log(`[VideoFactory/Render] Starting FFmpeg render: ${W}x${H}, ${duration}s`);
  const startTime = Date.now();

  try {
    await runFFmpeg(ffmpegArgs);
  } catch (err: any) {
    console.error(`[VideoFactory/Render] FFmpeg failed:`, err?.message);
    throw new Error(`FFmpeg render failed: ${err?.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[VideoFactory/Render] Render complete in ${elapsed}s`);

  await runFFmpeg([
    "-y",
    "-i", videoPath,
    "-ss", "1",
    "-vframes", "1",
    "-q:v", "2",
    thumbnailPath,
  ]);

  const stats = fs.statSync(videoPath);

  try {
    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
    if (fs.existsSync(cardOverlayPath)) fs.unlinkSync(cardOverlayPath);
  } catch {}

  return {
    videoPath,
    thumbnailPath,
    durationSec: duration,
    width: W,
    height: H,
    sizeBytes: stats.size,
  };
}
