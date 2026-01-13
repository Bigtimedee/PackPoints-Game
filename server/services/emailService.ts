import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('Email credentials not configured. Email not sent.');
    console.log(`Would have sent email to ${options.to}: ${options.subject}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"PackPoints" <${process.env.GMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log(`Email sent successfully to ${options.to}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
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
