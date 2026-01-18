export interface CardClassification {
  isPlayable: boolean;
  blockedReason: string | null;
}

export interface CardInput {
  player: string | null | undefined;
  description: string | null | undefined;
}

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

  if (isMultiPlayerCard(player)) {
    return { isPlayable: false, blockedReason: 'multi-player' };
  }

  return { isPlayable: true, blockedReason: null };
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
