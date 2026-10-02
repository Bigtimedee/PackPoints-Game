import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { gameSessionsTable } from "@shared/schema";
import { db } from "../db";
import { commitSoloAdvance, replaceGameSessionQuestion } from "../lib/sessionWrite";

function question(id: string) {
  return {
    card: { id, playableCardId: id, playerName: "Ken Phelps" },
    options: ["Ken Phelps", "A", "B", "C"],
    correctAnswer: "Ken Phelps",
    pointValue: 40,
  };
}

describe("replace-card does not roll back the question index", () => {
  const ids: string[] = [];

  afterAll(async () => {
    for (const id of ids) {
      await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id, id));
    }
  });

  async function seed() {
    const id = randomUUID();
    ids.push(id);
    await db.insert(gameSessionsTable).values({
      id,
      mode: "solo",
      questions: [question("c0"), question("c1"), question("c2")],
      currentQuestionIndex: 0,
      score: 0,
      correctAnswers: 0,
      totalQuestions: 3,
      status: "active",
      startedAt: new Date().toISOString(),
    });
    return id;
  }

  async function read(id: string) {
    const [row] = await db.select().from(gameSessionsTable).where(eq(gameSessionsTable.id, id));
    return row;
  }

  it("keeps an interleaved advance when the question element is replaced", async () => {
    await Promise.all(Array.from({ length: 8 }, async () => {
      const id = await seed();
      const replacement = question("replacement");
      await Promise.all([
        commitSoloAdvance({
          sessionId: id,
          expectedIndex: 0,
          skippedQuestions: 0,
          shownAt: "2026-09-26T00:00:00.000Z",
        }),
        replaceGameSessionQuestion(id, 0, replacement),
      ]);
      const row = await read(id);
      expect(row.currentQuestionIndex).toBe(1);
      const questions = row.questions as Array<{ card: { id: string } }>;
      expect(questions[0].card.id).toBe("replacement");
      expect(questions[1].card.id).toBe("c1");
      expect(questions[2].card.id).toBe("c2");
    }));
  });
});
