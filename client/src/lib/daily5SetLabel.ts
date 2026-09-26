/** Share caption for the Daily 5 score card. Periods separate the parts. */
export function formatDaily5ShareText(correctCount: number, setName: string | null | undefined): string {
  const name = setName?.trim();
  if (name) return `Daily 5. ${name}. ${correctCount}/5.`;
  return `Daily 5. ${correctCount}/5.`;
}

/** Header line. Two spaces separate the label from the set title. */
export function formatTodaysSetLabel(setName: string): string {
  return `TODAY'S SET  ${setName.trim().toUpperCase()}`;
}
