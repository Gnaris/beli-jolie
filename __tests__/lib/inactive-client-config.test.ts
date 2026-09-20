import { describe, it, expect } from "vitest";
import {
  computeReferenceAt,
  pickFastForwardStage,
  shouldWipeCycle,
  DEFAULT_STAGE_1_DELAY_SECONDS,
  INACTIVE_WORKER_POLL_INTERVAL_MS,
} from "@/lib/inactive-client-config";

describe("inactive-client-config — computeReferenceAt", () => {
  const createdAt = new Date("2025-01-01T00:00:00Z");

  it("retourne createdAt si aucune activité", () => {
    expect(
      computeReferenceAt({ createdAt, lastSeenAt: null, lastOrderAt: null }),
    ).toEqual(createdAt);
  });

  it("retourne lastSeenAt si plus récent", () => {
    const lastSeenAt = new Date("2025-05-15T10:00:00Z");
    expect(
      computeReferenceAt({ createdAt, lastSeenAt, lastOrderAt: null }),
    ).toEqual(lastSeenAt);
  });

  it("retourne lastOrderAt si plus récent que lastSeenAt", () => {
    const lastSeenAt = new Date("2025-03-15T10:00:00Z");
    const lastOrderAt = new Date("2025-04-01T09:00:00Z");
    expect(
      computeReferenceAt({ createdAt, lastSeenAt, lastOrderAt }),
    ).toEqual(lastOrderAt);
  });

  it("retourne lastSeenAt si plus récent que lastOrderAt", () => {
    const lastSeenAt = new Date("2025-05-01T00:00:00Z");
    const lastOrderAt = new Date("2025-04-01T00:00:00Z");
    expect(
      computeReferenceAt({ createdAt, lastSeenAt, lastOrderAt }),
    ).toEqual(lastSeenAt);
  });
});

describe("inactive-client-config — shouldWipeCycle (par commande)", () => {
  it("retourne false si aucun stade envoyé (rien à wiper)", () => {
    expect(shouldWipeCycle(new Date(), null)).toBe(false);
  });

  it("retourne false si aucune commande post-envoi", () => {
    expect(shouldWipeCycle(null, new Date())).toBe(false);
  });

  it("retourne false si commande antérieure au dernier envoi", () => {
    const sentAt = new Date("2025-06-01T10:00:00Z");
    const oldOrder = new Date("2025-05-01T10:00:00Z");
    expect(shouldWipeCycle(oldOrder, sentAt)).toBe(false);
  });

  it("retourne true si commande passée APRÈS le dernier envoi", () => {
    const sentAt = new Date("2025-06-01T10:00:00Z");
    const newOrder = new Date("2025-06-15T14:30:00Z");
    expect(shouldWipeCycle(newOrder, sentAt)).toBe(true);
  });
});

describe("inactive-client-config — pickFastForwardStage", () => {
  const stages = [
    { stageIndex: 1, delaySeconds: 30 * 86400 }, // 30 j
    { stageIndex: 2, delaySeconds: 45 * 86400 }, // 45 j
    { stageIndex: 3, delaySeconds: 60 * 86400 }, // 60 j
  ];

  it("aucun stade dû si elapsed < délai du stade 1", () => {
    expect(pickFastForwardStage(stages, 20 * 86400, 0)).toBeNull();
  });

  it("stade 1 dû si 30j <= elapsed < 45j", () => {
    expect(pickFastForwardStage(stages, 35 * 86400, 0)?.stageIndex).toBe(1);
  });

  it("stade 2 (pas stade 1) si 45j <= elapsed < 60j (fast-forward)", () => {
    // Scénario cliente : client 47 j inactif au moment de l'activation →
    // envoi UNIQUEMENT du stade 2 (pas 1+2 en cascade).
    expect(pickFastForwardStage(stages, 47 * 86400, 0)?.stageIndex).toBe(2);
  });

  it("stade 3 (top) si elapsed >= 60j", () => {
    expect(pickFastForwardStage(stages, 90 * 86400, 0)?.stageIndex).toBe(3);
    expect(pickFastForwardStage(stages, 365 * 86400, 0)?.stageIndex).toBe(3);
  });

  it("skippe les stades <= maxFired (stade 2 déjà envoyé → cherche > 2)", () => {
    // Après un stade 2 envoyé, si elapsed = 47j (moins que 60j), le prochain
    // stade 3 n'est PAS dû → null.
    expect(pickFastForwardStage(stages, 47 * 86400, 2)).toBeNull();
  });

  it("stade 3 dû après un stade 2 déjà envoyé, si elapsed >= 60j", () => {
    expect(pickFastForwardStage(stages, 90 * 86400, 2)?.stageIndex).toBe(3);
  });
});

describe("inactive-client-config — constantes", () => {
  it("DEFAULT_STAGE_1_DELAY_SECONDS = 30 jours", () => {
    expect(DEFAULT_STAGE_1_DELAY_SECONDS).toBe(30 * 86400);
  });

  it("INACTIVE_WORKER_POLL_INTERVAL_MS = 1 min", () => {
    expect(INACTIVE_WORKER_POLL_INTERVAL_MS).toBe(60 * 1000);
  });
});
