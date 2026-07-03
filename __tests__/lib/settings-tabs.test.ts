import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, settingsTabMetadata, isSettingsTab } from "@/lib/settings-tabs";

describe("settingsTabMetadata", () => {
  it("retourne un label et une description pour chaque onglet connu", () => {
    for (const tab of SETTINGS_TABS) {
      const m = settingsTabMetadata(tab);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(20);
    }
  });

  it("chaque label est unique", () => {
    const labels = SETTINGS_TABS.map((t) => settingsTabMetadata(t).label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("isSettingsTab", () => {
  it("accepte les onglets connus", () => {
    expect(isSettingsTab("general")).toBe(true);
    expect(isSettingsTab("societe")).toBe(true);
    expect(isSettingsTab("marketplaces")).toBe(true);
  });

  it("rejette les valeurs inconnues", () => {
    expect(isSettingsTab("unknown")).toBe(false);
    expect(isSettingsTab("")).toBe(false);
    expect(isSettingsTab("GENERAL")).toBe(false);
  });
});
