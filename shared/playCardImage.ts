/**
 * Play-loop image src. Mask stays on until a successful answer submit.
 * The reveal URL is the short-lived token from the submit ACK — never a raw card id.
 * GameCard stays dumb: parents pass this URL; they do not teach GameCard to fetch originals.
 */
export function resolvePlayCardSrc(opts: {
  maskedUrl: string;
  revealUrl?: string | null;
  submitted: boolean;
}): string {
  if (opts.submitted && opts.revealUrl) return opts.revealUrl;
  return opts.maskedUrl;
}
