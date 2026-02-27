import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

// Load .env from both package cwd and backend root so running from apps/api or repo root both work.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  CORS_ORIGIN: z.string().default("*"),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().url().optional(),
  CLIENT_CHECKOUT_SUCCESS_URL: z.string().url().default("http://localhost:5173/checkout/success"),
  CLIENT_CHECKOUT_FAILURE_URL: z.string().url().default("http://localhost:5173/checkout/failure"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default("shop-with-seye/products")
});

export const env = envSchema.parse(process.env);
