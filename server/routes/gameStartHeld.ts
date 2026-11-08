/**
 * First decision of POST /api/game/start. A held set is 404 before a session
 * is created. Invalid bodies are 400. Anything else returns false so the
 * rest of the route continues.
 */
import type { Request, Response } from "express";
import type { ZodError } from "zod";
import { startGameSchema } from "@shared/schema";
import { ensureHeldSets, isHeldSet } from "../config/heldSets";

function formatZodError(zodError: ZodError): string {
  const first = zodError.errors[0];
  if (first) {
    return first.message !== "Required" ? first.message : `${first.path.join(".")} is required`;
  }
  return "Invalid request";
}

export async function respondIfHeldGameStart(req: Request, res: Response): Promise<boolean> {
  const parsed = startGameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error), details: parsed.error.errors });
    return true;
  }
  await ensureHeldSets();
  if (parsed.data.setId && isHeldSet(parsed.data.setId)) {
    res.status(404).json({ error: "Set not found" });
    return true;
  }
  return false;
}
