/**
 * Cards that are not one player. Deal paths and distractor pools both use this.
 * A Record Breaker / League Leaders / Team card whose name is one player stays in.
 */

function normalized(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isChecklistLabel(text: string): boolean {
  if (!text) return false;
  if (/^c\.?\s*l\.?$/i.test(text)) return true;
  return /\bcheck\s*lists?\b/i.test(text);
}

function isMultiPlayerList(text: string): boolean {
  if (!text) return false;
  if (/[/&]/.test(text)) return true;
  if (/\band\b/i.test(text)) return true;
  return (text.match(/,/g) || []).length >= 2;
}

/** Two to four words, no list punctuation, no non-player keywords. */
export function looksLikeSinglePlayer(text: string | null | undefined): boolean {
  const name = normalized(text);
  if (!name) return false;
  if (isChecklistLabel(name) || isMultiPlayerList(name)) return false;
  if (/\b(leaders?|record\s*breakers?|team\s+cards?)\b/i.test(name)) return false;
  const words = name.split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= 4;
}

function isTeamCardLabel(text: string): boolean {
  if (!text) return false;
  if (/^team$/i.test(text)) return true;
  return /\bteam\s+cards?\b/i.test(text);
}

function isLeadersLabel(text: string): boolean {
  return /\bleaders?\b/i.test(text);
}

function isRecordBreakerLabel(text: string): boolean {
  return /\brecord\s*breakers?\b/i.test(text);
}

export function isNonPlayerCard(
  name: string | null | undefined,
  title?: string | null,
): boolean {
  const nameText = normalized(name);
  const titleText = normalized(title);
  if (isChecklistLabel(nameText) || isChecklistLabel(titleText)) return true;
  if (isMultiPlayerList(nameText)) return true;
  if (looksLikeSinglePlayer(nameText)) return false;
  if (isTeamCardLabel(nameText) || isTeamCardLabel(titleText)) return true;
  if (isLeadersLabel(nameText) || isLeadersLabel(titleText)) return true;
  if (isRecordBreakerLabel(nameText) || isRecordBreakerLabel(titleText)) return true;
  return false;
}

export function omitNonPlayerNames(names: Array<string | null | undefined>): string[] {
  return names.filter((name): name is string => !!name && !isNonPlayerCard(name));
}

export function omitNonPlayerCards<T extends {
  player?: string | null;
  playerName?: string | null;
  description?: string | null;
}>(cards: T[]): T[] {
  return cards.filter((card) => !isNonPlayerCard(card.player ?? card.playerName, card.description));
}
