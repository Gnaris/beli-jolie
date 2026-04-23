import { describe, it, expect } from "vitest";
import { PfsImportCancelledError } from "@/lib/pfs-import";

describe("PfsImportCancelledError", () => {
  it("a le bon nom pour être détectée via instanceof + name", () => {
    const err = new PfsImportCancelledError();
    expect(err).toBeInstanceOf(PfsImportCancelledError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PfsImportCancelledError");
  });

  it("a un message par défaut en français", () => {
    expect(new PfsImportCancelledError().message).toBe("Import annulé");
  });

  it("accepte un message personnalisé", () => {
    expect(new PfsImportCancelledError("Annulé par l'admin").message).toBe("Annulé par l'admin");
  });

  it("se distingue d'une Error générique", () => {
    const generic = new Error("autre chose");
    expect(generic instanceof PfsImportCancelledError).toBe(false);
  });
});
