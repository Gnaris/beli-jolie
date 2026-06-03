/**
 * Tests pour lib/online-status.ts
 *
 * Règle : un client est « en ligne » s'il a envoyé un heartbeat dans
 * la dernière minute (ONLINE_WINDOW_MS = 60_000 ms). Le ping côté
 * client se déclenche toutes les 30s, ce qui laisse une tolérance de
 * 1 ping raté avant de basculer en hors ligne.
 */
import { describe, it, expect } from "vitest";
import {
  isOnline,
  getOnlineThreshold,
  ONLINE_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/online-status";

describe("isOnline", () => {
  const now = new Date("2026-06-03T12:00:00.000Z");

  it("retourne false quand lastSeenAt est null", () => {
    expect(isOnline(null, now)).toBe(false);
  });

  it("retourne false quand lastSeenAt est undefined", () => {
    expect(isOnline(undefined, now)).toBe(false);
  });

  it("retourne true quand le dernier ping date d'il y a 10 secondes", () => {
    const ago = new Date(now.getTime() - 10_000);
    expect(isOnline(ago, now)).toBe(true);
  });

  it("retourne true à la limite haute (juste avant ONLINE_WINDOW_MS)", () => {
    const ago = new Date(now.getTime() - (ONLINE_WINDOW_MS - 1));
    expect(isOnline(ago, now)).toBe(true);
  });

  it("retourne false pile à ONLINE_WINDOW_MS (strictement <)", () => {
    const ago = new Date(now.getTime() - ONLINE_WINDOW_MS);
    expect(isOnline(ago, now)).toBe(false);
  });

  it("retourne false quand le dernier ping date de plus d'une minute", () => {
    const ago = new Date(now.getTime() - 5 * 60_000);
    expect(isOnline(ago, now)).toBe(false);
  });

  it("tolère 1 ping manqué (HEARTBEAT_INTERVAL_MS = 30s, fenêtre 60s)", () => {
    // Un client a pingué il y a 35s : il a raté son tick à 30s
    // mais n'est pas encore considéré hors ligne.
    const ago = new Date(now.getTime() - (HEARTBEAT_INTERVAL_MS + 5_000));
    expect(isOnline(ago, now)).toBe(true);
  });

  it("utilise new Date() par défaut quand `now` est omis", () => {
    const ago = new Date(Date.now() - 5_000);
    expect(isOnline(ago)).toBe(true);
  });
});

describe("getOnlineThreshold", () => {
  it("renvoie `now - ONLINE_WINDOW_MS`", () => {
    const now = new Date("2026-06-03T12:00:00.000Z");
    const threshold = getOnlineThreshold(now);
    expect(threshold.getTime()).toBe(now.getTime() - ONLINE_WINDOW_MS);
  });

  it("symétrique avec isOnline : un lastSeenAt = threshold est PILE hors ligne", () => {
    const now = new Date("2026-06-03T12:00:00.000Z");
    const threshold = getOnlineThreshold(now);
    expect(isOnline(threshold, now)).toBe(false);

    // …et juste 1ms après le threshold est en ligne
    const justAfter = new Date(threshold.getTime() + 1);
    expect(isOnline(justAfter, now)).toBe(true);
  });
});
