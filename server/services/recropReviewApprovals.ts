/**
 * Writes Design-approved recrop cards into card_review_approvals.
 * Blocked recrop ids are never inserted. An existing qa row is left as-is.
 * A seed row is raised to qa, which is what 1988 Topps requires before a deal.
 */
import { eq, sql } from "drizzle-orm";
import { cardReviewApprovals } from "@shared/schema";
import { db } from "../db";
import {
  RECROP_APPROVED_1986_IDS,
  RECROP_APPROVED_1988_IDS,
  RECROP_BLOCKED_CARDS,
  RECROP_RELEASED_1988_IDS,
  TOPPS_1986_SET_ID,
  TOPPS_1988_SET_ID,
} from "../masking/toppsRecropReview";

const BLOCKED = new Set(RECROP_BLOCKED_CARDS.map((card) => card.id));
const NOTE_2026_10_22 = new Set([
  "ac72168d-b0db-4473-b73d-1fe571cce6ea",
  "88a0c3b1-6c5c-43ce-bdb1-e4f96a49cbce",
  "1fc4b7a9-1e46-4033-ab9d-964a137e5ab2",
  "ec64680a-1c30-462b-8fed-bdc5eec0feea",
  "0b826df2-d37d-4fd6-903b-7cbe4c018431",
  "cf42d7ed-f2c3-4570-a22f-5a5e0d7079f2",
  "f29cf4dc-3a12-4b61-92c4-a09fed6e23a7",
  "a2d516ea-933c-4bc2-8208-d41aeba4e9c8",
  "2e1c435c-792c-4c32-b147-f47954a16dbd",
  "2db6d654-4b81-403a-b7bc-1bf700abf820",
  "1260aac9-8dc9-4449-9dcf-31995e3bcc7b",
  "009d8ae1-906c-47f5-8bb0-895ed95c6ea2",
  "a78a4ee0-21a4-4543-bb52-e62aeacc3b85",
  "0b36a399-5d23-4ed4-b194-aa58fd25cf89",
  "8324b7d3-01a0-4d7d-8b59-a1eacddbef1f",
  "f20263a5-9f0a-43c8-91ab-10d521641602",
  "ba8db2f7-c485-4563-9714-71c6a810423f",
  "e7eb6dbd-6e98-419e-9435-301dca62ce13",
  "70d94da7-9a35-49db-a2a4-613935676414",
  "09f331ef-1fcb-45da-be6f-9e41a0090f30",
  "fc440551-583f-447c-b69d-d427475c0cb3",
  "b3e8a243-cd03-4eb0-b40e-ac4e82d43ab9",
  "7d5811c0-3b47-44c5-98bf-745bc0352018",
  "7564843c-7185-461c-be92-ec201da75913",
  "ab7c98c1-d0e7-4964-88fe-8e9e4f9d336a",
  "d5b2823a-9d3e-473d-8383-a9548ffa5bed",
  "f48b9dc3-b4aa-4415-b006-f7b61f01ca24",
  "5f75cab2-adb8-4a47-b47b-e47e3eed1957",
]);
const NOTE_2026_10_23 = new Set<string>(RECROP_RELEASED_1988_IDS);

export async function ensureRecropReviewApprovals(): Promise<number> {
  const values = [
    ...RECROP_APPROVED_1986_IDS.filter((id) => !BLOCKED.has(id)).map((cardId) => ({
      cardId,
      gameSetId: TOPPS_1986_SET_ID,
      source: "qa" as const,
      approvedBy: "Design",
      note: NOTE_2026_10_22.has(cardId) ? "Design recrop review 2026-10-22" : "Design recrop review 2026-10-20",
    })),
    ...RECROP_APPROVED_1988_IDS.filter((id) => !BLOCKED.has(id)).map((cardId) => ({
      cardId,
      gameSetId: TOPPS_1988_SET_ID,
      source: "qa" as const,
      approvedBy: "Design",
      note: NOTE_2026_10_23.has(cardId)
        ? "Design recrop review 2026-10-23"
        : NOTE_2026_10_22.has(cardId)
          ? "Design recrop review 2026-10-22"
          : "Design recrop review 2026-10-21",
    })),
  ];
  if (values.length === 0) return 0;
  const inserted = await db
    .insert(cardReviewApprovals)
    .values(values)
    .onConflictDoUpdate({
      target: cardReviewApprovals.cardId,
      set: {
        source: "qa",
        approvedBy: "Design",
        note: sql`excluded.note`,
        approvedAt: new Date(),
      },
      setWhere: eq(cardReviewApprovals.source, "seed"),
    })
    .returning({ id: cardReviewApprovals.cardId });
  return inserted.length;
}
