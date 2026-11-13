import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const USER_A_EMAIL = process.env.TEST_USER_A_EMAIL || process.env.TEST_EMAIL_A || "";
const USER_A_PASSWORD = process.env.TEST_USER_A_PASSWORD || process.env.TEST_PASSWORD_A || "";
const USER_B_EMAIL = process.env.TEST_USER_B_EMAIL || process.env.TEST_EMAIL_B || "";
const USER_B_PASSWORD = process.env.TEST_USER_B_PASSWORD || process.env.TEST_PASSWORD_B || "";

const BASE_URL = process.env.BASE_URL || "http://localhost:5001";

test.skip(
  !USER_A_EMAIL || !USER_A_PASSWORD || !USER_B_EMAIL || !USER_B_PASSWORD,
  "Set TEST_USER_A_EMAIL/TEST_USER_A_PASSWORD and TEST_USER_B_EMAIL/TEST_USER_B_PASSWORD env vars to run."
);

async function loginViaApi(context: BrowserContext, usernameOrEmail: string, password: string) {
  const res = await context.request.post(`${BASE_URL}/api/auth/local-login`, {
    data: { usernameOrEmail, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${usernameOrEmail}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function answerCurrentQuestion(page: Page) {
  const firstOption = page.locator('[data-testid="button-option-0"]');
  await firstOption.waitFor({ state: "visible", timeout: 20_000 });
  await firstOption.click();
  const submit = page.locator('[data-testid="button-submit-answer"]');
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  }
}

async function playMatchToCompletion(page: Page) {
  for (let i = 0; i < 10; i++) {
    await answerCurrentQuestion(page);
    // Wait for either the next question (option button enabled again on new idx)
    // or the match result screen.
    const matchResult = page.locator('[data-testid="text-match-result"]');
    const battleResult = page.locator('[data-testid="text-battle-result"]');
    if (i < 9) {
      await page.waitForFunction(
        () => {
          const optBtns = Array.from(
            document.querySelectorAll('[data-testid^="button-option-"]')
          ) as HTMLButtonElement[];
          if (optBtns.length === 0) return false;
          return optBtns.some((b) => !b.disabled);
        },
        null,
        { timeout: 60_000 }
      );
    } else {
      await Promise.race([
        matchResult.waitFor({ state: "visible", timeout: 60_000 }),
        battleResult.waitFor({ state: "visible", timeout: 60_000 }),
      ]);
    }
  }
}

test.describe("Persistent 1v1 Battle Session", () => {
  test("two users play 3 consecutive matches without re-inviting, then one disconnect ends the battle", async ({
    browser,
  }) => {
    test.setTimeout(8 * 60_000);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const userA = await loginViaApi(ctxA, USER_A_EMAIL, USER_A_PASSWORD);
    const userB = await loginViaApi(ctxB, USER_B_EMAIL, USER_B_PASSWORD);
    expect(userA?.user?.id || userA?.id, "userA login returned id").toBeTruthy();
    expect(userB?.user?.id || userB?.id, "userB login returned id").toBeTruthy();

    // Both users land on the queue page so they receive FRIEND_MATCH_ACCEPTED
    // and auto-navigate to /match/:matchId.
    await pageA.goto(`${BASE_URL}/queue`);
    await pageB.goto(`${BASE_URL}/queue`);

    // User A invites User B via the friends API directly (UI-agnostic).
    const userBId = userB?.user?.id || userB?.id;
    const inviteRes = await ctxA.request.post(`${BASE_URL}/api/matches/friends/invite`, {
      data: { toUserId: userBId, bucket: "ANY" },
    });
    expect(inviteRes.ok(), `invite create: ${inviteRes.status()}`).toBeTruthy();
    const invite = await inviteRes.json();
    const inviteId = invite?.invite?.id || invite?.inviteId;
    expect(inviteId, "inviteId returned").toBeTruthy();

    // User B accepts.
    const acceptRes = await ctxB.request.post(`${BASE_URL}/api/matches/friends/respond`, {
      data: { inviteId, action: "ACCEPT" },
    });
    expect(acceptRes.ok(), `invite accept: ${acceptRes.status()}`).toBeTruthy();
    const acceptBody = await acceptRes.json();
    expect(acceptBody.sessionId, "accept returns sessionId").toBeTruthy();
    expect(acceptBody.matchId, "accept returns matchId").toBeTruthy();

    // Both pages should auto-navigate to /match/:matchId via FRIEND_MATCH_ACCEPTED.
    await pageA.waitForURL(`**/match/${acceptBody.matchId}`, { timeout: 20_000 });
    await pageB.waitForURL(`**/match/${acceptBody.matchId}`, { timeout: 20_000 });

    // Battle header should appear on both
    await expect(pageA.getByTestId("battle-header")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId("battle-header")).toBeVisible({ timeout: 20_000 });

    // Play Match 1
    await Promise.all([playMatchToCompletion(pageA), playMatchToCompletion(pageB)]);

    // Battle Play Again buttons should be visible
    await expect(pageA.getByTestId("button-play-again")).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByTestId("button-leave-battle")).toBeVisible();
    await expect(pageB.getByTestId("button-play-again")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByTestId("button-leave-battle")).toBeVisible();

    // Both click Play Again
    await pageA.getByTestId("button-play-again").click();
    await pageB.getByTestId("button-play-again").click();

    // Both should land on a NEW match URL
    await pageA.waitForURL((url) => url.pathname !== `/match/${acceptBody.matchId}` && url.pathname.startsWith("/match/"), { timeout: 30_000 });
    await pageB.waitForURL((url) => url.pathname.startsWith("/match/"), { timeout: 30_000 });

    const match2A = pageA.url();
    const match2B = pageB.url();
    expect(match2A, "page A on new match").not.toBe(`${BASE_URL}/match/${acceptBody.matchId}`);
    expect(match2A).toBe(match2B);

    // Play Match 2
    await Promise.all([playMatchToCompletion(pageA), playMatchToCompletion(pageB)]);

    await expect(pageA.getByTestId("button-play-again")).toBeVisible({ timeout: 15_000 });
    await pageA.getByTestId("button-play-again").click();
    await pageB.getByTestId("button-play-again").click();

    await pageA.waitForURL((url) => url.pathname !== match2A && url.pathname.startsWith("/match/"), { timeout: 30_000 });
    await pageB.waitForURL((url) => url.pathname !== match2B && url.pathname.startsWith("/match/"), { timeout: 30_000 });

    // Play Match 3
    await Promise.all([playMatchToCompletion(pageA), playMatchToCompletion(pageB)]);
    await expect(pageA.getByTestId("button-play-again")).toBeVisible({ timeout: 15_000 });

    // Now User B closes their tab — should end the battle and notify User A.
    await pageB.close();

    await expect(pageA.getByTestId("text-battle-result")).toHaveText(/Battle Ended/i, {
      timeout: 20_000,
    });
    await expect(pageA.getByTestId("text-battle-reason")).toContainText(/disconnect|left/i);

    await ctxA.close();
    await ctxB.close();
  });
});
