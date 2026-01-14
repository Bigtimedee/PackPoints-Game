import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;
let emailConfigValid = false;

function createTransporter(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  
  if (!user || !pass) {
    console.warn('[EmailService] GMAIL_USER or GMAIL_APP_PASSWORD not configured');
    return null;
  }
  
  // Log credential info for debugging (masked)
  console.log(`[EmailService] Configuring with user: ${user}`);
  console.log(`[EmailService] App password length: ${pass.length} characters`);
  
  if (pass.includes(' ')) {
    console.warn('[EmailService] WARNING: App password contains spaces - these should be removed');
  }
  
  if (pass.length !== 16) {
    console.warn(`[EmailService] WARNING: App password should be 16 characters, got ${pass.length}`);
  }
  
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

export async function verifyEmailConfig(): Promise<boolean> {
  transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EmailService] Email not configured - reset links will be logged to console');
    emailConfigValid = false;
    return false;
  }
  
  try {
    await transporter.verify();
    console.log('[EmailService] Gmail SMTP connection verified successfully');
    emailConfigValid = true;
    return true;
  } catch (error: any) {
    console.error('[EmailService] Gmail SMTP verification failed:');
    
    if (error.code === 'EAUTH') {
      console.error('[EmailService] Authentication failed. Possible causes:');
      console.error('  1. App Password is incorrect (should be 16 chars, no spaces)');
      console.error('  2. Using regular password instead of App Password');
      console.error('  3. 2-Step Verification not enabled on Google account');
      console.error('  4. GMAIL_USER does not match the account with the App Password');
    } else {
      console.error(`[EmailService] Error: ${error.message}`);
    }
    
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
  if (!transporter || !emailConfigValid) {
    // Try to reinitialize if not set up
    if (!transporter) {
      transporter = createTransporter();
    }
    
    if (!transporter) {
      console.warn('[EmailService] Email not configured. Email not sent.');
      return false;
    }
  }

  try {
    const info = await transporter.sendMail({
      from: `"PackPoints" <${process.env.GMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log(`[EmailService] Email sent successfully to ${options.to} (messageId: ${info.messageId})`);
    return true;
  } catch (error: any) {
    console.error('[EmailService] Failed to send email:', error.message);
    
    if (error.code === 'EAUTH') {
      console.error('[EmailService] Authentication failed - check GMAIL_USER and GMAIL_APP_PASSWORD');
      console.error('[EmailService] Make sure to use an App Password (16 chars, no spaces)');
    }
    
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
