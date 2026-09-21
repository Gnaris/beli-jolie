/**
 * Tests pour POST /api/telemetry/payment-error.
 *
 * Route qui capte les erreurs Stripe.js remontées par le navigateur pour
 * qu'on puisse enquêter sur les paiements qui échouent en amont (avant même
 * qu'une charge ne soit tentée). Cf. incident Issyma 21/09/2026.
 *
 * On vérifie : validation Zod stricte, rate-limit, tag de log grep-able.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test"),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Rate-limit : instance en mémoire, on la réinitialise entre chaque test via
// le reset natif (nouvelle IP) plutôt que via mock — pour tester le vrai code.

import { getServerSession } from "next-auth";
import { logger } from "@/lib/logger";
import { POST } from "@/app/api/telemetry/payment-error/route";

function makeRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/telemetry/payment-error", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      "user-agent": "TestAgent/1.0",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/telemetry/payment-error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("log une erreur de chargement PaymentElement avec toutes les infos", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-42", email: "client@test.com", role: "CLIENT", status: "APPROVED", name: "T", company: "T" },
    } as never);

    const res = await POST(
      makeRequest(
        {
          stage: "load",
          source: "checkout",
          paymentIntentId: "pi_3ABC",
          amountCents: 12345,
          stripeError: {
            type: "invalid_request_error",
            code: "payment_method_not_available",
            message: "The payment method type 'billie' is not available for this transaction.",
          },
        },
        "10.0.0.1",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, ctx] = vi.mocked(logger.warn).mock.calls[0];
    expect(msg).toBe("[payment-telemetry] Erreur navigateur Stripe");
    expect(ctx).toMatchObject({
      stage: "load",
      source: "checkout",
      paymentIntentId: "pi_3ABC",
      userId: "user-42",
      userEmail: "client@test.com",
      tenantId: "tenant-test",
      stripeError: {
        code: "payment_method_not_available",
      },
    });
  });

  it("log même sans session (session expirée pendant l'erreur)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST(
      makeRequest(
        { stage: "confirm", source: "pay-order-by-card", orderId: "ord-1" },
        "10.0.0.2",
      ),
    );

    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, ctx] = vi.mocked(logger.warn).mock.calls[0];
    expect(ctx).toMatchObject({
      userId: null,
      userEmail: null,
      orderId: "ord-1",
    });
  });

  it("refuse un body non conforme (stage inconnu)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ stage: "foo", source: "checkout" }, "10.0.0.3"),
    );

    expect(res.status).toBe(400);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("refuse un body JSON invalide", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = new Request("http://localhost/api/telemetry/payment-error", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.4" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("applique un rate limit à 20 requêtes par minute et par IP", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const ip = "10.0.0.5";
    const payload = { stage: "load", source: "checkout" };

    // 20 requêtes doivent passer
    for (let i = 0; i < 20; i++) {
      const res = await POST(makeRequest(payload, ip));
      expect(res.status).toBe(200);
    }
    // La 21ème est bloquée
    const blocked = await POST(makeRequest(payload, ip));
    expect(blocked.status).toBe(429);
  });
});
