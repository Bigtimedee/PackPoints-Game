import { Resend } from 'resend';

let resend: Resend | null = null;
let emailConfigValid = false;

export async function verifyEmailConfig(): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log('[EmailService] RESEND_API_KEY not configured - email will be logged to console');
    emailConfigValid = false;
    return false;
  }

  resend = new Resend(apiKey);

  // Actually test the API key and check domain verification status
  try {
    const { data: domains, error } = await resend.domains.list();

    if (error) {
      console.error('[EmailService] RESEND_API_KEY is invalid or unauthorized:', error.message);
      emailConfigValid = false;
      return false;
    }

    const SENDING_DOMAIN = 'packpts.com';
    const verified = domains?.data?.find(
      (d: any) => d.name === SENDING_DOMAIN && d.status === 'verified'
    );

    if (!verified) {
      const found = domains?.data?.find((d: any) => d.name === SENDING_DOMAIN);
      if (!found) {
        console.error(
          `[EmailService] DOMAIN NOT ADDED: "${SENDING_DOMAIN}" is not listed in your Resend account. ` +
          'Go to https://resend.com/domains → Add Domain → add packpts.com → copy the DNS records to your DNS provider.'
        );
      } else {
        console.error(
          `[EmailService] DOMAIN NOT VERIFIED: "${SENDING_DOMAIN}" is in Resend but status="${found.status}". ` +
          'Go to https://resend.com/domains, select packpts.com, and add the required DNS records. ' +
          'Emails from noreply@packpts.com will fail until the domain is verified.'
        );
      }
      // Still allow the app to start, but flag as invalid
      emailConfigValid = false;
      return false;
    }

    emailConfigValid = true;
    console.log(`[EmailService] Resend configured successfully. Domain "${SENDING_DOMAIN}" is verified.`);
    return true;
  } catch (err: any) {
    console.error('[EmailService] Failed to connect to Resend API:', err.message);
    emailConfigValid = false;
    return false;
  }
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[EmailService] RESEND_API_KEY not configured. Email not sent.');
      return false;
    }
    resend = new Resend(apiKey);
  }

  try {
    const { error } = await resend.emails.send({
      from: 'PackPoints <noreply@packpts.com>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error(`[EmailService] Resend rejected email to ${options.to} — ${error.name}: ${error.message}`);
      return false;
    }

    console.log(`[EmailService] Email sent successfully to ${options.to}`);
    return true;
  } catch (error: any) {
    console.error('[EmailService] Failed to send email:', error.message);
    return false;
  }
}

