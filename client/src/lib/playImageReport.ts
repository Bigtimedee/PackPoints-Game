/** Play scopes that can be reported without a raw card id. */
export const PLAY_REPORT_SCOPES = ["solo", "d5", "ad5", "match"] as const;
export type PlayReportScope = (typeof PLAY_REPORT_SCOPES)[number];

export type MaskedPlayIdentity = {
  scope: PlayReportScope;
  sessionId: string;
  questionIndex: number;
  token: string;
};

const MASKED_PLAY_URL = /\/api\/play\/m\/(solo|d5|ad5|match)\/([^/?#]+)\/(\d{1,3})\/([^/?#]+)/;

export function maskIdentityFromPlayUrl(url: string): MaskedPlayIdentity | null {
  const match = MASKED_PLAY_URL.exec(url);
  if (!match) return null;
  const index = Number(match[3]);
  if (!Number.isInteger(index)) return null;
  let sessionId = match[2];
  try {
    sessionId = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!sessionId) return null;
  return {
    scope: match[1] as PlayReportScope,
    sessionId,
    questionIndex: index,
    token: match[4],
  };
}

export type PlayImageReportInput = {
  imageUrl?: string;
  cardId?: string | null;
  scope?: PlayReportScope;
  sessionId?: string;
  questionIndex?: number;
  reason: string;
  description?: string;
  autoDetected?: boolean;
  detectionReason?: string;
};

/**
 * Bad-image report that does not put a card id on the wire when the play
 * URL or session coordinates can identify the dealt card.
 */
export function playImageReportRequest(
  args: PlayImageReportInput,
): { url: string; body: Record<string, unknown> } | null {
  const fromUrl = args.imageUrl ? maskIdentityFromPlayUrl(args.imageUrl) : null;
  const scope = fromUrl?.scope ?? args.scope;
  const sessionId = fromUrl?.sessionId ?? args.sessionId;
  const questionIndex = fromUrl?.questionIndex ?? args.questionIndex;
  const body: Record<string, unknown> = { reason: args.reason };
  if (args.description) body.description = args.description;
  if (args.autoDetected) body.autoDetected = true;
  if (args.detectionReason) body.detectionReason = args.detectionReason;

  if (scope && sessionId && Number.isInteger(questionIndex)) {
    body.scope = scope;
    body.sessionId = sessionId;
    body.questionIndex = questionIndex;
    if (fromUrl?.token) body.token = fromUrl.token;
    return { url: "/api/play/report", body };
  }

  if (args.cardId) {
    if (sessionId) body.sessionId = sessionId;
    return { url: `/api/cards/${encodeURIComponent(args.cardId)}/report`, body };
  }

  return null;
}
