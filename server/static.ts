import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { injectPlaySetsOgHtml, isPlaySetsHtmlPath } from "./lib/playSetsOg";
import { ASSET_CACHE_CONTROL, sendNoStoreBody, stripConditionalValidators } from "./lib/noStoreResponse";
import { assetNotFoundLine, isAssetNotFound } from "./lib/httpErrorLog";
import { isViteHashedAsset } from "./lib/viteHashedAsset";
import { isSchemaReady } from "./startup/schemaGate";
import { schemaWindowHolds } from "./startup/schemaWindow";

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

function startupUnavailable(res: Response): void {
  res.setHeader("Retry-After", "2");
  res.status(503).json({ message: "Starting up", retryAfter: 2 });
}

/**
 * Production listen path. While the schema step is running this serves client
 * HTML and hashed assets only. Server routes outside `/api` get 503. Once the
 * schema is ready every request falls through so routes registered next, and
 * the catch-all mounted last, own the response.
 */
export function mountSchemaWindowSpa(app: Express, distPath: string): void {
  const htmlPath = path.resolve(distPath, "index.html");
  const assetsPath = path.join(distPath, "assets");

  if (fs.existsSync(assetsPath)) {
    const assetStatic = express.static(assetsPath, {
      fallthrough: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (isViteHashedAsset(filePath)) {
          res.setHeader("Cache-Control", ASSET_CACHE_CONTROL);
        }
      },
    });
    app.use("/assets", (req, res, next) => {
      if (isSchemaReady()) return next();
      assetStatic(req, res, next);
    });
    app.use("/assets", (err: { status?: number; statusCode?: number; code?: string }, req: Request, res: Response, next: NextFunction) => {
      if (isSchemaReady()) {
        next(err);
        return;
      }
      const fullPath = (req.originalUrl || `/assets${req.path}`).split("?")[0] || req.path;
      if (!isAssetNotFound(err, fullPath)) {
        next(err);
        return;
      }
      console.log(assetNotFoundLine(req.method, fullPath));
      if (!res.headersSent) res.status(404).end();
    });
  }

  const distStatic = express.static(distPath, { index: false });

  app.use((req, res, next) => {
    if (isSchemaReady()) return next();
    if (schemaWindowHolds(req.path)) {
      startupUnavailable(res);
      return;
    }
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/assets" || req.path.startsWith("/assets/")) return next();
    if (req.path === "/" || req.path === "/index.html") {
      sendSpaHtml(req, res, next, htmlPath);
      return;
    }
    distStatic(req, res, (err) => {
      if (err) {
        next(err);
        return;
      }
      if (res.headersSent) return;
      sendSpaHtml(req, res, next, htmlPath);
    });
  });
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

  // Mounted after server routes. Anything those routes did not answer is the SPA.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
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
