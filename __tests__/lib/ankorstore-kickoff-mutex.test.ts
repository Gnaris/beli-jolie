import { describe, it, expect, beforeEach } from "vitest";
import {
  ankorstoreKickoffMutex,
  __resetAnkorstoreKickoffMutex,
} from "@/lib/ankorstore-kickoff-mutex";

describe("ankorstoreKickoffMutex", () => {
  beforeEach(() => {
    __resetAnkorstoreKickoffMutex();
  });

  it("sérialise les tâches enqueuées en parallèle (pas de chevauchement)", async () => {
    const timeline: string[] = [];
    const makeTask = (label: string, delayMs: number) => async () => {
      timeline.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, delayMs));
      timeline.push(`${label}:end`);
      return label;
    };

    // 3 tâches lancées simultanément avec des durées différentes.
    // Si elles s'exécutaient en parallèle, B (10ms) finirait avant A (30ms).
    // Le mutex doit forcer l'ordre d'enqueue : A → B → C, chacune complète
    // avant que la suivante ne commence.
    const results = await Promise.all([
      ankorstoreKickoffMutex(makeTask("A", 30)),
      ankorstoreKickoffMutex(makeTask("B", 10)),
      ankorstoreKickoffMutex(makeTask("C", 20)),
    ]);

    expect(results).toEqual(["A", "B", "C"]);
    expect(timeline).toEqual([
      "A:start", "A:end",
      "B:start", "B:end",
      "C:start", "C:end",
    ]);
  });

  it("continue la chaîne même si une tâche échoue (une erreur ne bloque pas les suivantes)", async () => {
    const order: string[] = [];

    const failing = ankorstoreKickoffMutex(async () => {
      order.push("failing:start");
      throw new Error("boom");
    });
    const following = ankorstoreKickoffMutex(async () => {
      order.push("following:start");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("ok");
    expect(order).toEqual(["failing:start", "following:start"]);
  });

  it("retourne la valeur produite par la tâche wrapée", async () => {
    const result = await ankorstoreKickoffMutex(async () => ({
      operationId: "op_123",
      success: true,
    }));
    expect(result).toEqual({ operationId: "op_123", success: true });
  });

  it("garantit qu'aucune tâche ne démarre pendant qu'une autre tourne", async () => {
    let running = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }).map((_, i) =>
      ankorstoreKickoffMutex(async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxConcurrent).toBe(1);
  });
});
