import { describe, it, expect } from "vitest";
import { faireLifecycleFromStatus } from "@/lib/faire-update";

describe("faireLifecycleFromStatus", () => {
  it("ONLINE → PUBLISHED", () => {
    expect(faireLifecycleFromStatus("ONLINE")).toBe("PUBLISHED");
  });

  it("OFFLINE → UNPUBLISHED (cache le produit côté acheteurs Faire)", () => {
    expect(faireLifecycleFromStatus("OFFLINE")).toBe("UNPUBLISHED");
  });

  it("ARCHIVED → UNPUBLISHED", () => {
    expect(faireLifecycleFromStatus("ARCHIVED")).toBe("UNPUBLISHED");
  });

  it("SYNCING → PUBLISHED (état transitoire, pas de raison de cacher)", () => {
    expect(faireLifecycleFromStatus("SYNCING")).toBe("PUBLISHED");
  });
});
