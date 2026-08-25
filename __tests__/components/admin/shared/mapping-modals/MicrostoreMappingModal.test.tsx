import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* ── Mocks ─────────────────────────────────────────────────────────────── */

// MicrostoreAttributeSelect appelle des server actions au mount — on le stub
// avec un select synchrone contrôlé pour tester l'enveloppe (état, save, close).
vi.mock("@/components/admin/shared/MicrostoreAttributeSelect", () => ({
  MicrostoreAttributeSelect: ({
    value,
    onChange,
  }: {
    value: number | null;
    onChange: (v: number | null) => void;
  }) => (
    <input
      data-testid="ms-select"
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  ),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import MicrostoreMappingModal from "@/components/admin/shared/mapping-modals/MicrostoreMappingModal";

/* ── Setup ─────────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("MicrostoreMappingModal", () => {
  it("ne rend rien quand open=false", () => {
    const { container } = render(
      <MicrostoreMappingModal
        open={false}
        onClose={() => {}}
        entityLabel="Catégorie « Bague »"
        kind="category"
        currentValue={null}
        onSave={async () => {}}
      />,
    );
    expect(container.querySelector("h3")).toBeNull();
  });

  it("affiche le titre Microstore et l'eyebrow avec l'entité", () => {
    render(
      <MicrostoreMappingModal
        open
        onClose={() => {}}
        entityLabel="Catégorie « Bague »"
        kind="category"
        currentValue={null}
        onSave={async () => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: /Microstore/i })).toBeInTheDocument();
    expect(screen.getByText(/Catégorie « Bague »/i)).toBeInTheDocument();
  });

  it("pré-remplit le select avec currentValue", () => {
    render(
      <MicrostoreMappingModal
        open
        onClose={() => {}}
        entityLabel="Catégorie « Bague »"
        kind="category"
        currentValue={42}
        onSave={async () => {}}
      />,
    );
    const input = screen.getByTestId("ms-select") as HTMLInputElement;
    expect(input.value).toBe("42");
  });

  it("appelle onSave avec la nouvelle valeur puis onClose au save", async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    render(
      <MicrostoreMappingModal
        open
        onClose={onClose}
        entityLabel="Catégorie « Bague »"
        kind="category"
        currentValue={null}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByTestId("ms-select"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("affiche une erreur si onSave rejette et NE ferme PAS le modal", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Boom Microstore");
    });
    const onClose = vi.fn();
    render(
      <MicrostoreMappingModal
        open
        onClose={onClose}
        entityLabel="Catégorie « Bague »"
        kind="category"
        currentValue={null}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));
    await waitFor(() => expect(screen.getByText(/Boom Microstore/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("click sur « Annuler » appelle onClose sans sauvegarder", () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    render(
      <MicrostoreMappingModal
        open
        onClose={onClose}
        entityLabel="Catégorie « Bague »"
        kind="category"
        currentValue={null}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Annuler$/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
