/**
 * Field-scoped game_sessions writes.
 * A whole-row update from a stale read rolls current_question_index backward
 * when replace-card races an advance. These statements never do that.
 */
import { pool } from "../db";

export async function replaceGameSessionQuestion(
  sessionId: string,
  index: number,
  question: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE game_sessions
     SET questions = jsonb_set(questions, ARRAY[$2::text], $3::jsonb, false)
     WHERE id = $1`,
    [sessionId, String(index), JSON.stringify(question)],
  );
}

export async function stampGameSessionQuestionFlag(
  sessionId: string,
  index: number,
  flag: string,
  value: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE game_sessions
     SET questions = jsonb_set(questions, ARRAY[$2::text, $3::text], to_jsonb($4::boolean), true)
     WHERE id = $1`,
    [sessionId, String(index), flag, value],
  );
}

export async function stampQuestionShownAt(
  sessionId: string,
  index: number,
  shownAt: string,
): Promise<void> {
  await pool.query(
    `UPDATE game_sessions
     SET questions = jsonb_set(questions, ARRAY[$2::text, 'shownAt'], to_jsonb($3::text), true)
     WHERE id = $1`,
    [sessionId, String(index), shownAt],
  );
}

/** Score and the answered element only. Does not write current_question_index. */
export async function commitSoloAnswer(input: {
  sessionId: string;
  questionIndex: number;
  question: unknown;
  score: number;
  correctAnswers: number;
  matchPointsAwarded: number;
}): Promise<void> {
  await pool.query(
    `UPDATE game_sessions
     SET score = $2,
         correct_answers = $3,
         match_points_awarded = $4,
         questions = jsonb_set(questions, ARRAY[$5::text], $6::jsonb, false)
     WHERE id = $1`,
    [
      input.sessionId,
      input.score,
      input.correctAnswers,
      input.matchPointsAwarded,
      String(input.questionIndex),
      JSON.stringify(input.question),
    ],
  );
}

/**
 * Compare-and-swap the index, and stamp shownAt on the new element.
 * questions is read from the locked row, so a concurrent replace is kept.
 */
export async function commitSoloAdvance(input: {
  sessionId: string;
  expectedIndex: number;
  skippedQuestions: number;
  shownAt: string | null;
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE game_sessions
     SET current_question_index = current_question_index + 1,
         skipped_questions = $3,
         questions = CASE
           WHEN $4::text IS NULL THEN questions
           WHEN jsonb_typeof(questions -> (current_question_index + 1)) = 'object'
             THEN jsonb_set(
               questions,
               ARRAY[(current_question_index + 1)::text, 'shownAt'],
               to_jsonb($4::text),
               true
             )
           ELSE questions
         END
     WHERE id = $1
       AND status = 'active'
       AND current_question_index = $2
     RETURNING current_question_index`,
    [input.sessionId, input.expectedIndex, input.skippedQuestions, input.shownAt],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Finish fields only. Leaves questions and current_question_index alone. */
export async function commitSoloComplete(input: {
  sessionId: string;
  score: number;
  skippedQuestions: number;
  completedAt: string;
}): Promise<void> {
  await pool.query(
    `UPDATE game_sessions
     SET status = 'completed',
         completed_at = $2,
         score = $3,
         skipped_questions = $4
     WHERE id = $1`,
    [input.sessionId, input.completedAt, input.score, input.skippedQuestions],
  );
}
