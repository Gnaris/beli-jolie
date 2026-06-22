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

  describe("locked flag", () => {
    it("returns 'locked' for an ONLINE complete product when locked=true", () => {
      expect(
        getRefreshIneligibilityReason({ ...onlineComplete, locked: true }),
      ).toBe("locked");
    });

    it("returns 'locked' (takes priority over 'archived') when locked=true", () => {
      expect(
        getRefreshIneligibilityReason({
          status: "ARCHIVED",
          isIncomplete: false,
          wasImported: false,
          locked: true,
        }),
      ).toBe("locked");
    });

    it("returns 'locked' (takes priority over 'offline') when locked=true", () => {
      expect(
        getRefreshIneligibilityReason({
          status: "OFFLINE",
          isIncomplete: false,
          wasImported: false,
          locked: true,
        }),
      ).toBe("locked");
    });

    it("returns null when locked is explicitly false on an eligible product", () => {
      expect(
        getRefreshIneligibilityReason({ ...onlineComplete, locked: false }),
      ).toBeNull();
    });

    it("returns null when locked is omitted on an eligible product (back-compat)", () => {
      expect(getRefreshIneligibilityReason(onlineComplete)).toBeNull();
    });
  });
});

describe("labelForIneligibility", () => {
  it("labels every reason in French", () => {
    expect(labelForIneligibility("locked")).toBe("Verrouillé");
    expect(labelForIneligibility("archived")).toBe("Archivé");
    expect(labelForIneligibility("offline")).toBe("Hors ligne");
    expect(labelForIneligibility("draft")).toBe("Brouillon");
    expect(labelForIneligibility("syncing")).toBe("Importation en cours");
  });
});
