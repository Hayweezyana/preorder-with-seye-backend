import { Worker } from "bullmq";
import { Redis } from "ioredis";
import nodemailer from "nodemailer";
import type {
  AdminOtpNotificationPayload,
  OrderStatusNotificationPayload,
  WishlistStockNotificationPayload
} from "./notificationQueue.js";

let embeddedWorker: Worker | null = null;

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const secure = (process.env.SMTP_SECURE ?? "true").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
}

const transporter = createTransporter();
const fromAddress = process.env.EMAIL_FROM ?? "Shop with Seye <shopws@immersiavr.com>";

function getOrderSubject(payload: OrderStatusNotificationPayload) {
  const subjectMap = {
    paid: `Payment Confirmed - ${payload.orderRef}`,
    shipped: `Order Shipped - ${payload.orderRef}`,
    delivered: `Order Delivered - ${payload.orderRef}`
  } as const;

  return subjectMap[payload.status];
}

function getOrderMessage(payload: OrderStatusNotificationPayload) {
  const introMap = {
    paid: "Your payment has been confirmed and we are preparing your order.",
    shipped: "Great news. Your order has been shipped.",
    delivered: "Your order has been marked as delivered."
  } as const;

  return {
    text: [
      `Hi ${payload.customerName || "Customer"},`,
      "",
      introMap[payload.status],
      `Order Reference: ${payload.orderRef}`,
      payload.trackingNumber ? `Tracking Number: ${payload.trackingNumber}` : null,
      payload.note ? `Update: ${payload.note}` : null,
      "",
      "Thank you for shopping with Shop with Seye."
    ]
      .filter(Boolean)
      .join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #172033; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Shop with Seye</h2>
        <p>Hi ${payload.customerName || "Customer"},</p>
        <p>${introMap[payload.status]}</p>
        <p><strong>Order Reference:</strong> ${payload.orderRef}</p>
        ${payload.trackingNumber ? `<p><strong>Tracking Number:</strong> ${payload.trackingNumber}</p>` : ""}
        ${payload.note ? `<p><strong>Update:</strong> ${payload.note}</p>` : ""}
        <p>Thank you for shopping with Shop with Seye.</p>
      </div>
    `
  };
}

async function processOrderStatusNotification(payload: OrderStatusNotificationPayload) {
  const subject = getOrderSubject(payload);
  const content = getOrderMessage(payload);

  if (!transporter) {
    console.warn("[api][worker] SMTP not configured. Logging order notification payload.", {
      to: payload.email,
      subject
    });
    return;
  }

  await transporter.sendMail({
    from: fromAddress,
    to: payload.email,
    subject,
    text: content.text,
    html: content.html
  });
}

function getOtpPurposeLabel(purpose: AdminOtpNotificationPayload["purpose"]) {
  if (purpose === "admin_register") {
    return "Admin Registration";
  }
  if (purpose === "admin_login") {
    return "Admin Login";
  }
  if (purpose === "customer_register") {
    return "Customer Registration";
  }
  if (purpose === "customer_reset") {
    return "Customer Password Reset";
  }
  return "Password Reset";
}

async function processAdminOtpNotification(payload: AdminOtpNotificationPayload) {
  const purposeLabel = getOtpPurposeLabel(payload.purpose);
  const subject = `Shop with Seye ${purposeLabel} OTP`;
  const text = [
    `Hi ${payload.firstName || "User"},`,
    "",
    `Your OTP for ${purposeLabel.toLowerCase()} is: ${payload.code}`,
    `This code expires in ${payload.expiresInMinutes} minutes.`,
    "",
    "If you did not request this, please ignore this email."
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; color: #172033; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Shop with Seye</h2>
      <p>Hi ${payload.firstName || "User"},</p>
      <p>Your OTP for <strong>${purposeLabel.toLowerCase()}</strong> is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${payload.code}</p>
      <p>This code expires in ${payload.expiresInMinutes} minutes.</p>
      <p>If you did not request this, please ignore this email.</p>
    </div>
  `;

  if (!transporter) {
    console.warn("[api][worker] SMTP not configured. Logging OTP payload.", {
      to: payload.email,
      purpose: payload.purpose
    });
    return;
  }

  await transporter.sendMail({
    from: fromAddress,
    to: payload.email,
    subject,
    text,
    html
  });
}

async function processWishlistStockNotification(payload: WishlistStockNotificationPayload) {
  const subject = payload.type === "low_stock" ? `Low stock: ${payload.productName}` : `Restocked: ${payload.productName}`;
  const text =
    payload.type === "low_stock"
      ? `Hi ${payload.firstName || "Customer"}, ${payload.productName} is running low (${payload.currentStock} left).`
      : `Hi ${payload.firstName || "Customer"}, ${payload.productName} is back in stock (${payload.currentStock} available).`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #172033; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Shop with Seye</h2>
      <p>${text}</p>
    </div>
  `;

  if (!transporter) {
    console.warn("[api][worker] SMTP not configured. Logging wishlist stock payload.", {
      to: payload.email,
      type: payload.type
    });
    return;
  }

  await transporter.sendMail({
    from: fromAddress,
    to: payload.email,
    subject,
    text,
    html
  });
}

function isEmbeddedWorkerEnabled() {
  const raw = (process.env.EMBED_NOTIFICATIONS_WORKER ?? "true").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

export function startEmbeddedNotificationWorker() {
  if (!isEmbeddedWorkerEnabled()) {
    console.log("[api][worker] embedded notifications worker disabled (EMBED_NOTIFICATIONS_WORKER=false)");
    return;
  }

  if (!process.env.REDIS_URL) {
    console.warn("[api][worker] REDIS_URL not set; embedded notifications worker not started.");
    return;
  }

  if (embeddedWorker) {
    return;
  }

  const connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
  });

  embeddedWorker = new Worker(
    "sws-notifications",
    async (job) => {
      if (job.name === "order-status") {
        await processOrderStatusNotification(job.data as OrderStatusNotificationPayload);
        return;
      }

      if (job.name === "admin-otp") {
        await processAdminOtpNotification(job.data as AdminOtpNotificationPayload);
        return;
      }

      if (job.name === "wishlist-stock") {
        await processWishlistStockNotification(job.data as WishlistStockNotificationPayload);
      }
    },
    { connection }
  );

  embeddedWorker.on("ready", () => {
    console.log("[api][worker] embedded notifications worker started");
  });

  embeddedWorker.on("failed", (job, error) => {
    console.error("[api][worker] job failed", {
      jobId: job?.id,
      jobName: job?.name,
      error: error.message
    });
  });

  embeddedWorker.on("error", (error) => {
    console.error("[api][worker] runtime error", error);
  });
}
