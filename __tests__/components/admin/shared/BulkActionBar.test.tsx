import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BulkActionBar, { BulkAction } from "@/components/admin/shared/BulkActionBar";

describe("BulkActionBar", () => {
  const actions: BulkAction[] = [
    { id: "publish", label: "Mettre en ligne", icon: "●", group: "status" },
    { id: "offline", label: "Hors ligne", icon: "◯", group: "status", disabled: true },
    { id: "delete", label: "Supprimer", icon: "🗑", group: "danger", danger: true },
  ];

  it("affiche compteur + actions", () => {
    render(<BulkActionBar count={3} actions={actions} onAction={() => {}} onDeselect={() => {}} />);
    expect(screen.getByText("3 sélectionnés")).toBeInTheDocument();
    expect(screen.getByText("Mettre en ligne")).toBeInTheDocument();
  });

  it("appelle onAction(id) au clic", () => {
    const onAction = vi.fn();
    render(<BulkActionBar count={1} actions={actions} onAction={onAction} onDeselect={() => {}} />);
    fireEvent.click(screen.getByText("Supprimer"));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("respecte disabled (clic ne déclenche pas)", () => {
    const onAction = vi.fn();
    render(<BulkActionBar count={1} actions={actions} onAction={onAction} onDeselect={() => {}} />);
    fireEvent.click(screen.getByText("Hors ligne"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("appelle onDeselect", () => {
    const onDeselect = vi.fn();
    render(<BulkActionBar count={2} actions={actions} onAction={() => {}} onDeselect={onDeselect} />);
    fireEvent.click(screen.getByText(/Désélectionner/));
    expect(onDeselect).toHaveBeenCalled();
  });
});
