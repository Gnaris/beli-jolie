/**
 * Tests pour lib/payment-error-notify.ts.
 *
 * Deux logiques critiques :
 *   1. Classification : ne PAS notifier une carte refusée (parcours normal),
 *      mais notifier une exception technique (bug à investiguer).
 *   2. Anti-spam : si un même client réessaie 5 fois avec la même erreur,
 *      un seul mail part.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(),
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn().mockResolvedValue("Boutique Test"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import {
  isTechnicalPaymentError,
  notifyPaymentErrorIfTechnical,
  _resetPaymentErrorDedup,
  type PaymentErrorNotifyInput,
} from "@/lib/payment-error-notify";

function baseInput(over: Partial<PaymentErrorNotifyInput> = {}): PaymentErrorNotifyInput {
  return {
    stage: "confirm",
    source: "checkout",
    paymentIntentId: "pi_test",
    orderId: null,
    amountCents: 5000,
    offeredMethods: null,
    attemptedMethod: null,
    stripeError: null,
    page: "/fr/panier",
    userId: "user-1",
    userEmail: "client@test.com",
    tenantId: "tenant-1",
    ip: "10.0.0.1",
    userAgent: "TestAgent",
    ...over,
  };
}

describe("isTechnicalPaymentError", () => {
  it("stage 'load' est toujours technique (formulaire cassé)", () => {
    expect(isTechnicalPaymentError({ type: "card_error", code: "card_declined" }, "load")).toBe(true);
    expect(isTechnicalPaymentError(null, "load")).toBe(true);
  });

  it("carte refusée en confirm = pas technique (parcours normal)", () => {
    expect(
      isTechnicalPaymentError({ type: "card_error", code: "card_declined" }, "confirm"),
    ).toBe(false);
    expect(
      isTechnicalPaymentError({ type: "card_error", code: "expired_card" }, "confirm"),
    ).toBe(false);
    expect(
      isTechnicalPaymentError({ code: "insufficient_funds" }, "confirm"),
    ).toBe(false);
    expect(
      isTechnicalPaymentError({ code: "authentication_required" }, "confirm"),
    ).toBe(false);
  });

  it("exception API Stripe en confirm = technique", () => {
    expect(
      isTechnicalPaymentError({ type: "api_error", message: "Server error" }, "confirm"),
    ).toBe(true);
    expect(
      isTechnicalPaymentError(
        { type: "invalid_request_error", code: "payment_method_not_available" },
        "confirm",
      ),
    ).toBe(true);
    expect(
      isTechnicalPaymentError({ code: "not_succeeded" }, "confirm"),
    ).toBe(true);
  });

  it("erreur inconnue en confirm = considérée technique (par défaut)", () => {
    expect(isTechnicalPaymentError({ message: "?" }, "confirm")).toBe(true);
    expect(isTechnicalPaymentError(null, "confirm")).toBe(true);
  });
});

describe("notifyPaymentErrorIfTechnical", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPaymentErrorDedup();
    vi.mocked(prisma.siteConfig.findFirst).mockResolvedValue({
      value: "borischen91@gmail.com",
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      firstName: "Remus",
      lastName: "Haselhoffer",
      email: "remus@test.com",
      company: "Haselhoffer Remus",
    } as never);
    vi.mocked(sendMail).mockResolvedValue({ sent: true, id: "msg-1" } as never);
  });

  it("envoie un mail pour une erreur technique", async () => {
    await notifyPaymentErrorIfTechnical(
      baseInput({
        stage: "load",
        stripeError: { message: "Something wrong with billie" },
      }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [call] = vi.mocked(sendMail).mock.calls;
    expect(call[0].to).toBe("borischen91@gmail.com");
    expect(call[0].subject).toContain("Bug paiement");
    // Objet doit contenir un timestamp jj/mm/aaaa hh:mm:ss précis à la seconde.
    expect(call[0].subject).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/);
    expect(call[0].html).toContain("Remus Haselhoffer");
    expect(call[0].html).toContain("Something wrong with billie");
  });

  it("n'envoie PAS de mail pour une carte refusée (comportement normal)", async () => {
    await notifyPaymentErrorIfTechnical(
      baseInput({
        stage: "confirm",
        stripeError: { type: "card_error", code: "card_declined", message: "Carte refusée" },
      }),
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("n'envoie qu'un seul mail si le même client réessaie 5 fois avec la même erreur", async () => {
    const input = baseInput({
      stage: "load",
      stripeError: { code: "payment_method_not_available", message: "billie" },
    });
    for (let i = 0; i < 5; i++) {
      await notifyPaymentErrorIfTechnical(input);
    }
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("envoie un mail séparé si un autre client rencontre la même erreur", async () => {
    const err = { code: "payment_method_not_available", message: "billie" };
    await notifyPaymentErrorIfTechnical(
      baseInput({ stage: "load", userId: "user-A", stripeError: err }),
    );
    await notifyPaymentErrorIfTechnical(
      baseInput({ stage: "load", userId: "user-B", stripeError: err }),
    );
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("skip silencieusement si admin_personal_email n'est pas configuré", async () => {
    vi.mocked(prisma.siteConfig.findFirst).mockResolvedValue({ value: "" } as never);
    await notifyPaymentErrorIfTechnical(
      baseInput({ stage: "load", stripeError: { message: "x" } }),
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("n'explose pas si sendMail throw (fire-and-forget)", async () => {
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP down"));
    await expect(
      notifyPaymentErrorIfTechnical(
        baseInput({ stage: "load", stripeError: { message: "x" } }),
      ),
    ).resolves.toBeUndefined();
  });
});
