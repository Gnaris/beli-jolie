import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MappingCard from "@/components/admin/shared/MappingCard";

describe("MappingCard", () => {
  it("affiche le logo + nom + sous-titre", () => {
    render(
      <MappingCard
        logo="PFS" logoKind="pfs"
        name="PFS" sub="Référence dans la bibliothèque PFS"
        linked={false}
        selectLabel=""
        onSelectClick={() => {}}
      />
    );
    expect(screen.getByText(/Référence/)).toBeInTheDocument();
  });

  it("affiche badge ✓ lié quand linked=true", () => {
    render(
      <MappingCard
        logo="PFS" logoKind="pfs" name="PFS" sub=""
        linked
        selectLabel="GOLDEN_PINK"
        onSelectClick={() => {}}
        onClear={() => {}}
      />
    );
    expect(screen.getByText(/lié/)).toBeInTheDocument();
  });

  it("affiche ✕ uniquement si linked, et appelle onClear", () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <MappingCard logo="P" logoKind="pfs" name="N" sub="" linked={false} selectLabel="" onSelectClick={() => {}} />
    );
    expect(screen.queryByLabelText("Délier")).not.toBeInTheDocument();

    rerender(
      <MappingCard logo="P" logoKind="pfs" name="N" sub="" linked selectLabel="X" onSelectClick={() => {}} onClear={onClear} />
    );
    fireEvent.click(screen.getByLabelText("Délier"));
    expect(onClear).toHaveBeenCalled();
  });
});
