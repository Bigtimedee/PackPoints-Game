import { z } from "zod";
import { eq } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { invalidateMaskSidecarsForGameSet } from "../masking/maskReadySidecar";

const UpdatePlayableSetSchema = z.object({
  sport: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  year: z.coerce.number().int().min(1850).max(2100).optional(),
  setName: z.string().min(1).optional(),
  cardhedgeSetQuery: z.string().nullable().optional(),
  cardhedgeCategory: z.string().nullable().optional(),
  marketplaceKeywords: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export class PlayableSetUpdateError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; details?: unknown },
  ) {
    super(typeof body.error === "string" ? body.error : "Playable set update failed");
  }
}

export async function updatePlayableSet(id: string, body: unknown) {
  let validated: z.infer<typeof UpdatePlayableSetSchema>;
  try {
    validated = UpdatePlayableSetSchema.parse(body);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new PlayableSetUpdateError(400, { error: "Invalid request parameters", details: error.errors });
    }
    throw error;
  }

  const updateData: Partial<typeof gameSets.$inferInsert> = {};
  if (validated.sport !== undefined) updateData.sport = validated.sport;
  if (validated.brand !== undefined) updateData.brand = validated.brand;
  if (validated.year !== undefined) updateData.year = validated.year;
  if (validated.setName !== undefined) updateData.setName = validated.setName;
  if (validated.cardhedgeSetQuery !== undefined) updateData.cardhedgeSetQuery = validated.cardhedgeSetQuery;
  if (validated.cardhedgeCategory !== undefined) updateData.cardhedgeCategory = validated.cardhedgeCategory;
  if (validated.marketplaceKeywords !== undefined) updateData.marketplaceKeywords = validated.marketplaceKeywords;
  if (validated.isActive !== undefined) updateData.isActive = validated.isActive;

  const [updated] = await db
    .update(gameSets)
    .set(updateData)
    .where(eq(gameSets.id, id))
    .returning();

  if (!updated) {
    throw new PlayableSetUpdateError(404, { error: "Playable set not found" });
  }

  if (updateData.isActive === false) {
    await invalidateMaskSidecarsForGameSet(id);
  }

  return updated;
}
