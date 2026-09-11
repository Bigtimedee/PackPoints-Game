import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectPlaySetsOgHtml, isPlaySetsHtmlPath } from "./lib/playSetsOg";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("*", async (req, res) => {
    const htmlPath = path.resolve(distPath, "index.html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    if (!isPlaySetsHtmlPath(req.originalUrl)) {
      return res.sendFile(htmlPath);
    }
    try {
      const raw = await fs.promises.readFile(htmlPath, "utf8");
      const html = await injectPlaySetsOgHtml(raw, req.originalUrl);
      res.type("html").send(html);
    } catch {
      res.sendFile(htmlPath);
    }
  });
}