export async function sendStreakReminderEmail(
  email: string,
  username: string,
  streakDays: number,
): Promise<boolean> {
  const siteUrl = process.env.SITE_URL || "https://packpts.com";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your streak is at risk!</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background-color: #18181b; padding: 24px; text-align: center;">
          <h1 style="color: #FFD700; margin: 0; font-size: 28px;">🔥 ${streakDays}-Day Streak</h1>
          <p style="color: #a1a1aa; margin: 8px 0 0; font-size: 14px;">PackPoints</p>
        </div>
        <div style="padding: 32px 24px;">
          <h2 style="color: #18181b; margin: 0 0 12px 0; font-size: 20px;">Don't break your streak, ${username}!</h2>
          <p style="color: #52525b; line-height: 1.6; margin: 0 0 24px 0;">
            You're on a <strong>${streakDays}-day streak</strong> — that's seriously impressive. Play today's card challenge to keep it alive and earn your daily streak bonus.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${siteUrl}" style="display: inline-block; background-color: #FFD700; color: #18181b; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-weight: 700; font-size: 16px;">
              Play Now &rarr;
            </a>
          </div>
          <p style="color: #71717a; font-size: 13px; line-height: 1.6; margin: 0; text-align: center;">
            Your streak resets at midnight. Don't let it slip!
          </p>
        </div>
        <div style="background-color: #fafafa; padding: 16px 24px; text-align: center;">
          <p style="color: #a1a1aa; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} PackPoints. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Don't break your streak, ${username}!

You're on a ${streakDays}-day streak. Play today to keep it alive: ${siteUrl}

Your streak resets at midnight.

- The PackPoints Team`;

  return sendEmail({
    to: email,
    subject: `🔥 Your ${streakDays}-day streak is at risk today`,
    html,
    text,
  });
}

export async function sendReEngagementEmail(
  email: string,
  username: string,
  daysSinceLastPlay: number,
  totalCardsIdentified: number,
): Promise<boolean> {
  const siteUrl = process.env.SITE_URL || "https://packpts.com";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>We miss you!</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background-color: #18181b; padding: 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">PackPoints</h1>
        </div>
        <div style="padding: 32px 24px;">
          <h2 style="color: #18181b; margin: 0 0 12px 0; font-size: 20px;">We miss you, ${username}!</h2>
          <p style="color: #52525b; line-height: 1.6; margin: 0 0 16px 0;">
            It's been <strong>${daysSinceLastPlay} days</strong> since your last game. You've identified <strong>${totalCardsIdentified.toLocaleString()} cards</strong> so far — that's a collection worth coming back to.
          </p>
          <p style="color: #52525b; line-height: 1.6; margin: 0 0 24px 0;">
            New cards hit the market every week. Jump back in and see what you've been missing.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${siteUrl}" style="display: inline-block; background-color: #18181b; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-weight: 700; font-size: 16px;">
              Play Today &rarr;
            </a>
          </div>
          <p style="color: #71717a; font-size: 13px; line-height: 1.6; margin: 0; text-align: center;">
            Daily players earn streak bonuses. Start a new streak today.
          </p>
        </div>
        <div style="background-color: #fafafa; padding: 16px 24px; text-align: center;">
          <p style="color: #a1a1aa; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} PackPoints. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `We miss you, ${username}!

It's been ${daysSinceLastPlay} days since your last game. You've identified ${totalCardsIdentified.toLocaleString()} cards — that's impressive!

Jump back in and see what's new: ${siteUrl}

- The PackPoints Team`;

  return sendEmail({
    to: email,
    subject: `It's been ${daysSinceLastPlay} days — come back to PackPoints`,
    html,
    text,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  baseUrl: string
): Promise<boolean> {
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background-color: #18181b; padding: 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">PackPoints</h1>
        </div>
        <div style="padding: 32px 24px;">
          <h2 style="color: #18181b; margin: 0 0 16px 0; font-size: 20px;">Reset Your Password</h2>
          <p style="color: #52525b; line-height: 1.6; margin: 0 0 24px 0;">
            We received a request to reset your password. Click the button below to create a new password. This link will expire in 1 hour.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetLink}" style="display: inline-block; background-color: #18181b; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 500;">
              Reset Password
            </a>
          </div>
          <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 0;">
            If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
          <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
          <p style="color: #a1a1aa; font-size: 12px; line-height: 1.6; margin: 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${resetLink}" style="color: #3b82f6; word-break: break-all;">${resetLink}</a>
          </p>
        </div>
        <div style="background-color: #fafafa; padding: 16px 24px; text-align: center;">
          <p style="color: #a1a1aa; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} PackPoints. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Reset Your Password

We received a request to reset your PackPoints password.

Click this link to reset your password: ${resetLink}

This link will expire in 1 hour.

If you didn't request this password reset, you can safely ignore this email.

- The PackPoints Team
  `.trim();

  return sendEmail({
    to: email,
    subject: 'Reset Your PackPoints Password',
    html,
    text,
  });
}

export async function sendMakerDigestEmail(
  email: string,
  username: string,
  setName: string,
  playCount: number,
): Promise<boolean> {
  const siteUrl = process.env.SITE_URL || "https://packpts.com";
  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: sans-serif; background: #f9f9f9; margin: 0; padding: 20px;">
      <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px;">
        <h2 style="margin-top: 0; color: #111;">Your set got played today</h2>
        <p style="color: #444;">Hey ${username},</p>
        <p style="color: #444;">
          Your set <strong>${setName}</strong> was played
          <strong>${playCount} time${playCount !== 1 ? "s" : ""}</strong> today on PackPTS.
        </p>
        <a href="${siteUrl}" style="display: inline-block; background: #6366f1; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 8px;">
          See your sets
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          You're getting this because you created a set on PackPTS. We send at most one digest per set per day.
        </p>
      </div>
    </body>
    </html>
  `;
  const text = `Hey ${username}, your set "${setName}" was played ${playCount} time${playCount !== 1 ? "s" : ""} today on PackPTS. Visit ${siteUrl} to see your sets.`;
  return sendEmail({ to: email, subject: `Your set "${setName}" got played today`, html, text });
}
