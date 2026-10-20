/**
 * Tests unitaires pour `lib/push-notifications.ts`.
 *
 * On mock `web-push` + Prisma. L'enjeu principal :
 *   - Scopage strict par tenant (jamais lire des abonnements d'un autre tenant).
 *   - Nettoyage des endpoints 410/404 (abonnements morts).
 *   - Pas de crash si les clés VAPID manquent (feature désactivée en douceur).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Sub = {
  id: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
  tenantId?: string;
};

// Mocks à définir AVANT l'import du module testé.
// On simule le filtre `where: { tenantId }` pour pouvoir prouver que les
// abonnements d'autres tenants NE sont JAMAIS retournés (anti-fuite multi-tenant).
const prismaMock = vi.hoisted(() => {
  const subs: Sub[] = [];
  return {
    pushSubscription: {
      findMany: vi.fn(async (args: { where?: { tenantId?: string } }) => {
        const wantedTenant = args?.where?.tenantId;
        if (wantedTenant == null) return subs; // tests legacy sans tenantId
        return subs.filter((s) => s.tenantId === wantedTenant);
      }),
      deleteMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
      updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
    },
    _reset(data: Sub[]) {
      subs.length = 0;
      for (const d of data) subs.push(d);
    },
  };
});

const sendNotificationMock = vi.hoisted(() => vi.fn());
const setVapidDetailsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
  setVapidDetails: setVapidDetailsMock,
  sendNotification: sendNotificationMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock._reset([]);
  // Clés VAPID lues directement dans process.env — on les pose avant chaque test.
  process.env.VAPID_PUBLIC_KEY = "test-pub";
  process.env.VAPID_PRIVATE_KEY = "test-priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
});

describe("sendPushToAdmins", () => {
  it("ne fait rien si tenantId est undefined", async () => {
    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins(undefined, { title: "x", body: "y" });
    expect(prismaMock.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("envoie à tous les appareils admin du tenant", async () => {
    prismaMock._reset([
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", authKey: "a1", tenantId: "tenant-A" },
      { id: "s2", endpoint: "https://push/2", p256dh: "k2", authKey: "a2", tenantId: "tenant-A" },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);

    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins("tenant-A", {
      title: "Nouvelle commande",
      body: "250 €",
      url: "/admin/commandes/x",
    });

    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledOnce();
    const findManyArgs = prismaMock.pushSubscription.findMany.mock.calls[0][0] as {
      where: { tenantId: string; user: { role: string } };
    };
    expect(findManyArgs.where.tenantId).toBe("tenant-A");
    expect(findManyArgs.where.user.role).toBe("ADMIN");

    // 2 appels sendNotification — un par appareil.
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);

    // Payload JSON contient title + body.
    const payload = JSON.parse(sendNotificationMock.mock.calls[0][1] as string);
    expect(payload.title).toBe("Nouvelle commande");
    expect(payload.body).toBe("250 €");
    expect(payload.url).toBe("/admin/commandes/x");
  });

  it("purge les endpoints qui répondent 410 Gone", async () => {
    prismaMock._reset([
      { id: "s1", endpoint: "https://push/alive", p256dh: "k1", authKey: "a1", tenantId: "tenant-A" },
      { id: "s2", endpoint: "https://push/dead", p256dh: "k2", authKey: "a2", tenantId: "tenant-A" },
    ]);
    sendNotificationMock
      .mockResolvedValueOnce(undefined) // s1 OK
      .mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 })); // s2 mort

    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins("tenant-A", { title: "t", body: "b" });

    // Seul s2 doit avoir été supprimé.
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledOnce();
    const deleteArgs = prismaMock.pushSubscription.deleteMany.mock.calls[0][0] as {
      where: { id: { in: string[] } };
    };
    expect(deleteArgs.where.id.in).toEqual(["s2"]);
  });

  it("purge aussi les endpoints 404 Not Found", async () => {
    prismaMock._reset([
      { id: "s1", endpoint: "https://push/404", p256dh: "k1", authKey: "a1", tenantId: "tenant-A" },
    ]);
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("Not Found"), { statusCode: 404 }),
    );

    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins("tenant-A", { title: "t", body: "b" });

    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledOnce();
  });

  it("ne purge PAS sur les erreurs transitoires (500, timeout)", async () => {
    prismaMock._reset([
      { id: "s1", endpoint: "https://push/flaky", p256dh: "k1", authKey: "a1", tenantId: "tenant-A" },
    ]);
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("Internal error"), { statusCode: 500 }),
    );

    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins("tenant-A", { title: "t", body: "b" });

    expect(prismaMock.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("bump lastUsedAt sur les envois réussis", async () => {
    prismaMock._reset([
      { id: "s1", endpoint: "https://push/1", p256dh: "k1", authKey: "a1", tenantId: "tenant-A" },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);

    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins("tenant-A", { title: "t", body: "b" });

    expect(prismaMock.pushSubscription.updateMany).toHaveBeenCalledOnce();
    const updateArgs = prismaMock.pushSubscription.updateMany.mock.calls[0][0] as {
      where: { id: { in: string[] } };
      data: { lastUsedAt: Date };
    };
    expect(updateArgs.where.id.in).toEqual(["s1"]);
    expect(updateArgs.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it("ne crashe pas si Prisma lève une exception", async () => {
    prismaMock.pushSubscription.findMany.mockRejectedValueOnce(new Error("DB down"));

    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await expect(
      sendPushToAdmins("tenant-A", { title: "t", body: "b" }),
    ).resolves.toBeUndefined();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

describe("isPushConfigured", () => {
  it("retourne true quand VAPID public + private sont définies", async () => {
    const { isPushConfigured } = await import("@/lib/push-notifications");
    expect(isPushConfigured()).toBe(true);
  });
});

describe("sendPushToAdmins — isolation multi-tenant", () => {
  it("iPhone BJ ne reçoit JAMAIS un push d'Issyma et vice versa", async () => {
    // 2 boutiques, 2 iPhones admin, 2 endpoints différents.
    prismaMock._reset([
      { id: "bj1",  endpoint: "https://push/bj1",  p256dh: "k", authKey: "a", tenantId: "beliandjolie" },
      { id: "iss1", endpoint: "https://push/iss1", p256dh: "k", authKey: "a", tenantId: "issyma" },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { sendPushToAdmins } = await import("@/lib/push-notifications");

    // Une commande tombe sur BJ → seul l'iPhone BJ reçoit.
    await sendPushToAdmins("beliandjolie", { title: "Commande BJ", body: "x" });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock.mock.calls[0][0].endpoint).toBe("https://push/bj1");

    // Une commande tombe sur Issyma → seul l'iPhone Issyma reçoit.
    sendNotificationMock.mockClear();
    await sendPushToAdmins("issyma", { title: "Commande Issyma", body: "y" });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock.mock.calls[0][0].endpoint).toBe("https://push/iss1");
  });

  it("un tenant inconnu ne reçoit rien (où rien n'est enregistré)", async () => {
    prismaMock._reset([
      { id: "bj1", endpoint: "https://push/bj1", p256dh: "k", authKey: "a", tenantId: "beliandjolie" },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { sendPushToAdmins } = await import("@/lib/push-notifications");

    await sendPushToAdmins("tenant-inconnu", { title: "x", body: "y" });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("plusieurs appareils d'un même tenant reçoivent tous (pas de dédoublonnage silencieux)", async () => {
    prismaMock._reset([
      { id: "bj1", endpoint: "https://push/bj-iphone", p256dh: "k", authKey: "a", tenantId: "beliandjolie" },
      { id: "bj2", endpoint: "https://push/bj-mac",    p256dh: "k", authKey: "a", tenantId: "beliandjolie" },
      { id: "bj3", endpoint: "https://push/bj-pc",     p256dh: "k", authKey: "a", tenantId: "beliandjolie" },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { sendPushToAdmins } = await import("@/lib/push-notifications");

    await sendPushToAdmins("beliandjolie", { title: "x", body: "y" });
    expect(sendNotificationMock).toHaveBeenCalledTimes(3);
  });

  it("la requête Prisma inclut TOUJOURS tenantId dans le where", async () => {
    prismaMock._reset([]);
    const { sendPushToAdmins } = await import("@/lib/push-notifications");
    await sendPushToAdmins("beliandjolie", { title: "x", body: "y" });

    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledOnce();
    const args = prismaMock.pushSubscription.findMany.mock.calls[0][0] as {
      where: { tenantId: string; user: { role: string } };
    };
    expect(args.where.tenantId).toBe("beliandjolie");
    expect(args.where.user.role).toBe("ADMIN");
  });
});
