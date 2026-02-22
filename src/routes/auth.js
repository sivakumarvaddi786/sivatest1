import { Router } from "express";
import { body, validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import db from "../db/index.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.js";
import { enforceHttps } from "../middleware/httpsRedirect.js";
import { requireAuth } from "../middleware/requireAuth.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const router = Router();

// Apply HTTPS enforcement to all auth routes
router.use(enforceHttps);

/**
 * Password validation rules:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 number
 */
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

const registerValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
    .normalizeEmail(),
  body("password")
    .isString()
    .withMessage("Password must be a string.")
    .matches(PASSWORD_REGEX)
    .withMessage(
      "Password must be at least 8 characters long, contain at least one uppercase letter, and at least one number."
    ),
];

/**
 * POST /api/auth/register
 *
 * Registers a new user account.
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Responses:
 *   201 - Account created; verification email sent
 *   400 - Validation error
 *   409 - Email already registered
 *   500 - Internal server error
 */
router.post("/register", registerValidation, async (req, res) => {
  // 1. Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { email, password } = req.body;

  try {
    // 2. Check for duplicate email
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({
        error: "An account with this email address already exists.",
      });
    }

    // 3. Hash the password with bcrypt (cost factor 12)
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Create the user record
    const userId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, last_active_at, email_verified)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run(userId, email, passwordHash, now, now);

    // 5. Create an email verification token (expires in 24 hours)
    const verificationToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO email_verifications (id, user_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uuidv4(), userId, verificationToken, expiresAt, now);

    // 6. Send verification email (non-blocking — don't fail registration if email fails)
    sendVerificationEmail(email, verificationToken).catch((err) => {
      console.error("[Email] Failed to send verification email to", email, err.message);
    });

    return res.status(201).json({
      message:
        "Account created successfully. Please check your email to verify your account.",
      userId,
    });
  } catch (err) {
    console.error("[Register] Unexpected error:", err);
    return res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

/**
 * GET /api/auth/verify-email?token=...
 *
 * Verifies a user's email address using the token from the verification email.
 *
 * Query params:
 *   token - The unique verification token
 *
 * Responses:
 *   200 - Email verified successfully
 *   400 - Missing, invalid, expired, or already-used token
 *   500 - Internal server error
 */
router.get("/verify-email", (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: "Verification token is required." });
  }

  try {
    const verification = db
      .prepare("SELECT * FROM email_verifications WHERE token = ?")
      .get(token);

    if (!verification) {
      return res.status(400).json({ error: "Invalid verification token." });
    }

    if (verification.used) {
      return res
        .status(400)
        .json({ error: "This verification link has already been used." });
    }

    if (new Date(verification.expires_at) < new Date()) {
      return res.status(400).json({
        error:
          "This verification link has expired. Please request a new one.",
      });
    }

    // Mark token used and user verified in a single transaction
    db.transaction(() => {
      db.prepare("UPDATE email_verifications SET used = 1 WHERE id = ?").run(
        verification.id
      );
      db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(
        verification.user_id
      );
    })();

    return res.json({
      message:
        "Email verified successfully. You can now access your account.",
    });
  } catch (err) {
    console.error("[Verify Email] Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

/**
 * POST /api/auth/resend-verification
 *
 * Resends the email verification link to the given address.
 * Uses a generic response to avoid email enumeration.
 *
 * Request body:
 *   { email: string }
 *
 * Responses:
 *   200 - Verification email sent (or no-op for unknown/already-verified addresses)
 *   400 - Validation error or email already verified
 *   500 - Internal server error
 */
router.post(
  "/resend-verification",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("A valid email address is required.")
      .normalizeEmail(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors
          .array()
          .map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { email } = req.body;

    try {
      const user = db
        .prepare("SELECT id, email_verified FROM users WHERE email = ?")
        .get(email);

      // Generic response prevents email enumeration
      if (!user) {
        return res.json({
          message:
            "If an account with this email exists and is unverified, a new verification email has been sent.",
        });
      }

      if (user.email_verified) {
        return res
          .status(400)
          .json({ error: "This email address is already verified." });
      }

      // Invalidate any existing unused tokens for this user
      db.prepare(
        "UPDATE email_verifications SET used = 1 WHERE user_id = ? AND used = 0"
      ).run(user.id);

      // Create a fresh token (expires in 24 hours)
      const verificationToken = uuidv4();
      const now = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString();

      db.prepare(
        `INSERT INTO email_verifications (id, user_id, token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), user.id, verificationToken, expiresAt, now);

      // Send email non-blocking
      sendVerificationEmail(email, verificationToken).catch((err) => {
        console.error(
          "[Email] Failed to resend verification email to",
          email,
          err.message
        );
      });

      return res.json({
        message:
          "If an account with this email exists and is unverified, a new verification email has been sent.",
      });
    } catch (err) {
      console.error("[Resend Verification] Unexpected error:", err);
      return res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    }
  }
);

/**
 * POST /api/auth/forgot-password
 *
 * Initiates a password reset by sending a reset link to the given email.
 * Uses a generic response to prevent email enumeration.
 *
 * Request body:
 *   { email: string }
 *
 * Responses:
 *   200 - Reset email sent (or no-op for unknown addresses)
 *   400 - Validation error
 *   500 - Internal server error
 */
router.post(
  "/forgot-password",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("A valid email address is required.")
      .normalizeEmail(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { email } = req.body;

    // Generic response regardless of whether the email exists
    const GENERIC_RESPONSE = {
      message:
        "If an account with this email exists, a password reset link has been sent.",
    };

    try {
      const user = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(email);

      if (!user) {
        return res.json(GENERIC_RESPONSE);
      }

      // Invalidate any existing unused reset tokens for this user
      db.prepare(
        "UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0"
      ).run(user.id);

      // Create a fresh token (expires in 1 hour)
      const resetToken = uuidv4();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      db.prepare(
        `INSERT INTO password_resets (id, user_id, token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), user.id, resetToken, expiresAt, now);

      // Send email non-blocking
      sendPasswordResetEmail(email, resetToken).catch((err) => {
        console.error(
          "[Email] Failed to send password reset email to",
          email,
          err.message
        );
      });

      return res.json(GENERIC_RESPONSE);
    } catch (err) {
      console.error("[Forgot Password] Unexpected error:", err);
      return res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    }
  }
);

/**
 * POST /api/auth/reset-password
 *
 * Resets the user's password using a valid reset token.
 *
 * Request body:
 *   { token: string, password: string }
 *
 * Responses:
 *   200 - Password reset successfully
 *   400 - Validation error, missing/invalid/expired/used token
 *   500 - Internal server error
 */
router.post(
  "/reset-password",
  [
    body("token").isString().notEmpty().withMessage("Reset token is required."),
    body("password")
      .isString()
      .withMessage("Password must be a string.")
      .matches(PASSWORD_REGEX)
      .withMessage(
        "Password must be at least 8 characters long, contain at least one uppercase letter, and at least one number."
      ),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { token, password } = req.body;

    try {
      const reset = db
        .prepare("SELECT * FROM password_resets WHERE token = ?")
        .get(token);

      if (!reset) {
        return res
          .status(400)
          .json({ error: "Invalid or expired password reset link." });
      }

      if (reset.used) {
        return res
          .status(400)
          .json({ error: "This password reset link has already been used." });
      }

      if (new Date(reset.expires_at) < new Date()) {
        return res.status(400).json({
          error:
            "This password reset link has expired. Please request a new one.",
        });
      }

      // Hash the new password
      const passwordHash = await bcrypt.hash(password, 12);

      // Update password and mark token used in a single transaction
      db.transaction(() => {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
          passwordHash,
          reset.user_id
        );
        db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(
          reset.id
        );
      })();

      return res.json({
        message:
          "Password reset successfully. You can now log in with your new password.",
      });
    } catch (err) {
      console.error("[Reset Password] Unexpected error:", err);
      return res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    }
  }
);

const loginValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
    .normalizeEmail(),
  body("password")
    .isString()
    .notEmpty()
    .withMessage("Password is required."),
];

