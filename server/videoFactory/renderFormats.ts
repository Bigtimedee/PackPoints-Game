import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const FONT_PATH = path.resolve("assets/fonts/DejaVuSans-Bold.ttf");
const FONT_REGULAR_PATH = path.resolve("assets/fonts/DejaVuSans.ttf");

export interface MultiCardRenderInput {
  cardImagePaths: string[];
  templateId: string;
  hookText: string;
  answerTexts: string[];
  ctaText: string;
  outputDir: string;
  durationSec: number;
  voiceAudioPath?: string | null;
  extraOverlays?: { text: string; startSec: number; endSec: number; color: string; position: "top" | "center" | "bottom"; fontSize?: number }[];
  leaderboardLines?: string[];
  eraLabel?: string;
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
  imagePath: string, outputPath: string, width: number, height: number
): Promise<void> {
  await sharp(imagePath)
    .resize(width, height, { fit: "cover" })
    .blur(40)
    .modulate({ brightness: 0.4 })
    .toFile(outputPath);
}

async function resizeCard(
  imagePath: string, outputPath: string, targetW: number, targetH: number, scaleFactor?: number
): Promise<{ width: number; height: number }> {
  const cardW = Math.round(targetW * (scaleFactor || 0.7));
  const cardH = Math.round(targetH * (scaleFactor || 0.6));
  const resized = await sharp(imagePath)
    .resize(cardW, cardH, { fit: "inside", withoutEnlargement: false })
    .png()
    .toFile(outputPath);
  return { width: resized.width || cardW, height: resized.height || cardH };
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg timed out after 180s"));
    }, 180000);
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

function yPos(position: "top" | "center" | "bottom" | "top-third" | "bottom-third", h: string = "h"): string {
  switch (position) {
    case "top": return `${h}*0.12`;
    case "top-third": return `${h}*0.15`;
    case "center": return `(${h}-text_h)/2`;
    case "bottom-third": return `${h}*0.78`;
    case "bottom": return `${h}*0.85`;
  }
}

export async function renderOnlyRealFans(input: MultiCardRenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 12;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const bgPath = path.join(outputDir, "bg.png");
  const cardPath = path.join(outputDir, "card.png");
  const videoPath = path.join(outputDir, "output.mp4");
  const thumbPath = path.join(outputDir, "thumbnail.jpg");

  await generateBlurredBackground(input.cardImagePaths[0], bgPath, W, H);
  const cardSize = await resizeCard(input.cardImagePaths[0], cardPath, W, H);

  const cardX = Math.round((W - cardSize.width) / 2);
  const cardY = Math.round((H - cardSize.height) / 2) - Math.round(H * 0.02);

  const fontFile = FONT_PATH.replace(/:/g, "\\:");
  const fontRegular = FONT_REGULAR_PATH.replace(/:/g, "\\:");

  const hookEsc = escapeDrawText(input.hookText);
  const answerEsc = escapeDrawText(`Answer: ${input.answerTexts[0] || "???"}`);
  const ctaEsc = escapeDrawText(input.ctaText);

  const filterParts = [
    `[0:v]loop=loop=${duration * 25}:size=1:start=0,setpts=N/25/TB,scale=${W}:${H},format=yuv420p[bg]`,
    `[1:v]scale=${cardSize.width}:${cardSize.height},format=yuva420p[card]`,
    `[bg][card]overlay=${cardX}:${cardY}[composed]`,
  ];

  const dt: string[] = [];
  dt.push(`drawtext=fontfile='${fontFile}':text='${hookEsc}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=h*0.15:enable='between(t,0,2)':borderw=3:bordercolor=black@0.7`);
  dt.push(`drawtext=fontfile='${fontRegular}':text='${escapeDrawText("WHO IS IT?")}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=h*0.12:enable='between(t,2,6)':borderw=2:bordercolor=black@0.7`);
  dt.push(`drawtext=fontfile='${fontFile}':text='3':fontcolor=#FFD700:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,2,3)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='2':fontcolor=#FFD700:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,4)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='1':fontcolor=#FFD700:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,4,5)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${answerEsc}':fontcolor=#00FF88:fontsize=52:x=(w-text_w)/2:y=h*0.82:enable='between(t,6,10)':borderw=3:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${ctaEsc}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,10,${duration})':borderw=3:bordercolor=black@0.7`);

  filterParts.push(`[composed]${dt.join(",")}[textout]`);

  const args = [
    "-y", "-i", bgPath, "-i", cardPath,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filterParts.join(";"),
    "-map", "[textout]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-t", String(duration),
    "-shortest", "-movflags", "+faststart", videoPath,
  ];

  await runFFmpeg(args);
  await runFFmpeg(["-y", "-i", videoPath, "-ss", "1", "-vframes", "1", "-q:v", "2", thumbPath]);

  cleanup(bgPath, cardPath);
  const stats = fs.statSync(videoPath);
  return { videoPath, thumbnailPath: thumbPath, durationSec: duration, width: W, height: H, sizeBytes: stats.size };
}

