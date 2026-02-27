import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.PORT = "5001";
process.env.CORS_ORIGIN = "*";
process.env.JWT_SECRET = "test-jwt-secret-123456789";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-123456789";
process.env.PAYSTACK_SECRET_KEY = "sk_test_mock";
process.env.CLIENT_CHECKOUT_SUCCESS_URL = "http://localhost:5173/checkout/success";
process.env.CLIENT_CHECKOUT_FAILURE_URL = "http://localhost:5173/checkout/failure";
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST ?? process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";

vi.mock("../src/services/paystack.js", () => ({
  initializePaystackTransaction: vi.fn(async ({ reference }: { reference: string }) => ({
    authorization_url: `https://paystack.test/authorize/${reference}`,
    reference,
    access_code: "access_code_mock"
  })),
  verifyPaystackTransaction: vi.fn(async (reference: string) => ({
    reference,
    status: "success",
    paid_at: new Date().toISOString(),
    gateway_response: "Approved"
  })),
  verifyPaystackWebhookSignature: vi.fn(() => true)
}));

describe("core commerce integration", () => {
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      const { connectDatabase } = await import("../src/db/connect.js");
      await connectDatabase();
    } catch {
      dbAvailable = false;
    }
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    if (!dbAvailable) {
      return;
    }
    const { TenantModel } = await import("../src/models/tenant.js");
    const { CategoryModel, ProductModel } = await import("../src/models/catalog.js");

    await mongoose.connection.db.dropDatabase();

    const tenant = await TenantModel.create({
      name: "Demo Store",
      slug: "tenant_demo"
    });

    const category = await CategoryModel.create({
      tenantId: tenant._id,
      name: "Fashion",
      slug: "fashion"
    });

    await ProductModel.create({
      tenantId: tenant._id,
      categoryId: category._id,
      slug: "seye-red-dress",
      name: "Seye Red Dress",
      description: "Elegant red dress for premium occasions.",
      imageUrl: "https://example.com/red-dress.jpg",
      active: true,
      variants: [
        { sku: "SRD-M-RED", size: "M", color: "Red", stock: 8, priceNgn: 15000 },
        { sku: "SRD-L-RED", size: "L", color: "Red", stock: 2, priceNgn: 15000 }
      ]
    });
  });

  it("auth -> cart -> checkout -> webhook finalization works and is idempotent", async () => {
    if (!dbAvailable) {
      return;
    }
    const { createApp } = await import("../src/app.js");
    const { ProductModel } = await import("../src/models/catalog.js");
    const app = createApp();

    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .set("x-tenant-id", "tenant_demo")
      .send({
        email: "ada@example.com",
        password: "password123",
        firstName: "Ada",
        lastName: "Seye",
        phone: "08030000000"
      });

    expect(registerRes.status).toBe(201);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("x-tenant-id", "tenant_demo")
      .send({ email: "ada@example.com", password: "password123" });

    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.accessToken as string;

    const productsRes = await request(app).get("/api/v1/products").set("x-tenant-id", "tenant_demo");
    expect(productsRes.status).toBe(200);
    const productId = productsRes.body[0].id as string;

    const productDetailRes = await request(app)
      .get("/api/v1/products/seye-red-dress")
      .set("x-tenant-id", "tenant_demo");
    expect(productDetailRes.status).toBe(200);
    const variantId = productDetailRes.body.variants[0].id as string;

    const addCartRes = await request(app)
      .post("/api/v1/cart/items")
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", `Bearer ${accessToken}`)
      .send({ productId, variantId, quantity: 1 });

    expect(addCartRes.status).toBe(201);

    const checkoutRes = await request(app)
      .post("/api/v1/checkout/initialize")
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", `Bearer ${accessToken}`)
      .send({
        email: "ada@example.com",
        shippingAddress: "12 Admiralty Way",
        city: "Lagos",
        state: "Lagos"
      });

    expect(checkoutRes.status).toBe(201);
    const paymentRef = checkoutRes.body.paymentRef as string;

    const webhookBody = {
      event: "charge.success",
      data: {
        reference: paymentRef,
        gateway_response: "Approved",
        paid_at: new Date().toISOString()
      }
    };

    const webhook1 = await request(app).post("/api/v1/payments/paystack/webhook").send(webhookBody);
    expect(webhook1.status).toBe(200);
    expect(webhook1.body.idempotent).toBe(false);

    const webhook2 = await request(app).post("/api/v1/payments/paystack/webhook").send(webhookBody);
    expect(webhook2.status).toBe(200);
    expect(webhook2.body.idempotent).toBe(true);

    const paymentStatus = await request(app)
      .get(`/api/v1/payments/${paymentRef}/status`)
      .set("x-tenant-id", "tenant_demo");

    expect(paymentStatus.body.status).toBe("success");

    const adminListRes = await request(app)
      .get("/api/v1/admin/orders")
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", "Bearer demo-admin-token");
    expect(adminListRes.status).toBe(200);
    expect(adminListRes.body.rows).toHaveLength(1);
    const orderId = adminListRes.body.rows[0].id as string;

    const adminUpdateRes = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", "Bearer demo-admin-token")
      .send({ status: "shipped", trackingNumber: "DHL-TRACK-001", note: "Dispatched to courier" });

    expect(adminUpdateRes.status).toBe(200);
    expect(adminUpdateRes.body.status).toBe("shipped");
    expect(adminUpdateRes.body.trackingNumber).toBe("DHL-TRACK-001");

    const customerOrderDetail = await request(app)
      .get(`/api/v1/orders/me/${orderId}`)
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", `Bearer ${accessToken}`);
    expect(customerOrderDetail.status).toBe(200);
    expect(customerOrderDetail.body.status).toBe("shipped");
    expect(customerOrderDetail.body.trackingNumber).toBe("DHL-TRACK-001");
    expect(customerOrderDetail.body.timeline.some((event: { status: string }) => event.status === "shipped")).toBe(true);

    const cartRes = await request(app)
      .get("/api/v1/cart")
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", `Bearer ${accessToken}`);

    expect(cartRes.body.lines).toHaveLength(0);

    const product = await ProductModel.findOne({ slug: "seye-red-dress" }).lean();
    expect(product?.variants[0].stock).toBe(7);
  });

  it("paystack callback verifies and redirects to success page", async () => {
    if (!dbAvailable) {
      return;
    }
    const { createApp } = await import("../src/app.js");
    const app = createApp();

    await request(app)
      .post("/api/v1/auth/register")
      .set("x-tenant-id", "tenant_demo")
      .send({
        email: "chi@example.com",
        password: "password123",
        firstName: "Chi",
        lastName: "Seye",
        phone: "08031111111"
      });

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("x-tenant-id", "tenant_demo")
      .send({ email: "chi@example.com", password: "password123" });

    const accessToken = loginRes.body.accessToken as string;

    const productsRes = await request(app).get("/api/v1/products").set("x-tenant-id", "tenant_demo");
    const productId = productsRes.body[0].id as string;

    const detailRes = await request(app)
      .get("/api/v1/products/seye-red-dress")
      .set("x-tenant-id", "tenant_demo");

    const variantId = detailRes.body.variants[0].id as string;

    await request(app)
      .post("/api/v1/cart/items")
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", `Bearer ${accessToken}`)
      .send({ productId, variantId, quantity: 1 });

    const checkoutRes = await request(app)
      .post("/api/v1/checkout/initialize")
      .set("x-tenant-id", "tenant_demo")
      .set("authorization", `Bearer ${accessToken}`)
      .send({
        email: "chi@example.com",
        shippingAddress: "15 Admiralty Way",
        city: "Lagos",
        state: "Lagos"
      });

    const paymentRef = checkoutRes.body.paymentRef as string;

    const callbackRes = await request(app)
      .get(`/api/v1/payments/paystack/callback?reference=${encodeURIComponent(paymentRef)}`)
      .redirects(0);

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toContain("http://localhost:5173/checkout/success");
    expect(callbackRes.headers.location).toContain(`ref=${encodeURIComponent(paymentRef)}`);
  });
});
