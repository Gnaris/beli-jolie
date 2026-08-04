/**
 * Tests pour app/actions/admin/user-relance.ts
 *
 * Focus : choix automatique du scénario (panier abandonné vs client inactif),
 * rate-limit 24h, respect unsubscribe, refus si non éligible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "tenant_test";

type FakeUser = {
  id: string;
  email: string;
  firstName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  role: "CLIENT" | "ADMIN";
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
  tenantId: string;
};

type FakeCart = {
  id: string;
  updatedAt: Date;
  _count: { items: number };
};

const store: {
  users: Map<string, FakeUser>;
  carts: Map<string, FakeCart>;
  emailSends: Array<{
    tenantId: string;
    scenarioKey: string;
    userId: string | null;
    dedupKey: string;
    sentAt: Date;
  }>;
  unsubs: Array<{ tenantId: string; email: string; scope: string }>;
} = {
  users: new Map(),
  carts: new Map(),
  emailSends: [],
  unsubs: [],
};

const { prismaMock, sendMailMock, loggerMock, abandonedScanMock, inactiveSendMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMailMock: vi.fn(async () => ({ sent: true as const, id: "msg-1" })),
  abandonedScanMock: vi.fn(async () => ({ scanned: 1, sent: 1, skipped: 0, errors: 0 })),
  inactiveSendMock: vi.fn(async () => true),
  prismaMock: {
    user: {
      findUnique: vi.fn(),
    },
    cart: {
      findUnique: vi.fn(),
    },
    emailSend: {
      findFirst: vi.fn(),
      upsert: vi.fn(async () => ({ id: "upserted" })),
    },
    emailUnsubscribe: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin-1", role: "ADMIN", email: "admin@test.com" } },
    tenant: { id: TENANT_ID, slug: "test", name: "Test Shop" },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/email-marketing/abandoned-cart", () => ({
  runAbandonedCartScan: abandonedScanMock,
}));
vi.mock("@/lib/email-marketing/inactive-client", () => ({
  sendInactiveClientEmail: inactiveSendMock,
}));
vi.mock("@/lib/email-marketing/unsubscribe", () => ({
  isUnsubscribed: vi.fn(async (_tid: string, email: string, scope: string) => {
    return store.unsubs.some(
      (u) => u.email === email.toLowerCase() && (u.scope === scope || u.scope === "MARKETING_ALL"),
    );
  }),
}));

process.env.NEXTAUTH_SECRET = "test-secret-for-hmac";

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

import { checkRelanceEligibility, sendManualRelance } from "@/app/actions/admin/user-relance";

beforeEach(() => {
  store.users.clear();
  store.carts.clear();
  store.emailSends = [];
  store.unsubs = [];
  vi.clearAllMocks();

  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => {
    return store.users.get(where.id) ?? null;
  });
  prismaMock.cart.findUnique.mockImplementation(async ({ where }: any) => {
    return store.carts.get(where.userId) ?? null;
  });
  prismaMock.emailSend.findFirst.mockImplementation(async ({ where }: any) => {
    return (
      store.emailSends.find(
        (e) =>
          e.tenantId === where.tenantId &&
          e.scenarioKey === where.scenarioKey &&
          (where.userId ? e.userId === where.userId : true) &&
          (where.sentAt?.gte ? e.sentAt >= where.sentAt.gte : true),
      ) ?? null
    );
  });
  abandonedScanMock.mockResolvedValue({ scanned: 1, sent: 1, skipped: 0, errors: 0 });
  inactiveSendMock.mockResolvedValue(true);
});

function seedUser(overrides: Partial<FakeUser> = {}): FakeUser {
  const u: FakeUser = {
    id: "user-1",
    email: "client@example.com",
    firstName: "Marie",
    status: "APPROVED",
    role: "CLIENT",
    lastLoginAt: daysAgo(60),
    lastSeenAt: daysAgo(60),
    tenantId: TENANT_ID,
    ...overrides,
  };
  store.users.set(u.id, u);
  return u;
}

describe("checkRelanceEligibility", () => {
  it("refuse si le user n'existe pas", async () => {
    const res = await checkRelanceEligibility("nope");
    expect(res.success).toBe(false);
  });

  it("refuse si le user n'est pas APPROVED", async () => {
    seedUser({ status: "PENDING" });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(false);
  });

  it("refuse si le user est d'un autre tenant", async () => {
    seedUser({ tenantId: "autre-tenant" });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(false);
  });

  it("rate-limit : chaque option a canSend=false + blockReason quand MANUAL_RELANCE < 24h", async () => {
    seedUser({ lastLoginAt: daysAgo(30) });
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(48),
      _count: { items: 2 },
    });
    store.emailSends.push({
      tenantId: TENANT_ID,
      scenarioKey: "MANUAL_RELANCE",
      userId: "user-1",
      dedupKey: "past",
      sentAt: hoursAgo(2),
    });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.hasAnyAvailable).toBe(false);
      expect(res.data.options.length).toBeGreaterThan(0);
      for (const opt of res.data.options) {
        expect(opt.canSend).toBe(false);
        expect(opt.blockReason).toMatch(/pourrez le relancer dans/i);
      }
    }
  });

  it("MARKETING_ALL unsubscribed → renvoie 0 option + globalBlockReason", async () => {
    seedUser();
    store.unsubs.push({ tenantId: TENANT_ID, email: "client@example.com", scope: "MARKETING_ALL" });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.hasAnyAvailable).toBe(false);
      expect(res.data.options.length).toBe(0);
      expect(res.data.globalBlockReason).toBeTruthy();
    }
  });

  it("propose ABANDONED_CART + INACTIVE_CLIENT quand les deux applicables", async () => {
    seedUser({ lastLoginAt: daysAgo(30), lastSeenAt: daysAgo(30) });
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(48),
      _count: { items: 3 },
    });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.options.length).toBe(2);
      const cart = res.data.options.find((o) => o.kind === "ABANDONED_CART");
      const inactive = res.data.options.find((o) => o.kind === "INACTIVE_CLIENT");
      expect(cart?.canSend).toBe(true);
      expect(cart?.cartItemCount).toBe(3);
      expect(inactive?.canSend).toBe(true);
      expect(inactive?.daysSinceLastLogin).toBe(30);
      expect(res.data.hasAnyAvailable).toBe(true);
      expect(res.data.adminEmail).toBe("admin@test.com");
    }
  });

  it("panier trop récent → option ABANDONED_CART présente mais canSend=false", async () => {
    seedUser({ lastLoginAt: daysAgo(15) });
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(3),
      _count: { items: 2 },
    });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      const cart = res.data.options.find((o) => o.kind === "ABANDONED_CART");
      expect(cart).toBeDefined();
      expect(cart?.canSend).toBe(false);
      expect(cart?.blockReason).toMatch(/trop récent/i);
    }
  });

  it("panier abandonné mais désabonné CART_REMINDERS → option présente mais canSend=false", async () => {
    seedUser({ lastLoginAt: daysAgo(30) });
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(48),
      _count: { items: 2 },
    });
    store.unsubs.push({
      tenantId: TENANT_ID,
      email: "client@example.com",
      scope: "CART_REMINDERS",
    });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      const cart = res.data.options.find((o) => o.kind === "ABANDONED_CART");
      expect(cart?.canSend).toBe(false);
      expect(cart?.blockReason).toMatch(/désabonné/i);
      const inactive = res.data.options.find((o) => o.kind === "INACTIVE_CLIENT");
      expect(inactive?.canSend).toBe(true);
    }
  });

  it("inactif < 7j → option INACTIVE_CLIENT présente mais canSend=false", async () => {
    seedUser({ lastLoginAt: daysAgo(3), lastSeenAt: daysAgo(3) });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      const inactive = res.data.options.find((o) => o.kind === "INACTIVE_CLIENT");
      expect(inactive?.canSend).toBe(false);
      expect(inactive?.blockReason).toMatch(/seuil/i);
    }
  });

  it("jamais connecté + pas de panier → 0 option", async () => {
    seedUser({ lastLoginAt: null, lastSeenAt: null });
    const res = await checkRelanceEligibility("user-1");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.options.length).toBe(0);
    }
  });
});

describe("sendManualRelance", () => {
  it("refuse si kind non applicable", async () => {
    seedUser({ lastLoginAt: daysAgo(1), lastSeenAt: daysAgo(1) });
    const res = await sendManualRelance("user-1", "ABANDONED_CART");
    expect(res.success).toBe(false);
  });

  it("refuse si option existe mais canSend=false", async () => {
    seedUser({ lastLoginAt: daysAgo(3), lastSeenAt: daysAgo(3) });
    const res = await sendManualRelance("user-1", "INACTIVE_CLIENT");
    expect(res.success).toBe(false);
  });

  it("envoie via sendInactiveClientEmail pour INACTIVE_CLIENT choisi", async () => {
    seedUser({ lastLoginAt: daysAgo(45), lastSeenAt: daysAgo(45) });
    const res = await sendManualRelance("user-1", "INACTIVE_CLIENT");
    expect(res.success).toBe(true);
    expect(inactiveSendMock).toHaveBeenCalledTimes(1);
    expect(inactiveSendMock.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      email: "client@example.com",
      scenarioKey: "MANUAL_RELANCE",
    });
  });

  it("délègue à runAbandonedCartScan pour ABANDONED_CART choisi", async () => {
    seedUser();
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(30),
      _count: { items: 2 },
    });
    const res = await sendManualRelance("user-1", "ABANDONED_CART");
    expect(res.success).toBe(true);
    expect(abandonedScanMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailSend.upsert).toHaveBeenCalledTimes(1);
  });

  it("permet de choisir INACTIVE quand les 2 options sont disponibles", async () => {
    seedUser({ lastLoginAt: daysAgo(45), lastSeenAt: daysAgo(45) });
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(30),
      _count: { items: 2 },
    });
    const res = await sendManualRelance("user-1", "INACTIVE_CLIENT");
    expect(res.success).toBe(true);
    expect(inactiveSendMock).toHaveBeenCalledTimes(1);
    expect(abandonedScanMock).not.toHaveBeenCalled();
  });

  it("échec si le scan panier n'envoie rien", async () => {
    seedUser();
    store.carts.set("user-1", {
      id: "cart-1",
      updatedAt: hoursAgo(30),
      _count: { items: 2 },
    });
    abandonedScanMock.mockResolvedValueOnce({ scanned: 1, sent: 0, skipped: 1, errors: 0 });
    const res = await sendManualRelance("user-1", "ABANDONED_CART");
    expect(res.success).toBe(false);
  });
});