export async function renderMemoryShock(input: MultiCardRenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 12;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const bgPath = path.join(outputDir, "bg.png");
  const cardPath = path.join(outputDir, "card.png");
  const videoPath = path.join(outputDir, "output.mp4");
  const thumbPath = path.join(outputDir, "thumbnail.jpg");

  await generateBlurredBackground(input.cardImagePaths[0], bgPath, W, H);
  const cardSize = await resizeCard(input.cardImagePaths[0], cardPath, W, H);

  const cardX = Math.round((W - cardSize.width) / 2);
  const cardY = Math.round((H - cardSize.height) / 2) - Math.round(H * 0.02);

  const fontFile = FONT_PATH.replace(/:/g, "\\:");

  const hookEsc = escapeDrawText(input.hookText || "REMEMBER THIS GUY?");
  const promptEsc = escapeDrawText("Where did he play?");
  const answerEsc = escapeDrawText(`Answer: ${input.answerTexts[0] || "???"}`);
  const ctaEsc = escapeDrawText(input.ctaText);

  const filterParts = [
    `[0:v]loop=loop=${duration * 25}:size=1:start=0,setpts=N/25/TB,scale=${W}:${H},format=yuv420p[bg]`,
    `[1:v]scale=${cardSize.width}:${cardSize.height},format=yuva420p[card]`,
    `[bg][card]overlay=${cardX}:${cardY}[composed]`,
  ];

  const dt: string[] = [];
  dt.push(`drawtext=fontfile='${fontFile}':text='${hookEsc}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=h*0.12:enable='between(t,0,3)':borderw=3:bordercolor=black@0.7`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${promptEsc}':fontcolor=#FFD700:fontsize=48:x=(w-text_w)/2:y=h*0.12:enable='between(t,3,7)':borderw=3:bordercolor=black@0.7`);

  if (input.extraOverlays) {
    for (const ov of input.extraOverlays) {
      dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText(ov.text)}':fontcolor=${ov.color}:fontsize=${ov.fontSize || 40}:x=(w-text_w)/2:y=${yPos(ov.position)}:enable='between(t,${ov.startSec},${ov.endSec})':borderw=2:bordercolor=black@0.7`);
    }
  }

  dt.push(`drawtext=fontfile='${fontFile}':text='${answerEsc}':fontcolor=#00FF88:fontsize=52:x=(w-text_w)/2:y=h*0.82:enable='between(t,7,10)':borderw=3:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${ctaEsc}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,10,${duration})':borderw=3:bordercolor=black@0.7`);

  filterParts.push(`[composed]${dt.join(",")}[textout]`);

  const args = [
    "-y", "-i", bgPath, "-i", cardPath,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filterParts.join(";"),
    "-map", "[textout]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-t", String(duration),
    "-shortest", "-movflags", "+faststart", videoPath,
  ];

  await runFFmpeg(args);
  await runFFmpeg(["-y", "-i", videoPath, "-ss", "1", "-vframes", "1", "-q:v", "2", thumbPath]);

  cleanup(bgPath, cardPath);
  const stats = fs.statSync(videoPath);
  return { videoPath, thumbnailPath: thumbPath, durationSec: duration, width: W, height: H, sizeBytes: stats.size };
}

