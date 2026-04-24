import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  encryptIfSensitive: vi.fn((_k: string, v: string) => v),
  decryptIfSensitive: vi.fn((_k: string, v: string) => v),
}));

vi.mock("@/lib/stripe", () => ({
  invalidateStripeCache: vi.fn(),
  getConnectedAccountId: vi.fn(),
}));

const stripeAccountsCreate = vi.fn();
const stripeAccountsRetrieve = vi.fn();
const stripeAccountLinksCreate = vi.fn();

vi.mock("stripe", () => ({
  default: function StripeMock() {
    return {
      accounts: {
        create: stripeAccountsCreate,
        retrieve: stripeAccountsRetrieve,
      },
      accountLinks: {
        create: stripeAccountLinksCreate,
      },
    };
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { GET } from "@/app/api/stripe/connect/route";
import { getConnectedAccountId } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

function mockAdmin() {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "1", role: "ADMIN", status: "APPROVED" },
  } as never);
}

function makeReq(url = "http://localhost/api/stripe/connect"): Request {
  return new Request(url);
}

describe("GET /api/stripe/connect — guard on platform key", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when user is not admin", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 500 when STRIPE_PLATFORM_SECRET_KEY is missing", async () => {
    mockAdmin();
    delete process.env.STRIPE_PLATFORM_SECRET_KEY;
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/STRIPE_PLATFORM_SECRET_KEY/);
  });

  it("allows initial link flow when platform key is set but no account_id stored yet", async () => {
    // Regression: previously isStripeConnectReady() required an account_id in DB,
    // which blocked the very first "Relier un compte existant" call.
    mockAdmin();
    process.env.STRIPE_PLATFORM_SECRET_KEY = "sk_test_dummy";
    vi.mocked(getConnectedAccountId).mockResolvedValue(null);
    vi.mocked(prisma.siteConfig.findUnique).mockResolvedValue(null);
    stripeAccountsRetrieve.mockResolvedValue({ id: "acct_abc", details_submitted: false });
    stripeAccountLinksCreate.mockResolvedValue({ url: "https://stripe.com/onboard/acct_abc" });

    const res = await GET(makeReq("http://localhost/api/stripe/connect?account_id=acct_abc"));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(stripeAccountsRetrieve).toHaveBeenCalledWith("acct_abc");
    expect(stripeAccountLinksCreate).toHaveBeenCalled();
  });
});
