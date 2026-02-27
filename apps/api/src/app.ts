import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { router } from "./router.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
  app.use("/api/v1/payments/paystack/webhook", express.raw({ type: "application/json" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "api", timestamp: new Date().toISOString() });
  });

  app.use("/api/v1", router);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: "Internal server error", detail: err.message });
  });

  return app;
}