export async function renderPackPullDrama(input: MultiCardRenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 15;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const bgPath = path.join(outputDir, "bg.png");
  const cardPath = path.join(outputDir, "card.png");
  const videoPath = path.join(outputDir, "output.mp4");
  const thumbPath = path.join(outputDir, "thumbnail.jpg");

  await generateBlurredBackground(input.cardImagePaths[0], bgPath, W, H);
  const cardSize = await resizeCard(input.cardImagePaths[0], cardPath, W, H);

  const cardX = Math.round((W - cardSize.width) / 2);
  const cardY = Math.round((H - cardSize.height) / 2) - Math.round(H * 0.02);

  const fontFile = FONT_PATH.replace(/:/g, "\\:");

  const hookEsc = escapeDrawText(input.hookText || "PACK PULL TIME");
  const answerEsc = escapeDrawText(input.answerTexts[0] || "???");
  const ctaEsc = escapeDrawText(input.ctaText);

  const filterParts = [
    `[0:v]loop=loop=${duration * 25}:size=1:start=0,setpts=N/25/TB,scale=${W}:${H},format=yuv420p[bg]`,
    `[1:v]scale=${cardSize.width}:${cardSize.height},format=yuva420p[card]`,
    `[bg][card]overlay=${cardX}:${cardY}:enable='gte(t,2)'[composed]`,
  ];

  const dt: string[] = [];
  dt.push(`drawtext=fontfile='${fontFile}':text='${hookEsc}':fontcolor=#FF6B35:fontsize=64:x=(w-text_w)/2:y=h*0.15:enable='between(t,0,5)':borderw=3:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='3':fontcolor=#FFD700:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,2,3)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='2':fontcolor=#FFD700:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,4)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='1':fontcolor=#FFD700:fontsize=140:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,4,5)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${answerEsc}':fontcolor=#00FF88:fontsize=56:x=(w-text_w)/2:y=h*0.82:enable='between(t,5,12)':borderw=3:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${ctaEsc}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,12,${duration})':borderw=3:bordercolor=black@0.7`);

  filterParts.push(`[composed]${dt.join(",")}[textout]`);

  const args = [
    "-y", "-i", bgPath, "-i", cardPath,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filterParts.join(";"),
    "-map", "[textout]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-t", String(duration),
    "-shortest", "-movflags", "+faststart", videoPath,
  ];

  await runFFmpeg(args);
  await runFFmpeg(["-y", "-i", videoPath, "-ss", "6", "-vframes", "1", "-q:v", "2", thumbPath]);

  cleanup(bgPath, cardPath);
  const stats = fs.statSync(videoPath);
  return { videoPath, thumbnailPath: thumbPath, durationSec: duration, width: W, height: H, sizeBytes: stats.size };
}

export async function renderDifficultyLadder(input: MultiCardRenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 15;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const bgPath = path.join(outputDir, "bg.png");
  const videoPath = path.join(outputDir, "output.mp4");
  const thumbPath = path.join(outputDir, "thumbnail.jpg");

  await generateBlurredBackground(input.cardImagePaths[0], bgPath, W, H);

  const cardPaths: string[] = [];
  const cardSizes: { width: number; height: number }[] = [];
  for (let i = 0; i < Math.min(input.cardImagePaths.length, 3); i++) {
    const cp = path.join(outputDir, `card_${i}.png`);
    const size = await resizeCard(input.cardImagePaths[i], cp, W, H, 0.65);
    cardPaths.push(cp);
    cardSizes.push(size);
  }

  while (cardPaths.length < 3) {
    cardPaths.push(cardPaths[0]);
    cardSizes.push(cardSizes[0]);
  }

  const fontFile = FONT_PATH.replace(/:/g, "\\:");

  const answers = input.answerTexts;
  while (answers.length < 3) answers.push("???");

  const labels = ["EASY", "MEDIUM", "IMPOSSIBLE"];
  const colors = ["#00FF88", "#FFD700", "#FF4444"];
  const timing = [[0, 3], [3, 6], [6, 9], [9, 12], [12, 15]];

  const filterParts = [
    `[0:v]loop=loop=${duration * 25}:size=1:start=0,setpts=N/25/TB,scale=${W}:${H},format=yuv420p[bg]`,
  ];

  for (let i = 0; i < 3; i++) {
    filterParts.push(`[${i + 1}:v]scale=${cardSizes[i].width}:${cardSizes[i].height},format=yuva420p[card${i}]`);
  }

  const cardX = (i: number) => Math.round((W - cardSizes[i].width) / 2);
  const cardYFn = (i: number) => Math.round((H - cardSizes[i].height) / 2) - Math.round(H * 0.02);

  filterParts.push(`[bg][card0]overlay=${cardX(0)}:${cardYFn(0)}:enable='between(t,${timing[0][0]},${timing[1][1]})'[c0]`);
  filterParts.push(`[c0][card1]overlay=${cardX(1)}:${cardYFn(1)}:enable='between(t,${timing[2][0]},${timing[3][1]})'[c1]`);
  filterParts.push(`[c1][card2]overlay=${cardX(2)}:${cardYFn(2)}:enable='between(t,${timing[4][0]},${timing[4][1]})'[composed]`);

  const dt: string[] = [];

  for (let i = 0; i < 3; i++) {
    const showStart = timing[i * 2 >= timing.length ? timing.length - 1 : i * 2][0];
    const showEnd = timing[i * 2 >= timing.length ? timing.length - 1 : i * 2][1];
    dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText(labels[i])}':fontcolor=${colors[i]}:fontsize=72:x=(w-text_w)/2:y=h*0.10:enable='between(t,${showStart},${showEnd})':borderw=4:bordercolor=black@0.8`);
  }

  dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText(answers[0])}':fontcolor=#00FF88:fontsize=48:x=(w-text_w)/2:y=h*0.82:enable='between(t,${timing[1][0]},${timing[1][1]})':borderw=3:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText(answers[1])}':fontcolor=#FFD700:fontsize=48:x=(w-text_w)/2:y=h*0.82:enable='between(t,${timing[3][0]},${timing[3][1]})':borderw=3:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText(input.ctaText)}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=h*0.85:enable='between(t,${timing[4][0]},${timing[4][1]})':borderw=3:bordercolor=black@0.7`);

  filterParts.push(`[composed]${dt.join(",")}[textout]`);

  const ffArgs = ["-y", "-i", bgPath];
  for (const cp of cardPaths) ffArgs.push("-i", cp);
  ffArgs.push(
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filterParts.join(";"),
    "-map", "[textout]", "-map", `${cardPaths.length + 1}:a`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-t", String(duration),
    "-shortest", "-movflags", "+faststart", videoPath,
  );

  await runFFmpeg(ffArgs);
  await runFFmpeg(["-y", "-i", videoPath, "-ss", "1", "-vframes", "1", "-q:v", "2", thumbPath]);

  cleanup(bgPath, ...cardPaths);
  const stats = fs.statSync(videoPath);
  return { videoPath, thumbnailPath: thumbPath, durationSec: duration, width: W, height: H, sizeBytes: stats.size };
}

