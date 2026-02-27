import { Queue } from "bullmq";
import { Redis } from "ioredis";

export type OrderStatusNotificationPayload = {
  tenantId: string;
  userId: string;
  email: string;
  customerName: string;
  orderId: string;
  orderRef: string;
  status: "paid" | "shipped" | "delivered";
  trackingNumber?: string | null;
  note?: string;
};

export type AdminOtpNotificationPayload = {
  email: string;
  firstName?: string;
  purpose: "admin_register" | "admin_login" | "admin_reset" | "customer_register" | "customer_reset";
  code: string;
  expiresInMinutes: number;
};

export type WishlistStockNotificationPayload = {
  email: string;
  firstName?: string;
  productName: string;
  type: "low_stock" | "restock";
  currentStock: number;
};

let queue: Queue | null = null;

function getQueue() {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (queue) {
    return queue;
  }

  const connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
  });

  queue = new Queue("sws-notifications", { connection });
  return queue;
}

export async function enqueueOrderStatusNotification(payload: OrderStatusNotificationPayload) {
  const notificationQueue = getQueue();
  if (!notificationQueue) {
    return { enqueued: false as const, reason: "REDIS_URL not set" };
  }

  await notificationQueue.add("order-status", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false
  });

  return { enqueued: true as const };
}

export async function enqueueAdminOtpNotification(payload: AdminOtpNotificationPayload) {
  const notificationQueue = getQueue();
  if (!notificationQueue) {
    return { enqueued: false as const, reason: "REDIS_URL not set" };
  }

  await notificationQueue.add("admin-otp", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false
  });

  return { enqueued: true as const };
}

export async function enqueueCustomerOtpNotification(
  payload: Omit<AdminOtpNotificationPayload, "purpose"> & { purpose: "customer_register" | "customer_reset" }
) {
  return enqueueAdminOtpNotification(payload);
}

export async function enqueueWishlistStockNotification(payload: WishlistStockNotificationPayload) {
  const notificationQueue = getQueue();
  if (!notificationQueue) {
    return { enqueued: false as const, reason: "REDIS_URL not set" };
  }

  await notificationQueue.add("wishlist-stock", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false
  });

  return { enqueued: true as const };
}
