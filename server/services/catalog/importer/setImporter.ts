import { db } from "../../../db";
import { 
  cardSets, 
  catalogCards, 
  cardSetCards, 
  setImportJobs, 
  setImportJobLogs,
  CardSetSport 
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { cardHedgeProvider } from "../providers/cardhedge/cardhedgeProvider";
import { ProviderCard } from "../providers/types";

interface ImportProgress {
  totalPages: number;
  pagesFetched: number;
  cardsFound: number;
  cardsInserted: number;
  cardsLinked: number;
}

async function logJobEvent(
  jobId: string,
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  meta?: unknown
): Promise<void> {
  await db.insert(setImportJobLogs).values({
    jobId,
    level,
    message,
    meta: meta ? JSON.parse(JSON.stringify(meta)) : null,
  });
}

async function updateJobProgress(
  jobId: string,
  progress: Partial<ImportProgress>,
  status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL",
  lastError?: string
): Promise<void> {
  const updates: Record<string, unknown> = {};
  
  if (progress.totalPages !== undefined) updates.totalPages = progress.totalPages;
  if (progress.pagesFetched !== undefined) updates.pagesFetched = progress.pagesFetched;
  if (progress.cardsFound !== undefined) updates.cardsFound = progress.cardsFound;
  if (progress.cardsInserted !== undefined) updates.cardsInserted = progress.cardsInserted;
  if (progress.cardsLinked !== undefined) updates.cardsLinked = progress.cardsLinked;
  if (status) updates.status = status;
  if (lastError !== undefined) updates.lastError = lastError;
  if (status === "RUNNING" && !updates.startedAt) {
    updates.startedAt = new Date();
  }
  if (status === "SUCCEEDED" || status === "FAILED" || status === "PARTIAL") {
    updates.finishedAt = new Date();
  }

  await db.update(setImportJobs)
    .set(updates)
    .where(eq(setImportJobs.id, jobId));
}

async function upsertCard(
  card: ProviderCard,
  sport: CardSetSport | null,
  year: number | null,
  brand: string | null
): Promise<{ cardId: string; inserted: boolean }> {
  const existing = await db.select({ id: catalogCards.id })
    .from(catalogCards)
    .where(
      and(
        eq(catalogCards.provider, card.provider),
        eq(catalogCards.providerCardId, card.providerCardId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { cardId: existing[0].id, inserted: false };
  }

  const [inserted] = await db.insert(catalogCards)
    .values({
      provider: card.provider,
      providerCardId: card.providerCardId,
      sport: sport,
      year: year,
      brand: brand,
      setName: card.set || null,
      cardNumber: card.number || null,
      variant: card.variant || null,
      player: card.player || null,
      description: card.description || null,
      imageUrl: card.image || null,
      categoryRaw: card.category || null,
      setRaw: card.set || null,
      raw: card.raw,
    })
    .returning({ id: catalogCards.id });

  return { cardId: inserted.id, inserted: true };
}

async function linkCardToSet(
  setId: string,
  cardId: string
): Promise<boolean> {
  const existing = await db.select()
    .from(cardSetCards)
    .where(
      and(
        eq(cardSetCards.setId, setId),
        eq(cardSetCards.cardId, cardId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return false;
  }

  await db.insert(cardSetCards).values({
    setId,
    cardId,
  });

  return true;
}

export async function importSetFromCardHedge(setId: string, jobId: string): Promise<void> {
  const progress: ImportProgress = {
    totalPages: 0,
    pagesFetched: 0,
    cardsFound: 0,
    cardsInserted: 0,
    cardsLinked: 0,
  };

  try {
    await updateJobProgress(jobId, progress, "RUNNING");
    await logJobEvent(jobId, "INFO", "Import started");

    const [cardSet] = await db.select()
      .from(cardSets)
      .where(eq(cardSets.id, setId))
      .limit(1);

    if (!cardSet) {
      throw new Error(`Card set ${setId} not found`);
    }

    await logJobEvent(jobId, "INFO", `Importing set: ${cardSet.setName}`, {
      sport: cardSet.sport,
      year: cardSet.year,
      brand: cardSet.brand,
      keywords: cardSet.keywords,
    });

    const diagnosis = await cardHedgeProvider.diagnoseCoverage({ sport: cardSet.sport });
    await logJobEvent(jobId, "INFO", "Provider coverage diagnosis complete", {
      ok: diagnosis.ok,
      sampleCount: diagnosis.sampleCount,
      workingCategories: diagnosis.workingCategories,
      notes: diagnosis.notes,
    });

    const categoryToUse = diagnosis.workingCategories.length > 0 
      ? diagnosis.workingCategories[0] 
      : null;

    const queryStrings = buildQueryStrings(cardSet);
    await logJobEvent(jobId, "INFO", `Built ${queryStrings.length} query strings`, { queryStrings });

    const seenCardIds = new Set<string>();
    let emptyPageStreak = 0;
    const MAX_EMPTY_STREAK = 3;
    const PAGE_SIZE = 100;

    for (const queryString of queryStrings) {
      if (emptyPageStreak >= MAX_EMPTY_STREAK) {
        await logJobEvent(jobId, "INFO", `Stopping early: ${MAX_EMPTY_STREAK} consecutive pages with no new cards`);
        break;
      }

      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        try {
          await logJobEvent(jobId, "INFO", `Fetching page ${page} for query: "${queryString}"`, { 
            category: categoryToUse 
          });

          const result = await cardHedgeProvider.searchCards({
            search: queryString,
            category: categoryToUse,
            page,
            pageSize: PAGE_SIZE,
          });

          progress.pagesFetched++;
          progress.cardsFound += result.cards.length;
          progress.totalPages = Math.max(progress.totalPages, result.pages);

          let newCardsThisPage = 0;

          for (const card of result.cards) {
            if (!card.providerCardId || seenCardIds.has(card.providerCardId)) {
              continue;
            }
            seenCardIds.add(card.providerCardId);

            const { cardId, inserted } = await upsertCard(
              card,
              cardSet.sport,
              cardSet.year,
              cardSet.brand
            );

            if (inserted) {
              progress.cardsInserted++;
              newCardsThisPage++;
            }

            const linked = await linkCardToSet(setId, cardId);
            if (linked) {
              progress.cardsLinked++;
              newCardsThisPage++;
            }
          }

          await updateJobProgress(jobId, progress);

          if (newCardsThisPage === 0) {
            emptyPageStreak++;
          } else {
            emptyPageStreak = 0;
          }

          if (page >= result.pages || result.cards.length < PAGE_SIZE) {
            hasMorePages = false;
          } else if (emptyPageStreak >= MAX_EMPTY_STREAK) {
            hasMorePages = false;
          } else {
            page++;
          }

          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          await logJobEvent(jobId, "ERROR", `Error fetching page ${page}`, {
            query: queryString,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          hasMorePages = false;
        }
      }
    }

    const expectedCount = cardSet.expectedCardCount;
    let finalStatus: "SUCCEEDED" | "PARTIAL" = "PARTIAL";
    
    if (expectedCount && progress.cardsLinked >= expectedCount) {
      finalStatus = "SUCCEEDED";
    } else if (progress.cardsLinked >= 150 && emptyPageStreak >= MAX_EMPTY_STREAK) {
      finalStatus = "SUCCEEDED";
    } else if (progress.cardsLinked >= 50) {
      finalStatus = "PARTIAL";
    }

    await updateJobProgress(jobId, progress, finalStatus);
    await logJobEvent(jobId, "INFO", `Import completed with status: ${finalStatus}`, progress);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await updateJobProgress(jobId, progress, "FAILED", errorMessage);
    await logJobEvent(jobId, "ERROR", `Import failed: ${errorMessage}`);
    throw error;
  }
}

function buildQueryStrings(cardSet: {
  year: number;
  brand: string | null;
  setName: string;
  keywords: string[];
}): string[] {
  const queries: string[] = [];

  const primaryQuery = [
    cardSet.year.toString(),
    cardSet.brand,
    cardSet.setName,
  ].filter(Boolean).join(" ").trim();
  
  if (primaryQuery) {
    queries.push(primaryQuery);
  }

  for (const keyword of cardSet.keywords) {
    if (keyword && !queries.includes(keyword)) {
      queries.push(keyword);
    }
  }

  if (!queries.includes(cardSet.setName)) {
    queries.push(cardSet.setName);
  }

  return queries;
}

export async function createImportJob(setId: string): Promise<string> {
  const [job] = await db.insert(setImportJobs)
    .values({
      setId,
      provider: "cardhedge",
      status: "PENDING",
    })
    .returning({ id: setImportJobs.id });

  return job.id;
}

export async function getLatestJobForSet(setId: string) {
  const [job] = await db.select()
    .from(setImportJobs)
    .where(eq(setImportJobs.setId, setId))
    .orderBy(sql`${setImportJobs.createdAt} DESC`)
    .limit(1);

  return job || null;
}

export async function getJobLogs(jobId: string, limit = 100) {
  return db.select()
    .from(setImportJobLogs)
    .where(eq(setImportJobLogs.jobId, jobId))
    .orderBy(sql`${setImportJobLogs.createdAt} DESC`)
    .limit(limit);
}

export async function getSetCardCount(setId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(cardSetCards)
    .where(eq(cardSetCards.setId, setId));
  
  return Number(result[0]?.count ?? 0);
}