export async function renderLeaderboardFlex(input: MultiCardRenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 12;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const videoPath = path.join(outputDir, "output.mp4");
  const thumbPath = path.join(outputDir, "thumbnail.jpg");

  const fontFile = FONT_PATH.replace(/:/g, "\\:");

  const introEsc = escapeDrawText("DAILY 5 TOP PLAYERS");
  const trophyEsc = escapeDrawText("\uD83C\uDFC6");
  const ctaEsc = escapeDrawText(input.ctaText);

  const leaderboardLines = input.leaderboardLines || [];

  const filterParts = [
    `color=c=#1a1a2e:s=${W}x${H}:d=${duration},format=yuv420p[bg]`,
  ];

  const dt: string[] = [];
  dt.push(`drawtext=fontfile='${fontFile}':text='${introEsc}':fontcolor=#FFD700:fontsize=64:x=(w-text_w)/2:y=h*0.15:enable='between(t,0,3)':borderw=3:bordercolor=black@0.8`);

  for (let i = 0; i < Math.min(leaderboardLines.length, 5); i++) {
    const lineY = 0.25 + i * 0.12;
    const staggerStart = 3 + i * 0.5;
    dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText(leaderboardLines[i])}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=h*${lineY}:enable='between(t,${staggerStart},9)':borderw=2:bordercolor=black@0.7`);
  }

  dt.push(`drawtext=fontfile='${fontFile}':text='${ctaEsc}':fontcolor=#00FF88:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,9,${duration})':borderw=3:bordercolor=black@0.7`);

  filterParts.push(`[bg]${dt.join(",")}[textout]`);

  const args = [
    "-y",
    "-f", "lavfi", "-i", `color=c=#1a1a2e:s=${W}x${H}:d=${duration}`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", `[0:v]format=yuv420p,${dt.join(",")}[textout]`,
    "-map", "[textout]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-t", String(duration),
    "-shortest", "-movflags", "+faststart", videoPath,
  ];

  await runFFmpeg(args);
  await runFFmpeg(["-y", "-i", videoPath, "-ss", "4", "-vframes", "1", "-q:v", "2", thumbPath]);

  const stats = fs.statSync(videoPath);
  return { videoPath, thumbnailPath: thumbPath, durationSec: duration, width: W, height: H, sizeBytes: stats.size };
}

