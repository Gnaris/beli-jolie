import { describe, it, expect } from "vitest";
import {
  getRefreshIneligibilityReason,
  labelForIneligibility,
  type RefreshEligibilityInput,
} from "@/lib/refresh-eligibility";

const onlineComplete: RefreshEligibilityInput = {
  status: "ONLINE",
  isIncomplete: false,
  wasImported: false,
};

describe("getRefreshIneligibilityReason", () => {
  it("returns null for an ONLINE, complete, unlocked product", () => {
    expect(getRefreshIneligibilityReason(onlineComplete)).toBeNull();
  });

  it("returns 'archived' for an ARCHIVED product", () => {
    expect(
      getRefreshIneligibilityReason({ ...onlineComplete, status: "ARCHIVED" }),
    ).toBe("archived");
  });

  it("returns 'syncing' for a SYNCING product", () => {
    expect(
      getRefreshIneligibilityReason({ ...onlineComplete, status: "SYNCING" }),
    ).toBe("syncing");
  });

  it("returns 'offline' for an OFFLINE complete product", () => {
    expect(
      getRefreshIneligibilityReason({ ...onlineComplete, status: "OFFLINE" }),
    ).toBe("offline");
  });

  it("returns 'draft' for an OFFLINE incomplete product never imported", () => {
    expect(
      getRefreshIneligibilityReason({
        status: "OFFLINE",
        isIncomplete: true,
        wasImported: false,
      }),
    ).toBe("draft");
  });

  it("returns 'offline' (not 'draft') for an OFFLINE incomplete product that was imported", () => {
    expect(
      getRefreshIneligibilityReason({
        status: "OFFLINE",
        isIncomplete: true,
        wasImported: true,
      }),
    ).toBe("offline");
  });

});

describe("labelForIneligibility", () => {
  it("labels every reason in French", () => {
    expect(labelForIneligibility("archived")).toBe("Archivé");
    expect(labelForIneligibility("offline")).toBe("Hors ligne");
    expect(labelForIneligibility("draft")).toBe("Brouillon");
    expect(labelForIneligibility("syncing")).toBe("Importation en cours");
  });
});
