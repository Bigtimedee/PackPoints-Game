import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { injectPlaySetsOgHtml, isPlaySetsHtmlPath } from "./lib/playSetsOg";
import { ASSET_CACHE_CONTROL, sendNoStoreBody, stripConditionalValidators } from "./lib/noStoreResponse";
import { assetNotFoundLine, isAssetNotFound } from "./lib/httpErrorLog";
import { isViteHashedAsset } from "./lib/viteHashedAsset";

async function readSpaHtml(htmlPath: string, url: string): Promise<string> {
  const raw = await fs.promises.readFile(htmlPath, "utf8");
  if (!isPlaySetsHtmlPath(url)) return raw;
  return injectPlaySetsOgHtml(raw, url);
}

function sendSpaHtml(req: Request, res: Response, next: NextFunction, htmlPath: string): void {
  stripConditionalValidators(req);
  readSpaHtml(htmlPath, req.originalUrl)
    .then((html) => {
      if (res.headersSent) return;
      sendNoStoreBody(req, res, html, "text/html; charset=utf-8");
    })
    .catch(next);
}

export function mountSpaStatic(app: Express, distPath: string): void {
  const htmlPath = path.resolve(distPath, "index.html");
  const assetsPath = path.join(distPath, "assets");

  if (fs.existsSync(assetsPath)) {
    app.use("/assets", express.static(assetsPath, {
      fallthrough: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (isViteHashedAsset(filePath)) {
          res.setHeader("Cache-Control", ASSET_CACHE_CONTROL);
        }
      },
    }));
    app.use("/assets", (err: { status?: number; statusCode?: number; code?: string }, req: Request, res: Response, next: NextFunction) => {
      const fullPath = (req.originalUrl || `/assets${req.path}`).split("?")[0] || req.path;
      if (!isAssetNotFound(err, fullPath)) {
        next(err);
        return;
      }
      console.log(assetNotFoundLine(req.method, fullPath));
      if (!res.headersSent) res.status(404).end();
    });
  }

  const sendIndex = (req: Request, res: Response, next: NextFunction) => {
    sendSpaHtml(req, res, next, htmlPath);
  };

  app.get(["/", "/index.html"], sendIndex);

  app.use(express.static(distPath, {
    index: false,
  }));

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Mounted before API routes so the shell is up during the schema step.
    // Those routes still have to run.
    if (
      req.path === "/api"
      || req.path.startsWith("/api/")
      || req.path.startsWith("/ws")
      || req.path === "/health"
      || req.path.startsWith("/webhooks")
      || req.path.startsWith("/generated")
    ) {
      return next();
    }
    sendSpaHtml(req, res, next, htmlPath);
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  mountSpaStatic(app, distPath);
}
