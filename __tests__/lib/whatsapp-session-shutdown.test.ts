import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock du logger pour ne pas polluer stdout pendant les tests.
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Baileys est charge en dynamic import dans whatsapp-session.ts. On ne
// l'importe jamais pendant ces tests (on ne declenche ni bootSocket ni
// requestWhatsappPairingCode), donc pas besoin de le mocker.

import {
  shutdownAllWhatsappSessions,
  getWhatsappSessionState,
} from "@/lib/whatsapp-session";

const STORE_KEY = Symbol.for("beliandjolie.whatsapp.sessions.by-tenant");

interface MockSock {
  end: ReturnType<typeof vi.fn>;
}

interface MockStore {
  sock: MockSock | null;
  state: {
    status: string;
    phoneNumber: string | null;
    pairingCode: string | null;
    pairingCodeExpiresAt: Date | null;
    connectedSince: Date | null;
    lastError: string | null;
  };
  starting: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  tenantSlug: string;
  shuttingDown: boolean;
}

function resetStores() {
  const g = globalThis as Record<symbol, unknown>;
  g[STORE_KEY] = new Map<string, MockStore>();
}

function putStore(tenantId: string, store: MockStore) {
  const g = globalThis as Record<symbol, unknown>;
  const map = g[STORE_KEY] as Map<string, MockStore>;
  map.set(tenantId, store);
}

function makeStore(tenantSlug: string, status: string): MockStore {
  return {
    sock: { end: vi.fn() },
    state: {
      status,
      phoneNumber: "33612345678",
      pairingCode: null,
      pairingCodeExpiresAt: null,
      connectedSince: new Date(),
      lastError: null,
    },
    starting: false,
    reconnectTimer: null,
    tenantSlug,
    shuttingDown: false,
  };
}

describe("shutdownAllWhatsappSessions", () => {
  beforeEach(() => {
    resetStores();
  });

  it("ne plante pas si aucune session n'est enregistree", async () => {
    await expect(shutdownAllWhatsappSessions()).resolves.toBeUndefined();
  });

  it("marque chaque store en shuttingDown et appelle sock.end()", async () => {
    const bj = makeStore("beliandjolie", "connected");
    const issyma = makeStore("issyma", "connected");
    putStore("tenant-bj", bj);
    putStore("tenant-issyma", issyma);

    await shutdownAllWhatsappSessions();

    expect(bj.shuttingDown).toBe(true);
    expect(issyma.shuttingDown).toBe(true);
    expect(bj.sock?.end).toHaveBeenCalledTimes(1);
    expect(bj.sock?.end).toHaveBeenCalledWith(undefined);
    expect(issyma.sock?.end).toHaveBeenCalledTimes(1);
  });

  it("annule les timers de reconnexion planifies", async () => {
    const bj = makeStore("beliandjolie", "connecting");
    const timer = setTimeout(() => {
      throw new Error("reconnexion ne doit pas se declencher apres shutdown");
    }, 100);
    bj.reconnectTimer = timer;
    putStore("tenant-bj", bj);

    await shutdownAllWhatsappSessions();

    expect(bj.reconnectTimer).toBeNull();
  });

  it("ne jette pas si sock.end() leve une exception", async () => {
    const bj = makeStore("beliandjolie", "connected");
    bj.sock = {
      end: vi.fn(() => {
        throw new Error("socket deja ferme");
      }),
    };
    putStore("tenant-bj", bj);

    await expect(shutdownAllWhatsappSessions()).resolves.toBeUndefined();
    expect(bj.shuttingDown).toBe(true);
  });

  it("gere les stores sans socket (session jamais demarree)", async () => {
    const bj = makeStore("beliandjolie", "disconnected");
    bj.sock = null;
    putStore("tenant-bj", bj);

    await expect(shutdownAllWhatsappSessions()).resolves.toBeUndefined();
    expect(bj.shuttingDown).toBe(true);
  });

  it("rend la main dans un delai raisonnable (< 2s)", async () => {
    const bj = makeStore("beliandjolie", "connected");
    putStore("tenant-bj", bj);

    const started = Date.now();
    await shutdownAllWhatsappSessions();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000);
  });
});

describe("getWhatsappSessionState (sanity)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("retourne un etat disconnected initial pour un tenant inconnu", () => {
    const state = getWhatsappSessionState("nouveau-tenant", "slug-X");
    expect(state.status).toBe("disconnected");
    expect(state.pairingCode).toBeNull();
    expect(state.connectedSince).toBeNull();
  });
});
