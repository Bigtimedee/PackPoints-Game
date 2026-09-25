import type { Request, Response } from "express";
import { isPlayScope, maskTokenMatches, type PlayScope } from "./playImageToken";

/**
 * Which dealt card a report names.
 * No token: the card currently at that index.
 * A mask token for a replaced card stays on that card (solo `replacedFromIds`),
 * not the portrait that took its place.
 */
export function pickReportedCardId(args: {
  scope: PlayScope;
  sessionId: string;
  index: number;
  token?: string;
  currentCardId: string | null;
  priorCardIds?: string[];
}): string | null {
  if (!args.token) return args.currentCardId;
  if (args.currentCardId && maskTokenMatches(args.scope, args.sessionId, args.index, args.currentCardId, args.token)) {
    return args.currentCardId;
  }
  for (const id of args.priorCardIds ?? []) {
    if (id && maskTokenMatches(args.scope, args.sessionId, args.index, id, args.token)) return id;
  }
  return null;
}

export async function handlePlayImageReport(
  req: Request,
  res: Response,
  deps: {
    resolveCard: (scope: PlayScope, sessionId: string, index: number, token?: string) => Promise<string | null>;
    submit: (req: Request, res: Response, cardId: string) => Promise<void>;
  },
): Promise<void> {
  const body = req.body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid report" });
    return;
  }
  const record = body as Record<string, unknown>;
  const scope = typeof record.scope === "string" ? record.scope : "";
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
  const questionIndex = Number(record.questionIndex);
  const token = typeof record.token === "string" && record.token.length > 0 ? record.token : undefined;
  if (
    !isPlayScope(scope)
    || sessionId.length === 0
    || sessionId.length > 200
    || !Number.isInteger(questionIndex)
    || questionIndex < 0
    || questionIndex > 200
  ) {
    res.status(400).json({ error: "Invalid report" });
    return;
  }

  const cardId = await deps.resolveCard(scope, sessionId, questionIndex, token);
  if (!cardId) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  delete record.cardId;
  delete record.questionIndex;
  delete record.token;
  delete record.scope;
  req.params.cardId = cardId;
  await deps.submit(req, res, cardId);
}
