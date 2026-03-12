/**
 * Newsletter Service
 *
 * Sends weekly digest emails to opted-in users.
 * Integrates with the existing emailService.ts for delivery.
 */
import { pool } from '../db';

interface NewsletterData {
  topPlayers: Array<{ username: string; points: number; rank: number }>;
  hardestCard: { setName: string; year: string; wrongAnswerRate: number } | null;
  totalGamesThisWeek: number;
  newCardSetsCount: number;
}

async function gatherNewsletterData(): Promise<NewsletterData> {
  const [topPlayersResult, hardestCardResult, gamesResult] = await Promise.all([
    pool.query(
      `SELECT u.username, w.balance as points,
              RANK() OVER (ORDER BY w.balance DESC) as rank
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       ORDER BY w.balance DESC
       LIMIT 5`
    ),
    pool.query(
      `SELECT pc.set_name, pc.year,
              ROUND(
                COUNT(CASE WHEN ga.is_correct = false THEN 1 END)::numeric / NULLIF(COUNT(ga.id), 0) * 100,
                1
              ) as wrong_answer_rate
       FROM playable_cards pc
       JOIN game_answers ga ON ga.card_id = pc.id
       WHERE ga.created_at >= NOW() - INTERVAL '7 days'
         AND pc.is_active = true
       GROUP BY pc.id, pc.set_name, pc.year
       HAVING COUNT(ga.id) >= 10
       ORDER BY wrong_answer_rate DESC
       LIMIT 1`
    ),
    pool.query(
      `SELECT COUNT(*) as total FROM game_sessions WHERE created_at >= NOW() - INTERVAL '7 days'`
    ),
  ]);

  return {
    topPlayers: topPlayersResult.rows,
    hardestCard: hardestCardResult.rows[0] || null,
    totalGamesThisWeek: parseInt(gamesResult.rows[0]?.total || '0'),
    newCardSetsCount: 0, // Would need to track card set addition timestamps
  };
}

function buildNewsletterHtml(data: NewsletterData, unsubscribeToken: string, appUrl: string): string {
  const topPlayersHtml = data.topPlayers
    .map(p => `<tr><td>#${p.rank}</td><td>${p.username}</td><td>${p.points.toLocaleString()} pts</td></tr>`)
    .join('');

  const hardestCardHtml = data.hardestCard
    ? `<p>This week's hardest card: <strong>${data.hardestCard.setName} ${data.hardestCard.year}</strong> — ${data.hardestCard.wrongAnswerRate}% of players got it wrong!</p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>PackPTS Weekly Digest</title></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed;">PackPTS Weekly Digest</h1>
    <p style="color: #666;">Your weekly sports card trivia roundup</p>
  </div>

  <div style="background: #f9f5ff; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
    <h2 style="margin-top: 0;">This Week in Numbers</h2>
    <p><strong>${data.totalGamesThisWeek.toLocaleString()}</strong> games played this week</p>
    ${hardestCardHtml}
  </div>

  <div style="margin-bottom: 24px;">
    <h2>Top Players This Week</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #7c3aed; color: white;">
        <th style="padding: 8px; text-align: left;">Rank</th>
        <th style="padding: 8px; text-align: left;">Player</th>
        <th style="padding: 8px; text-align: left;">Points</th>
      </tr>
      ${topPlayersHtml}
    </table>
  </div>

  <div style="text-align: center; margin-bottom: 24px;">
    <a href="${appUrl}" style="background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
      Play PackPTS Now
    </a>
  </div>

  <div style="border-top: 1px solid #eee; padding-top: 16px; color: #999; font-size: 12px; text-align: center;">
    <p>You're receiving this because you opted in to the PackPTS newsletter.</p>
    <p><a href="${appUrl}/api/email/unsubscribe/${unsubscribeToken}" style="color: #999;">Unsubscribe</a></p>
  </div>
</body>
</html>`;
}

export async function sendWeeklyNewsletter(): Promise<{ sent: number; errors: number }> {
  const appUrl = process.env.APP_URL || 'https://packpts.com';

  // Get all opted-in users with unsubscribe tokens
  const usersResult = await pool.query(
    `SELECT id, email, username, newsletter_unsubscribe_token
     FROM users
     WHERE newsletter_opted_in = true
       AND email IS NOT NULL
       AND newsletter_unsubscribe_token IS NOT NULL
     ORDER BY id`
  );

  if (usersResult.rows.length === 0) {
    console.log('[Newsletter] No opted-in users found');
    return { sent: 0, errors: 0 };
  }

  const data = await gatherNewsletterData();
  let sent = 0;
  let errors = 0;

  // Dynamically import emailService to avoid circular deps
  const { sendEmail } = await import('./emailService');

  for (const user of usersResult.rows) {
    try {
      const html = buildNewsletterHtml(data, user.newsletter_unsubscribe_token, appUrl);
      await sendEmail({
        to: user.email,
        subject: `PackPTS Weekly Digest — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
        html,
      });
      sent++;
    } catch (err) {
      console.error(`[Newsletter] Failed to send to ${user.email}:`, err);
      errors++;
    }
  }

  console.log(`[Newsletter] Weekly digest sent: ${sent} delivered, ${errors} errors`);
  return { sent, errors };
}
