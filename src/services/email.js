import nodemailer from "nodemailer";

/**
 * Creates a nodemailer transporter based on environment configuration.
 * Falls back to Ethereal (test SMTP) when EMAIL_HOST is not configured.
 */
async function createTransporter() {
  if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // Development fallback: Ethereal test account
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  console.log(
    "[Email] No EMAIL_HOST configured — using Ethereal test account:",
    testAccount.user
  );

  return transporter;
}

let _transporter = null;

async function getTransporter() {
  if (!_transporter) {
    _transporter = await createTransporter();
  }
  return _transporter;
}

const FROM = process.env.EMAIL_FROM || '"LifePush" <noreply@lifepush.app>';
const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

/**
 * Sends an email verification link to a newly registered user.
 *
 * @param {string} toEmail - Recipient email address
 * @param {string} verificationToken - The unique verification token
 * @returns {Promise<void>}
 */
export async function sendVerificationEmail(toEmail, verificationToken) {
  const verifyUrl = `${BASE_URL}/api/auth/verify-email?token=${verificationToken}`;

  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: "Verify your LifePush account",
    text: `Welcome to LifePush!\n\nPlease verify your email address by clicking the link below:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can safely ignore this email.`,
    html: `
      <h2>Welcome to LifePush!</h2>
      <p>Please verify your email address to get started.</p>
      <p>
        <a href="${verifyUrl}" style="
          display: inline-block;
          padding: 12px 24px;
          background-color: #22c55e;
          color: white;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
        ">Verify Email Address</a>
      </p>
      <p>Or copy and paste this link into your browser:<br>
        <a href="${verifyUrl}">${verifyUrl}</a>
      </p>
      <p>This link expires in 24 hours.</p>
      <p style="color: #6b7280; font-size: 12px;">
        If you did not create a LifePush account, you can safely ignore this email.
      </p>
    `,
  });

  if (process.env.NODE_ENV !== "production") {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log("[Email] Preview URL:", previewUrl);
    }
  }
}

/**
 * Sends a password reset link to the given email address.
 *
 * @param {string} toEmail - Recipient email address
 * @param {string} resetToken - The unique password reset token
 * @returns {Promise<void>}
 */
export async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetUrl = `${BASE_URL}/api/auth/reset-password?token=${resetToken}`;

  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: "Reset your LifePush password",
    text: `You requested a password reset for your LifePush account.\n\nClick the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request a password reset, you can safely ignore this email. Your password will not change.`,
    html: `
      <h2>Reset your LifePush password</h2>
      <p>You requested a password reset for your LifePush account.</p>
      <p>
        <a href="${resetUrl}" style="
          display: inline-block;
          padding: 12px 24px;
          background-color: #22c55e;
          color: white;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
        ">Reset Password</a>
      </p>
      <p>Or copy and paste this link into your browser:<br>
        <a href="${resetUrl}">${resetUrl}</a>
      </p>
      <p>This link expires in 1 hour.</p>
      <p style="color: #6b7280; font-size: 12px;">
        If you did not request a password reset, you can safely ignore this email. Your password will not change.
      </p>
    `,
  });

  if (process.env.NODE_ENV !== "production") {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log("[Email] Preview URL:", previewUrl);
    }
  }
}
