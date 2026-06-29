import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Toolbar from "@/components/admin/shared/Toolbar";

describe("Toolbar", () => {
  it("affiche search avec placeholder", () => {
    render(<Toolbar searchPlaceholder="Chercher…" searchValue="" onSearchChange={() => {}} />);
    expect(screen.getByPlaceholderText("Chercher…")).toBeInTheDocument();
  });

  it("appelle onSearchChange au input", () => {
    const onSearchChange = vi.fn();
    render(<Toolbar searchPlaceholder="Chercher…" searchValue="" onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByPlaceholderText("Chercher…"), { target: { value: "test" } });
    expect(onSearchChange).toHaveBeenCalledWith("test");
  });

  it("affiche le slot children (chips)", () => {
    render(
      <Toolbar searchPlaceholder="X" searchValue="" onSearchChange={() => {}}>
        <div data-testid="chip">Chip</div>
      </Toolbar>
    );
    expect(screen.getByTestId("chip")).toBeInTheDocument();
  });
});
