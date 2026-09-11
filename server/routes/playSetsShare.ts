/**
 * Public Marketing + crawler endpoints for the play-integrated set share kit.
 * Contract: docs/PLAY_SETS_SHARE.md
 */
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import {
  PACKPTS_ORIGIN,
  PLAY_SETS_COPY,
  PLAY_SETS_UTM,
  absolutePackptsUrl,
  canonicalPlaySetsPath,
  parsePlaySetsSurface,
  playSetsKitPath,
  playSetsOgDescription,
  playSetsOgTitle,
  playSetsShareUrl,
  preferPlaySetsShareImage,
} from "@shared/playSetsShare";
import {
  letterboxPlaySetsOg,
  renderPlaySetsSharePng,
  resolvePlaySetsKitFile,
} from "../contentFactory/generatePlaySetsKit";
import { getShareOutputBase } from "../contentFactory/generateScoreCard";
import { ensurePlaySetsRuntimeCrop, resolvePlaySetsSet } from "../lib/resolvePlaySetsSet";

const router = Router();

function requestOrigin(req: Request): string {
  const host = req.get("host");
  if (!host || host.includes("localhost") || host.includes("127.0.0.1")) {
    return PACKPTS_ORIGIN;
  }
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${host}`;
}

async function kitPng(surface: ReturnType<typeof parsePlaySetsSurface>): Promise<Buffer> {
  const disk = resolvePlaySetsKitFile(surface);
  if (disk) return fs.promises.readFile(disk);
  return renderPlaySetsSharePng({ surface });
}

function generatedShareDiskPath(imageUrl: string): string | null {
  if (!imageUrl.startsWith("/generated/share/")) return null;
  const rel = imageUrl.replace("/generated/share/", "");
  if (rel.includes("..")) return null;
  return path.join(getShareOutputBase(), rel);
}

async function resolveSharePayload(req: Request) {
  const surface = parsePlaySetsSurface(req.query.surface);
  const wantKit = String(req.query.asset || "") === "kit";
  const setRef = typeof req.query.set === "string" ? req.query.set.trim() : "";
  const origin = requestOrigin(req);

  let setName: string | null = null;
  let slugOrId: string | null = setRef || null;
  let runtimeCoverUrl: string | undefined;

  if (setRef) {
    try {
      const set = await resolvePlaySetsSet(setRef);
      if (set) {
        setName = set.setName;
        slugOrId = set.slug;
        runtimeCoverUrl = set.shareImageUrl;
        if (!wantKit && !runtimeCoverUrl) {
          runtimeCoverUrl = await ensurePlaySetsRuntimeCrop(set, surface);
        }
      }
    } catch (err) {
      console.error("[PlaySetsShare] resolve failed:", (err as Error)?.message);
    }
  }

  const destinationPath = canonicalPlaySetsPath(slugOrId);
  const destination = playSetsShareUrl({ slugOrId, origin });
  const image = preferPlaySetsShareImage({
    runtimeCoverUrl,
    surface,
    wantKit,
  });
  const imageUrl = absolutePackptsUrl(image.path, origin);

  return {
    surface,
    setName,
    slugOrId,
    destinationPath,
    destination,
    imageKind: image.kind,
    imageUrl,
    caption: setName && surface === "beat_me_from_set"
      ? `Beat me on ${setName}.`
      : PLAY_SETS_COPY[surface].caption,
    og: {
      title: playSetsOgTitle({ surface, setName }),
      description: playSetsOgDescription({ surface, setName }),
      image: imageUrl,
      url: `${origin}${destinationPath}`,
    },
    runtimeCoverUrl,
    wantKit,
  };
}

router.get("/api/share/play-sets", async (req: Request, res: Response) => {
  try {
    const payload = await resolveSharePayload(req);
    res.json({
      surface: payload.surface,
      destination: payload.destination,
      destinationPath: payload.destinationPath,
      utm: PLAY_SETS_UTM,
      imageKind: payload.imageKind,
      imageUrl: payload.imageUrl,
      kitUrl: absolutePackptsUrl(playSetsKitPath(payload.surface), requestOrigin(req)),
      caption: payload.caption,
      og: payload.og,
      setName: payload.setName,
    });
  } catch (err) {
    console.error("[PlaySetsShare] JSON error:", (err as Error)?.message);
    res.status(500).json({ error: "Failed to resolve play-sets share" });
  }
});

async function sendShareImage(req: Request, res: Response, ogLetterbox: boolean) {
  const payload = await resolveSharePayload(req);
  let png: Buffer | null = null;

  if (payload.imageKind === "runtime" && payload.runtimeCoverUrl) {
    const disk = generatedShareDiskPath(payload.runtimeCoverUrl);
    if (disk && fs.existsSync(disk)) {
      png = await fs.promises.readFile(disk);
    } else if (payload.runtimeCoverUrl.startsWith("https://") && !ogLetterbox) {
      return res.redirect(302, payload.runtimeCoverUrl);
    }
  }

  if (!png) {
    png = await kitPng(payload.surface);
  }

  const out = ogLetterbox ? await letterboxPlaySetsOg(png) : png;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(out);
}

router.get("/api/share/play-sets/image", async (req: Request, res: Response) => {
  try {
    await sendShareImage(req, res, false);
  } catch (err) {
    console.error("[PlaySetsShare] image error:", (err as Error)?.message);
    res.status(500).json({ error: "Failed to render play-sets image" });
  }
});

router.get("/api/share/play-sets/og.png", async (req: Request, res: Response) => {
  try {
    await sendShareImage(req, res, true);
  } catch (err) {
    console.error("[PlaySetsShare] og error:", (err as Error)?.message);
    res.status(500).json({ error: "Failed to render play-sets OG image" });
  }
});

export default router;