/**
 * POST /api/auth/login
 *
 * Authenticates a user and issues a session token.
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Responses:
 *   200 - Login successful; returns session token
 *   400 - Validation error
 *   401 - Invalid credentials
 *   403 - Email not verified
 *   500 - Internal server error
 */
router.post("/login", loginValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const { email, password } = req.body;

  try {
    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    // Use constant-time comparison even on missing user to prevent timing attacks
    const passwordToCheck = user ? user.password_hash : "$2a$12$invalidhashfortimingprotection";
    const passwordMatch = await bcrypt.compare(password, passwordToCheck);

    if (!user || !passwordMatch) {
      return res
        .status(401)
        .json({ error: "Invalid email or password." });
    }

    if (!user.email_verified) {
      return res.status(403).json({
        error:
          "Email verification required. Please check your inbox or request a new verification email.",
      });
    }

    // Create a new session (30-day sliding expiry)
    const sessionToken = uuidv4();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

    db.prepare(
      `INSERT INTO sessions (id, user_id, token, expires_at, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), user.id, sessionToken, expiresAt, now, now);

    return res.json({
      message: "Login successful.",
      token: sessionToken,
      expiresAt,
    });
  } catch (err) {
    console.error("[Login] Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

/**
 * POST /api/auth/logout
 *
 * Invalidates the current session token.
 *
 * Requires: Authorization: Bearer <token>
 *
 * Responses:
 *   200 - Logged out successfully
 *   401 - Not authenticated
 *   500 - Internal server error
 */
router.post("/logout", requireAuth, (req, res) => {
  try {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(req.sessionId);
    return res.json({ message: "Logged out successfully." });
  } catch (err) {
    console.error("[Logout] Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again." });
  }
});

export default router;
