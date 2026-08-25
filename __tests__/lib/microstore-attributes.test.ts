/**
 * Tests unitaires pour lib/microstore-attributes.ts — focus sur `buildCatOrder`
 * qui est la seule fonction pure (le reste fait des appels réseau).
 */

import { describe, it, expect } from "vitest";
import { buildCatOrder } from "@/lib/microstore-attributes";

describe("buildCatOrder", () => {
  const CURRENT = ["-11", "0", "532", "531", "527", "526"];

  it("passthrough sans insert/remove", () => {
    expect(buildCatOrder({ currentIds: CURRENT })).toEqual(CURRENT);
  });

  it("insère un alias 'new52' en position 5 (0-indexé)", () => {
    const out = buildCatOrder({
      currentIds: CURRENT,
      insertAlias: { alias: "new52", atIndex: 5 },
    });
    expect(out).toEqual(["-11", "0", "532", "531", "527", "new52", "526"]);
  });

  it("insère en tête (atIndex=0)", () => {
    const out = buildCatOrder({
      currentIds: CURRENT,
      insertAlias: { alias: "new1", atIndex: 0 },
    });
    expect(out[0]).toBe("new1");
    expect(out).toHaveLength(CURRENT.length + 1);
  });

  it("insère en fin (atIndex > length → clamp)", () => {
    const out = buildCatOrder({
      currentIds: CURRENT,
      insertAlias: { alias: "newXX", atIndex: 999 },
    });
    expect(out[out.length - 1]).toBe("newXX");
  });

  it("retire un id existant", () => {
    const out = buildCatOrder({ currentIds: CURRENT, removeId: "527" });
    expect(out).toEqual(["-11", "0", "532", "531", "526"]);
  });

  it("retire un id inconnu = no-op", () => {
    const out = buildCatOrder({ currentIds: CURRENT, removeId: "9999" });
    expect(out).toEqual(CURRENT);
  });

  it("combine remove + insert (rare, mais logique doit tenir)", () => {
    const out = buildCatOrder({
      currentIds: CURRENT,
      removeId: "527",
      insertAlias: { alias: "newA", atIndex: 1 },
    });
    // Order: remove first, then insert
    expect(out).toEqual(["-11", "newA", "0", "532", "531", "526"]);
  });
});
