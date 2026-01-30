/**
 * Batch Content Verification Script
 * Scans ALL playable cards and marks them as contentVerified=true if they pass
 * pixel-level content analysis (not silhouettes/placeholders).
 * 
 * This MUST run before any games can be played since cards default to contentVerified=false.
 */

import { db } from "../db";
import { playableCards } from "@shared/schema";
import { isNotNull, eq, and, sql } from "drizzle-orm";
import { analyzeImageContent } from "../services/imageContentAnalyzer";

const BATCH_SIZE = 50;
const PLACEHOLDER_CONFIDENCE_THRESHOLD = 60;

export async function verifyAllCards(): Promise<{
  verified: number;
  failed: number;
  skipped: number;
  total: number;
}> {
  console.log("[CardVerification] Starting batch content verification...");
  
  // Get all cards with images that haven't been verified yet
  const unverifiedCards = await db
    .select({
      id: playableCards.id,
      imageUrl: playableCards.imageUrl,
      player: playableCards.player,
    })
    .from(playableCards)
    .where(
      and(
        eq(playableCards.contentVerified, false),
        isNotNull(playableCards.imageUrl)
      )
    );
  
  console.log(`[CardVerification] Found ${unverifiedCards.length} unverified cards`);
  
  let verified = 0;
  let failed = 0;
  let skipped = 0;
  
  // Process in batches
  for (let i = 0; i < unverifiedCards.length; i += BATCH_SIZE) {
    const batch = unverifiedCards.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(async (card) => {
        if (!card.imageUrl) {
          return { cardId: card.id, status: "skipped" as const };
        }
        
        try {
          const analysis = await analyzeImageContent(card.imageUrl);
          
          if (analysis.isPlaceholder && analysis.confidence >= PLACEHOLDER_CONFIDENCE_THRESHOLD) {
            // This is a placeholder/silhouette - do NOT verify
            console.log(`[CardVerification] PLACEHOLDER: ${card.id.slice(0, 8)} - ${card.player?.slice(0, 20)} (${analysis.confidence}%)`);
            return { cardId: card.id, status: "failed" as const, reason: analysis.reasons[0] };
          } else {
            // Real card - mark as verified
            return { cardId: card.id, status: "verified" as const };
          }
        } catch (err: any) {
          console.error(`[CardVerification] Error analyzing ${card.id.slice(0, 8)}: ${err.message?.slice(0, 50)}`);
          return { cardId: card.id, status: "error" as const, reason: err.message };
        }
      })
    );
    
    // Process results and update database
    const verifiedIds: string[] = [];
    
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.status === "verified") {
          verifiedIds.push(result.value.cardId);
          verified++;
        } else if (result.value.status === "failed") {
          failed++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }
    
    // Batch update verified cards
    if (verifiedIds.length > 0) {
      await db
        .update(playableCards)
        .set({
          contentVerified: true,
          contentVerifiedAt: new Date(),
        })
        .where(sql`${playableCards.id} IN (${sql.join(verifiedIds.map(id => sql`${id}`), sql`, `)})`);
    }
    
    // Progress log
    const progress = Math.min(i + BATCH_SIZE, unverifiedCards.length);
    console.log(`[CardVerification] Progress: ${progress}/${unverifiedCards.length} (${verified} verified, ${failed} failed)`);
  }
  
  console.log(`[CardVerification] Complete: ${verified} verified, ${failed} failed, ${skipped} skipped`);
  
  return {
    verified,
    failed,
    skipped,
    total: unverifiedCards.length,
  };
}

// Quick verification for a single card (used during card import)
export async function verifyCard(cardId: string, imageUrl: string): Promise<boolean> {
  try {
    const analysis = await analyzeImageContent(imageUrl);
    
    if (analysis.isPlaceholder && analysis.confidence >= PLACEHOLDER_CONFIDENCE_THRESHOLD) {
      return false;
    }
    
    // Mark as verified
    await db
      .update(playableCards)
      .set({
        contentVerified: true,
        contentVerifiedAt: new Date(),
      })
      .where(eq(playableCards.id, cardId));
    
    return true;
  } catch (err) {
    console.error(`[CardVerification] Error verifying card ${cardId}:`, err);
    return false;
  }
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('verifyAllCards.ts');

if (isMainModule) {
  verifyAllCards()
    .then((result) => {
      console.log("Verification complete:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Verification failed:", err);
      process.exit(1);
    });
}
