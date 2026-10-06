// Pure scan runner. No DB/network side effects except the injected, awaited dependencies.
export type AdminScanKind = "silhouettes" | "mismatches";
export interface ScanCard {
  id: string; imageUrl: string | null; player: string | null;
  contentVerified: boolean | null; cardhedgeCardId: string | null;
}
export interface ScanReport {
  totalCards: number; processed: number; scanned: number; checked: number;
  silhouettesFound: number; mismatches: number; blocked: number; verified: number;
  quarantined: number; skipped: number; errors: number;
  findings: Array<{ cardId: string; storedPlayer: string | null; apiPlayer: string | null }>;
  issues: Array<{ cardId: string; stage: string }>;
}
export function emptyScanReport(): ScanReport {
  return { totalCards: 0, processed: 0, scanned: 0, checked: 0, silhouettesFound: 0,
    mismatches: 0, blocked: 0, verified: 0, quarantined: 0, skipped: 0, errors: 0,
    findings: [], issues: [] };
}
export interface ScanDependencies {
  analyze: (url: string) => Promise<{ isPlaceholder: boolean; confidence: number; analysisFailed?: boolean }>;
  details: (id: string) => Promise<{ player?: string | null } | null>;
  // Boolean is actual returning-row confirmation, not an intention to mutate.
  verify: (card: ScanCard, valid: boolean) => Promise<boolean>;
  quarantine: (card: ScanCard, apiPlayer: string) => Promise<boolean>;
  progress: (report: ScanReport) => Promise<void>;
  delay: () => Promise<void>;
}
export function definitePlayerMismatch(stored: string | null, remote: string | null | undefined): boolean | null {
  const a = (stored ?? "").trim().toLowerCase();
  const b = (remote ?? "").trim().toLowerCase();
  if (!a || !b) return null; // missing metadata is an unknown, never a match
  return a !== b && !a.includes(b) && !b.includes(a);
}
export async function runAdminScan(kind: AdminScanKind, cards: ScanCard[], autoQuarantine: boolean,
  report: ScanReport, deps: ScanDependencies): Promise<void> {
  // Snapshot membership is stable, all rows included (missing metadata counted as skipped).
  report.totalCards = cards.length;
  await deps.progress(report);
  for (const card of cards) {
    let stage = "analysis";
    try {
      if (kind === "silhouettes") {
        if (!card.imageUrl) { report.skipped++; report.issues.push({ cardId: card.id, stage: "missing_image" }); }
        else {
          const result = await deps.analyze(card.imageUrl);
          if (result.analysisFailed) {
            report.errors++;
            report.issues.push({ cardId: card.id, stage: "analysis_unknown" });
          } else {
            report.scanned++;
            if (result.isPlaceholder && result.confidence >= 50) {
              report.silhouettesFound++;
              stage = "block_write";
              if (await deps.verify(card, false)) report.blocked++;
              else { report.skipped++; report.issues.push({ cardId: card.id, stage: "block_not_applied" }); }
            } else if (card.contentVerified === null) {
              stage = "verify_write";
              if (await deps.verify(card, true)) report.verified++;
              else { report.skipped++; report.issues.push({ cardId: card.id, stage: "verify_not_applied" }); }
            }
          }
        }
      } else {
        if (!card.cardhedgeCardId || !card.player?.trim()) {
          report.skipped++; report.issues.push({ cardId: card.id, stage: "missing_metadata" });
        } else {
          stage = "provider_details";
          const details = await deps.details(card.cardhedgeCardId);
          const mismatch = definitePlayerMismatch(card.player, details?.player);
          if (mismatch === null) {
            report.errors++; report.issues.push({ cardId: card.id, stage: "provider_details_missing" });
          } else {
            report.checked++;
            if (mismatch) {
              report.mismatches++;
              report.findings.push({ cardId: card.id, storedPlayer: card.player, apiPlayer: details!.player! });
              if (autoQuarantine) {
                stage = "quarantine_write";
                if (await deps.quarantine(card, details!.player!)) report.quarantined++;
                else { report.skipped++; report.issues.push({ cardId: card.id, stage: "quarantine_not_applied" }); }
              }
            }
          }
          await deps.delay();
        }
      }
    } catch {
      report.errors++; report.issues.push({ cardId: card.id, stage });
    }
    report.processed++;
    // Persist after each card. A failed checkpoint aborts the job; never silently keep writing.
    await deps.progress(report);
  }
}

export interface SetAvailability {
  holdReason: string | null; eligibleCards: number; eligibilityGatesSatisfied: boolean; reason: string | null;
}
// Holds stay mandatory; an Active flag or raw imported count cannot imply availability.
export function describeSetAvailability(active: boolean | null, userCreated: boolean | null,
  holdReason: string | null, eligibleCards: number, minimum: number): SetAvailability {
  const reason = !active ? "inactive" : userCreated ? "user_created" : holdReason
    ?? (eligibleCards < minimum ? "below_minimum_eligible_cards" : null);
  return { holdReason, eligibleCards, eligibilityGatesSatisfied: reason === null, reason };
}
