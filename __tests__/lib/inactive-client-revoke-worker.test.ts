/**
 * Tests du worker de désactivation automatique des clients inactifs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSiteConfigFindMany,
  mockUserFindMany,
  mockUserUpdateMany,
  mockOrderGroupBy,
  mockNotifyWarning,
  mockNotifyRevoked,
} = vi.hoisted(() => ({
  mockSiteConfigFindMany: vi.fn(),
  mockUserFindMany: vi.fn(),
  mockUserUpdateMany: vi.fn(),
  mockOrderGroupBy: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyRevoked: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findMany: (...a: unknown[]) => mockSiteConfigFindMany(...a),
    },
    user: {
      findMany: (...a: unknown[]) => mockUserFindMany(...a),
      updateMany: (...a: unknown[]) => mockUserUpdateMany(...a),
    },
    order: {
      groupBy: (...a: unknown[]) => mockOrderGroupBy(...a),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/tenant-als", () => ({
  tenantALS: { run: (_tid: string, fn: () => unknown) => fn() },
}));

vi.mock("@/lib/notifications", () => ({
  notifyClientInactivityWarning: (...a: unknown[]) => mockNotifyWarning(...a),
  notifyClientInactivityRevoked: (...a: unknown[]) => mockNotifyRevoked(...a),
}));

import { processTenantForTests } from "@/lib/inactive-client-revoke-worker";

const TENANT_ID = "tenant-xyz";

function siteConfigRows(
  warning: number | null,
  grace: number | null,
  probation: number | null = 30,
) {
  const rows: { key: string; value: string }[] = [];
  if (warning !== null)
    rows.push({ key: "inactive_revoke_warning_days", value: String(warning) });
  if (grace !== null)
    rows.push({ key: "inactive_revoke_grace_days", value: String(grace) });
  if (probation !== null)
    rows.push({
      key: "inactive_revoke_probation_days",
      value: String(probation),
    });
  return rows;
}

beforeEach(() => {
  mockSiteConfigFindMany.mockReset();
  mockUserFindMany.mockReset();
  mockUserUpdateMany.mockReset();
  mockOrderGroupBy.mockReset();
  mockNotifyWarning.mockReset();
  mockNotifyRevoked.mockReset();
  mockUserFindMany.mockResolvedValue([]);
  mockOrderGroupBy.mockResolvedValue([]);
  mockUserUpdateMany.mockResolvedValue({ count: 1 });
});

describe("worker — tenant sans délais configurés", () => {
  it("skip si warningDays absent", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(null, 15, 30));
    await processTenantForTests(TENANT_ID);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it("skip si graceDays absent", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, null, 30));
    await processTenantForTests(TENANT_ID);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it("skip si warning+grace absents (même avec probation seule)", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(null, null, 30));
    await processTenantForTests(TENANT_ID);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });
});

describe("worker — envoi de l'avertissement", () => {
  it("avertit un client inactif depuis > warningDays sans avertissement précédent", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    const userId = "u1";
    mockUserFindMany.mockResolvedValue([
      {
        id: userId,
        email: "marie@exemple.com",
        firstName: "Marie",
        lastName: "Dupont",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
        probationUntil: null,
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([
      { userId, _max: { createdAt: new Date(now.getTime() - 400 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    const updArgs = mockUserUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updArgs.where).toMatchObject({ id: userId, tenantId: TENANT_ID });
    expect(updArgs.data).toHaveProperty("inactivityWarningAt");

    expect(mockNotifyWarning).toHaveBeenCalledTimes(1);
    const mailArgs = mockNotifyWarning.mock.calls[0][0] as {
      email: string;
      firstName: string;
      graceDays: number;
    };
    expect(mailArgs.email).toBe("marie@exemple.com");
    expect(mailArgs.graceDays).toBe(15);
  });

  it("compte depuis createdAt si jamais commandé", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    mockUserFindMany.mockResolvedValue([
      {
        id: "u2",
        email: "jean@exemple.com",
        firstName: "Jean",
        lastName: "",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
        probationUntil: null,
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([]);

    await processTenantForTests(TENANT_ID);

    expect(mockNotifyWarning).toHaveBeenCalledTimes(1);
  });
});

describe("worker — grâce en cours", () => {
  it("ne fait rien pour un client averti depuis < graceDays", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    mockUserFindMany.mockResolvedValue([
      {
        id: "u3",
        email: "chloe@exemple.com",
        firstName: "Chloé",
        lastName: "",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: new Date(now.getTime() - 5 * 86400_000),
        deactivatedForInactivityAt: null,
        probationUntil: null,
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([
      { userId: "u3", _max: { createdAt: new Date(now.getTime() - 400 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockNotifyWarning).not.toHaveBeenCalled();
    expect(mockNotifyRevoked).not.toHaveBeenCalled();
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });
});

describe("worker — désactivation effective (DEACTIVATED)", () => {
  it("bascule status: APPROVED → DEACTIVATED (plus PENDING)", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    const userId = "u4";
    mockUserFindMany.mockResolvedValue([
      {
        id: userId,
        email: "sophie@exemple.com",
        firstName: "Sophie",
        lastName: "",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: new Date(now.getTime() - 20 * 86400_000),
        deactivatedForInactivityAt: null,
        probationUntil: null,
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([
      { userId, _max: { createdAt: new Date(now.getTime() - 400 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    const updArgs = mockUserUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updArgs.where).toMatchObject({
      id: userId,
      tenantId: TENANT_ID,
      status: "APPROVED",
      deactivatedForInactivityAt: null,
    });
    expect(updArgs.data.status).toBe("DEACTIVATED");
    expect(updArgs.data.deactivatedForInactivityAt).toBeInstanceOf(Date);

    expect(mockNotifyRevoked).toHaveBeenCalledTimes(1);
  });

  it("ne pose pas 2 fois la désactivation (lock optimiste)", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    mockUserUpdateMany.mockResolvedValue({ count: 0 });
    const now = new Date();
    mockUserFindMany.mockResolvedValue([
      {
        id: "u5",
        email: "lila@exemple.com",
        firstName: "Lila",
        lastName: "",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: new Date(now.getTime() - 30 * 86400_000),
        deactivatedForInactivityAt: null,
        probationUntil: null,
      },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockNotifyRevoked).not.toHaveBeenCalled();
  });
});

describe("worker — wipe après nouvelle commande (cycle normal)", () => {
  it("efface inactivityWarningAt si commande après avertissement", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    const userId = "u6";
    mockUserFindMany.mockResolvedValue([
      {
        id: userId,
        email: "nina@exemple.com",
        firstName: "Nina",
        lastName: "",
        createdAt: new Date(now.getTime() - 1000 * 86400_000),
        inactivityWarningAt: new Date(now.getTime() - 10 * 86400_000),
        deactivatedForInactivityAt: null,
        probationUntil: null,
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([
      { userId, _max: { createdAt: new Date(now.getTime() - 2 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    const updArgs = mockUserUpdateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updArgs.data).toMatchObject({ inactivityWarningAt: null });
    expect(mockNotifyWarning).not.toHaveBeenCalled();
    expect(mockNotifyRevoked).not.toHaveBeenCalled();
  });
});

describe("worker — probation", () => {
  it("PROBATION_ACTIVE : ne fait rien si probation en cours sans commande", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    mockUserFindMany.mockResolvedValue([
      {
        id: "u7",
        email: "elsa@exemple.com",
        firstName: "Elsa",
        lastName: "",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
        probationUntil: new Date(now.getTime() + 10 * 86400_000),
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([
      { userId: "u7", _max: { createdAt: new Date(now.getTime() - 400 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockNotifyWarning).not.toHaveBeenCalled();
    expect(mockNotifyRevoked).not.toHaveBeenCalled();
  });

  it("PROBATION_EXPIRED : re-désactive direct (sans ré-avertissement)", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    const userId = "u8";
    mockUserFindMany.mockResolvedValue([
      {
        id: userId,
        email: "flora@exemple.com",
        firstName: "Flora",
        lastName: "",
        createdAt: new Date(now.getTime() - 500 * 86400_000),
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
        probationUntil: new Date(now.getTime() - 1 * 86400_000), // expirée hier
      },
    ]);
    mockOrderGroupBy.mockResolvedValue([
      { userId, _max: { createdAt: new Date(now.getTime() - 400 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    const updArgs = mockUserUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updArgs.where).toMatchObject({
      id: userId,
      tenantId: TENANT_ID,
      status: "APPROVED",
    });
    expect(updArgs.data.status).toBe("DEACTIVATED");
    expect(updArgs.data.probationUntil).toBeNull();

    // Mail de désactivation envoyé, PAS de ré-avertissement.
    expect(mockNotifyRevoked).toHaveBeenCalledTimes(1);
    expect(mockNotifyWarning).not.toHaveBeenCalled();
  });

  it("commande pendant la probation → clear probationUntil + reset du cycle", async () => {
    mockSiteConfigFindMany.mockResolvedValue(siteConfigRows(365, 15, 30));
    const now = new Date();
    const userId = "u9";
    mockUserFindMany.mockResolvedValue([
      {
        id: userId,
        email: "gaelle@exemple.com",
        firstName: "Gaëlle",
        lastName: "",
        createdAt: new Date(now.getTime() - 1000 * 86400_000),
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
        // probation posée il y a ~5 j, dure 30 j
        probationUntil: new Date(now.getTime() + 25 * 86400_000),
      },
    ]);
    // Commande il y a 2 j (pendant la probation)
    mockOrderGroupBy.mockResolvedValue([
      { userId, _max: { createdAt: new Date(now.getTime() - 2 * 86400_000) } },
    ]);

    await processTenantForTests(TENANT_ID);

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    const updArgs = mockUserUpdateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updArgs.data).toMatchObject({
      probationUntil: null,
      inactivityWarningAt: null,
      deactivatedForInactivityAt: null,
    });
    expect(mockNotifyWarning).not.toHaveBeenCalled();
    expect(mockNotifyRevoked).not.toHaveBeenCalled();
  });
});
