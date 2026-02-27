import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env.js";

type PaystackInitPayload = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl?: string;
  metadata: Record<string, unknown>;
};

export async function initializePaystackTransaction(payload: PaystackInitPayload) {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  const response = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email: payload.email,
      amount: payload.amountKobo,
      reference: payload.reference,
      callback_url: payload.callbackUrl,
      metadata: payload.metadata
    },
    {
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    }
  );

  if (!response.data?.status) {
    throw new Error("Failed to initialize Paystack transaction");
  }

  return response.data.data as { authorization_url: string; reference: string; access_code: string };
}

export async function verifyPaystackTransaction(reference: string) {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
    },
    timeout: 10000
  });

  if (!response.data?.status) {
    throw new Error("Failed to verify Paystack transaction");
  }

  return response.data.data as {
    reference: string;
    status: string;
    paid_at?: string;
    gateway_response?: string;
  };
}

export function verifyPaystackWebhookSignature(rawBody: Buffer, signature: string | undefined) {
  if (!env.PAYSTACK_WEBHOOK_SECRET) {
    return true;
  }

  const hash = crypto.createHmac("sha512", env.PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return hash === signature;
}
