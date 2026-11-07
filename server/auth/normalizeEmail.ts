/** Lowercase, strip +aliases, and collapse Gmail dots. Same rules as account creation. */
export function normalizeEmail(email: string): string {
  const [localPart, domain] = email.toLowerCase().split("@");
  if (!localPart || !domain) return email.toLowerCase();

  if (domain === "gmail.com" || domain === "googlemail.com") {
    const cleanLocal = localPart.split("+")[0]?.replace(/\./g, "") || localPart;
    return `${cleanLocal}@${domain}`;
  }

  const cleanLocal = localPart.split("+")[0] || localPart;
  return `${cleanLocal}@${domain}`;
}
