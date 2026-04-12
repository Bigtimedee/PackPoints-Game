/**
 * compositor.ts
 *
 * FFmpeg pipeline wrapper.
 * Takes an array of VideoFrames (SVG strings + durations) and produces
 * an H.264 MP4 at 1080×1920 (9:16 vertical) using:
 *   SVG → Sharp PNG → ffmpeg concat demuxer → MP4
 */
import path from "path";
import fs from "fs/promises";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
// @ts-ignore — ffmpeg-static has no named export in all TS configs
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath as string);
}

export interface VideoFrame {
  /** Raw SVG string. Must have width="1080" height="1920". */
  svgContent: string;
  /** How long this frame appears in the final video, in seconds. */
  durationSeconds: number;
}

/**
 * Render an array of SVG frames into a single MP4 at outputPath.
 * The caller is responsible for creating the parent directory.
 */
export async function compositeVideo(
  frames: VideoFrame[],
  outputPath: string,
): Promise<void> {
  if (frames.length === 0) throw new Error("compositeVideo: no frames provided");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "packpts-vid-"));

  try {
    // ── 1. Render each frame SVG → PNG ──────────────────────────────
    const pngPaths: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const pngPath = path.join(tmpDir, `frame${String(i).padStart(3, "0")}.png`);
      await sharp(Buffer.from(frames[i].svgContent), { density: 96 })
        .resize(1080, 1920, { fit: "fill" })
        .png({ compressionLevel: 1 })
        .toFile(pngPath);
      pngPaths.push(pngPath);
    }

    // ── 2. Build ffmpeg concat list ─────────────────────────────────
    // concat demuxer format: file + duration per entry; last file listed
    // twice (no duration) so the final frame is actually encoded.
    const lines: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      lines.push(`file '${pngPaths[i]}'`);
      lines.push(`duration ${frames[i].durationSeconds}`);
    }
    lines.push(`file '${pngPaths[pngPaths.length - 1]}'`);

    const concatPath = path.join(tmpDir, "concat.txt");
    await fs.writeFile(concatPath, lines.join("\n"));

    // ── 3. Ensure output directory exists ───────────────────────────
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // ── 4. Run ffmpeg ───────────────────────────────────────────────
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions([
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-crf", "23",
          "-preset", "fast",
          // Ensure exact 1080x1920; pad if necessary
          "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#0a0a18",
          "-movflags", "+faststart",
        ])
        .output(outputPath)
        .on("end", resolve)
        .on("error", (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
        .run();
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Capture the first frame SVG as a JPEG thumbnail at thumbnailPath.
 */
export async function captureThumbnail(
  firstFrame: VideoFrame,
  thumbnailPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
  await sharp(Buffer.from(firstFrame.svgContent), { density: 96 })
    .resize(1080, 1920, { fit: "fill" })
    .jpeg({ quality: 85 })
    .toFile(thumbnailPath);
}