export async function renderEraWars(input: MultiCardRenderInput): Promise<RenderOutput> {
  const W = input.width || 1080;
  const H = input.height || 1920;
  const duration = input.durationSec || 12;
  const outputDir = input.outputDir;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const bgPath = path.join(outputDir, "bg.png");
  const videoPath = path.join(outputDir, "output.mp4");
  const thumbPath = path.join(outputDir, "thumbnail.jpg");

  await generateBlurredBackground(input.cardImagePaths[0], bgPath, W, H);

  const cardPaths: string[] = [];
  const cardSizes: { width: number; height: number }[] = [];
  for (let i = 0; i < Math.min(input.cardImagePaths.length, 2); i++) {
    const cp = path.join(outputDir, `era_card_${i}.png`);
    const size = await resizeCard(input.cardImagePaths[i], cp, W, H, 0.45);
    cardPaths.push(cp);
    cardSizes.push(size);
  }

  while (cardPaths.length < 2) {
    cardPaths.push(cardPaths[0]);
    cardSizes.push(cardSizes[0]);
  }

  const fontFile = FONT_PATH.replace(/:/g, "\\:");

  const eraLabel = escapeDrawText(input.eraLabel || "ERA WARS");
  const ctaEsc = escapeDrawText(input.ctaText);

  const card0X = Math.round(W * 0.05);
  const card1X = Math.round(W * 0.50);
  const cardYBase = Math.round((H - cardSizes[0].height) / 2);

  const filterParts = [
    `[0:v]loop=loop=${duration * 25}:size=1:start=0,setpts=N/25/TB,scale=${W}:${H},format=yuv420p[bg]`,
    `[1:v]scale=${cardSizes[0].width}:${cardSizes[0].height},format=yuva420p[era0]`,
    `[2:v]scale=${cardSizes[1].width}:${cardSizes[1].height},format=yuva420p[era1]`,
    `[bg][era0]overlay=${card0X}:${cardYBase}:enable='between(t,3,9)'[e0]`,
    `[e0][era1]overlay=${card1X}:${cardYBase}:enable='between(t,3,9)'[composed]`,
  ];

  const dt: string[] = [];
  dt.push(`drawtext=fontfile='${fontFile}':text='ERA WARS':fontcolor=#FF4444:fontsize=72:x=(w-text_w)/2:y=h*0.08:enable='between(t,0,3)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${eraLabel}':fontcolor=#FFD700:fontsize=56:x=(w-text_w)/2:y=h*0.20:enable='between(t,0,9)':borderw=3:bordercolor=black@0.7`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText("VS")}':fontcolor=#FF4444:fontsize=80:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,9)':borderw=4:bordercolor=black@0.8`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${escapeDrawText("Which era wins?")}':fontcolor=#FFD700:fontsize=44:x=(w-text_w)/2:y=h*0.82:enable='between(t,3,9)':borderw=3:bordercolor=black@0.7`);
  dt.push(`drawtext=fontfile='${fontFile}':text='${ctaEsc}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,9,${duration})':borderw=3:bordercolor=black@0.7`);

  filterParts.push(`[composed]${dt.join(",")}[textout]`);

  const ffArgs = ["-y", "-i", bgPath, "-i", cardPaths[0], "-i", cardPaths[1],
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", filterParts.join(";"),
    "-map", "[textout]", "-map", "3:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-pix_fmt", "yuv420p", "-t", String(duration),
    "-shortest", "-movflags", "+faststart", videoPath,
  ];

  await runFFmpeg(ffArgs);
  await runFFmpeg(["-y", "-i", videoPath, "-ss", "5", "-vframes", "1", "-q:v", "2", thumbPath]);

  cleanup(bgPath, ...cardPaths);
  const stats = fs.statSync(videoPath);
  return { videoPath, thumbnailPath: thumbPath, durationSec: duration, width: W, height: H, sizeBytes: stats.size };
}

function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

export function getRendererForTemplate(templateId: string): ((input: MultiCardRenderInput) => Promise<RenderOutput>) | null {
  switch (templateId) {
    case "only_real_fans":
      return renderOnlyRealFans;
    case "difficulty_ladder":
      return renderDifficultyLadder;
    case "memory_shock":
      return renderMemoryShock;
    case "pack_pull_drama":
      return renderPackPullDrama;
    case "leaderboard_flex":
      return renderLeaderboardFlex;
    case "era_wars":
      return renderEraWars;
    default:
      return null;
  }
}
