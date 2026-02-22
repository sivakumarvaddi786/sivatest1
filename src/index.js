import "dotenv/config";
import express from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.js";
import onboardingRouter from "./routes/onboarding.js";
import dashboardRouter from "./routes/dashboard.js";
import usersRouter from "./routes/users.js";
import habitsRouter from "./routes/habits.js";
import teamsRouter from "./routes/teams.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Security: set recommended HTTP headers
app.use(helmet());

// Trust the first proxy (required for X-Forwarded-Proto HTTPS detection behind nginx/load balancer)
app.set("trust proxy", 1);

// Parse JSON request bodies
app.use(express.json());

// Mount routes
app.use("/api/auth", authRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/users", usersRouter);
app.use("/api/habits", habitsRouter);
app.use("/api/teams", teamsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`[Server] LifePush API running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
  if (process.env.FORCE_HTTPS === "true") {
    console.log("[Server] HTTPS enforcement: ENABLED");
  }
});

export default app;
