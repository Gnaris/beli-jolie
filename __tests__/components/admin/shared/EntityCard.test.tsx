import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EntityCard from "@/components/admin/shared/EntityCard";

describe("EntityCard", () => {
  it("affiche le visuel + nom + sous-titre", () => {
    render(
      <EntityCard
        visual={<div data-testid="vis">V</div>}
        name="Or rosé"
        sub="#D4A373"
        badges={[{ label: "● 312", kind: "neutral" }]}
        onClick={() => {}}
      />
    );
    expect(screen.getByTestId("vis")).toBeInTheDocument();
    expect(screen.getByText("Or rosé")).toBeInTheDocument();
  });

  it("affiche les badges", () => {
    render(
      <EntityCard
        visual={<div />}
        name="X"
        sub=""
        badges={[
          { label: "● 312", kind: "neutral" },
          { label: "FR · EN", kind: "ok" },
          { label: "⚠ EN manquant", kind: "warn" },
        ]}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("● 312")).toBeInTheDocument();
    expect(screen.getByText("FR · EN")).toBeInTheDocument();
    expect(screen.getByText(/EN manquant/)).toBeInTheDocument();
  });

  it("checkbox apparaît + onSelect", () => {
    const onSelect = vi.fn();
    render(
      <EntityCard
        visual={<div />}
        name="X"
        sub=""
        badges={[]}
        onClick={() => {}}
        selected={false}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByLabelText("Sélectionner"));
    expect(onSelect).toHaveBeenCalledWith(true);
  });
});
