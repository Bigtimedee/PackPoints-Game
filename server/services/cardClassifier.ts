export interface CardClassification {
  isPlayable: boolean;
  blockedReason: string | null;
}

export interface CardInput {
  player: string | null | undefined;
  description: string | null | undefined;
}

const LEADERS_PATTERN = /\bleaders?\b/i;
const ALL_STAR_PATTERN = /\ball[-\s]?stars?\b/i;
const TEAM_CARD_PATTERN = /\b(team|club)\s*(card|photo|portrait|picture)?\b/i;
const PROSPECTS_PATTERN = /\b(prospects?|future\s*stars?|rookie\s*stars?|rising\s*stars?|draft\s*picks?)\b/i;
const AWARDS_PATTERN = /\b(award\s*winners?|mvp\s*candidates?|gold\s*glove|silver\s*slugger)\b/i;
const HIGHLIGHTS_PATTERN = /\b(season\s*highlights?|highlight\s*reel|record\s*breakers?)\b/i;
const COMBO_PATTERN = /\b(combo|dual|triple|quad|super\s*star)\b/i;
const CLUBHOUSE_PATTERN = /\bclubhouse\b/i;

export function classifyCard(card: CardInput): CardClassification {
  const player = (card.player || '').trim();
  const description = (card.description || '').trim();

  if (!player) {
    return { isPlayable: false, blockedReason: 'no-player' };
  }

  const checklistPattern = /\bcheck\s*list\b|\bchk\s*list\b|\bchecklist\b/i;
  if (checklistPattern.test(player) || checklistPattern.test(description)) {
    return { isPlayable: false, blockedReason: 'checklist' };
  }

  if (LEADERS_PATTERN.test(player) || LEADERS_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'leaders' };
  }

  if (ALL_STAR_PATTERN.test(player) || ALL_STAR_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'all-stars' };
  }

  if ((TEAM_CARD_PATTERN.test(player) || TEAM_CARD_PATTERN.test(description)) && !looksLikeSinglePlayerName(player)) {
    return { isPlayable: false, blockedReason: 'team-card' };
  }

  if (PROSPECTS_PATTERN.test(player) || PROSPECTS_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'prospects' };
  }

  if (AWARDS_PATTERN.test(player) || AWARDS_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'awards' };
  }

  if (HIGHLIGHTS_PATTERN.test(player) || HIGHLIGHTS_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'highlights' };
  }

  if (COMBO_PATTERN.test(player) || COMBO_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'combo-card' };
  }

  if (CLUBHOUSE_PATTERN.test(player) || CLUBHOUSE_PATTERN.test(description)) {
    return { isPlayable: false, blockedReason: 'clubhouse' };
  }

  if (isMultiPlayerCard(player)) {
    return { isPlayable: false, blockedReason: 'multi-player' };
  }

  return { isPlayable: true, blockedReason: null };
}

function looksLikeSinglePlayerName(text: string): boolean {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2 || words.length > 4) {
    return false;
  }
  
  const teamKeywords = /\b(team|club|leaders?|all[-\s]?stars?|photo|card|picture|portrait)\b/i;
  if (teamKeywords.test(text)) {
    return false;
  }
  
  return true;
}

function isMultiPlayerCard(player: string): boolean {
  if (player.includes('/')) {
    return true;
  }

  if (player.includes('&')) {
    return true;
  }

  const lowerPlayer = player.toLowerCase();
  
  if (/\band\b/.test(lowerPlayer) && !isLastFirstFormat(player)) {
    return true;
  }

  const commaCount = (player.match(/,/g) || []).length;
  
  if (commaCount === 1) {
    return false;
  }
  
  if (commaCount >= 2) {
    return true;
  }

  return false;
}

function isLastFirstFormat(name: string): boolean {
  const commaCount = (name.match(/,/g) || []).length;
  if (commaCount !== 1) {
    return false;
  }
  
  const parts = name.split(',').map(p => p.trim());
  if (parts.length !== 2) {
    return false;
  }
  
  const [lastName, firstName] = parts;
  
  const hasNoMultiPlayerSeparators = 
    !firstName.includes('/') && 
    !firstName.includes('&') && 
    !/\band\b/i.test(firstName);
  
  const isReasonableLength = lastName.length >= 2 && firstName.length >= 2;
  
  if (!hasNoMultiPlayerSeparators || !isReasonableLength) {
    return false;
  }
  
  const lastNameWords = lastName.split(/\s+/).filter(w => w.length > 0);
  const firstNameWords = firstName.split(/\s+/).filter(w => w.length > 0);
  
  if (lastNameWords.length >= 2 && firstNameWords.length >= 2) {
    const hasJr = /\b(jr\.?|sr\.?|ii|iii|iv)\b/i.test(firstName);
    if (!hasJr) {
      return false;
    }
  }
  
  if (lastNameWords.length > 3 || firstNameWords.length > 3) {
    return false;
  }
  
  return true;
}

export function classifyCards(cards: CardInput[]): Map<number, CardClassification> {
  const results = new Map<number, CardClassification>();
  cards.forEach((card, index) => {
    results.set(index, classifyCard(card));
  });
  return results;
}
