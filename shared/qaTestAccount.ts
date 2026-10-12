/**
 * The one QA test account Design signs in as via POST /api/qa/session.
 * Fixed id: the route never takes a user id from the request.
 * Excluded from leaderboards, analytics and signup counts; blocked from
 * redemption, payouts and real purchases; never admin.
 */
export const QA_TEST_USER_ID = "qa-design-test-account";
export const QA_TEST_USERNAME = "qa_design_test";
export const QA_TEST_EMAIL = "qa-design-test@packpts.invalid";
export const QA_TEST_SEED_POINTS = 5000;
export const QA_TEST_SEED_KEY = "qa-test-account-seed-v1";

export function isQaTestUser(userId: string | null | undefined): boolean {
  return userId === QA_TEST_USER_ID;
}

/** POST paths the QA account may never hit: money in or out. */
export const QA_BLOCKED_POST_PATHS: RegExp[] = [
  /^\/api\/redeem(\/|$)/,
  /^\/api\/redemption\//,
  /^\/api\/marketplace\/redemption\//,
  /^\/api\/rebate\//,
  /^\/api\/founders-pass\/redeem/,
  /^\/api\/store\/(checkout|subscribe)/,
  /^\/api\/wager\//,
];

/** Read-only POSTs the QA account may use inside blocked prefixes. */
export const QA_READ_ONLY_POST_PATHS: RegExp[] = [/^\/api\/marketplace\/redemption\/quote-batch\/?$/];

export function qaBlockedPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  if (QA_READ_ONLY_POST_PATHS.some((re) => re.test(path))) return false;
  return QA_BLOCKED_POST_PATHS.some((re) => re.test(path));
}
