import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockAdminCardFindFirst = vi.fn();
const mockAdminCardCreate = vi.fn();
const mockAdminCardUpdate = vi.fn();
const mockOrderFindFirst = vi.fn();
const mockOrderCreate = vi.fn();
const mockOrderUpdate = vi.fn();
const mockItemDeleteMany = vi.fn();
const mockItemFindMany = vi.fn();
const mockItemCreateMany = vi.fn();
const mockProductFindMany = vi.fn();
const mockProductColorFindMany = vi.fn();
const mockUserFindFirst = vi.fn();
const mockUserCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminClientCard: {
      findFirst: (...a: unknown[]) => mockAdminCardFindFirst(...a),
      create: (...a: unknown[]) => mockAdminCardCreate(...a),
      update: (...a: unknown[]) => mockAdminCardUpdate(...a),
    },
    microstoreOrder: {
      findFirst: (...a: unknown[]) => mockOrderFindFirst(...a),
      create: (...a: unknown[]) => mockOrderCreate(...a),
      update: (...a: unknown[]) => mockOrderUpdate(...a),
    },
    microstoreOrderItem: {
      findMany: (...a: unknown[]) => mockItemFindMany(...a),
      deleteMany: (...a: unknown[]) => mockItemDeleteMany(...a),
      createMany: (...a: unknown[]) => mockItemCreateMany(...a),
    },
    product: {
      findMany: (...a: unknown[]) => mockProductFindMany(...a),
    },
    productColor: {
      findMany: (...a: unknown[]) => mockProductColorFindMany(...a),
    },
    user: {
      findFirst: (...a: unknown[]) => mockUserFindFirst(...a),
      create: (...a: unknown[]) => mockUserCreate(...a),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/marketplace-client-dedup", () => ({
  findClientCardByEmailForDedup: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/microstore-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/microstore-client")>(
    "@/lib/microstore-client",
  );
  return {
    ...actual,
    microstoreGetOrderDetail: vi.fn(),
    microstoreListAllOrders: vi.fn(),
  };
});

import { upsertMicrostoreOrderFromDetail } from "@/lib/microstore-orders-sync";
import type { MicrostoreOrderDetail } from "@/lib/microstore-client";

const tenantId = "tenant-1";

function makeDetail(overrides: Partial<MicrostoreOrderDetail> = {}): MicrostoreOrderDetail {
  return {
    id: "mc_ord_1",
    number: "MC1001",
    ctime: String(Math.floor(Date.now() / 1000)),
    utime: null,
    pay_status: "1",
    shipping_status: "0",
    total_price: "42.00",
    paid_price: "42.00",
    shipping_price: "0",
    shipping_name: "Standard",
    remark: null,
    client_info: {
      client_id: "mc_cli_1",
      first_name: "Alice",
      last_name: "Martin",
      company_name: "Bijoux Alice",
      invoice_title: null,
      address_name: "Alice Martin",
      email: "alice@example.com",
      phone: "0611223344",
      address_phone: "0611223344",
      phone_code: "+33",
      address: "1 rue de Paris",
      city: "Paris",
      zip: "75001",
      country: "FRANCE",
      vat_num: null,
    },
    goods_info: [],
    invoice_address: null,
    ...overrides,
  } as unknown as MicrostoreOrderDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminCardFindFirst.mockResolvedValue(null);
  mockAdminCardCreate.mockResolvedValue({ id: "card-1" });
  mockAdminCardUpdate.mockResolvedValue({ id: "card-1" });
  mockOrderFindFirst.mockResolvedValue(null);
  mockOrderCreate.mockResolvedValue({ id: "internal-order-1" });
  mockItemFindMany.mockResolvedValue([]);
  mockItemDeleteMany.mockResolvedValue({ count: 0 });
  mockProductFindMany.mockResolvedValue([]);
  mockProductColorFindMany.mockResolvedValue([]);
  mockUserFindFirst.mockResolvedValue(null);
});

describe("Microstore sync — clients importés ne créent PAS de compte inscrit", () => {
  it("crée une fiche client (AdminClientCard) mais aucun User", async () => {
    await upsertMicrostoreOrderFromDetail(tenantId, makeDetail());

    expect(mockAdminCardCreate).toHaveBeenCalledTimes(1);
    expect(mockUserCreate).not.toHaveBeenCalled();

    // La commande est enregistrée sans userId
    expect(mockOrderCreate).toHaveBeenCalledTimes(1);
    const orderArg = mockOrderCreate.mock.calls[0][0] as {
      data: { userId: string | null };
    };
    expect(orderArg.data.userId).toBeNull();
  });

  it("rattache la commande à un User déjà inscrit si l'email correspond", async () => {
    mockUserFindFirst.mockResolvedValueOnce({ id: "user-existing" });

    await upsertMicrostoreOrderFromDetail(tenantId, makeDetail());

    expect(mockUserCreate).not.toHaveBeenCalled();
    const orderArg = mockOrderCreate.mock.calls[0][0] as {
      data: { userId: string | null };
    };
    expect(orderArg.data.userId).toBe("user-existing");
  });

  it("laisse userId null quand l'email est absent (ne cherche même pas)", async () => {
    const detail = makeDetail({
      client_info: {
        ...makeDetail().client_info,
        email: "",
      } as MicrostoreOrderDetail["client_info"],
    });

    await upsertMicrostoreOrderFromDetail(tenantId, detail);

    expect(mockUserFindFirst).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
    const orderArg = mockOrderCreate.mock.calls[0][0] as {
      data: { userId: string | null };
    };
    expect(orderArg.data.userId).toBeNull();
  });
});

// Évite l'avertissement Prisma sur les Decimal non utilisés dans les mocks
void Prisma;
