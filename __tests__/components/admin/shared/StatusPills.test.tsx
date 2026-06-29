import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import StatusPills from "@/components/admin/shared/StatusPills";

describe("StatusPills", () => {
  const items = [
    { key: "", label: "Tous", count: 2878 },
    { key: "ONLINE", label: "En ligne", count: 2847, dotColor: "#22c55e" },
    { key: "OFFLINE", label: "Hors ligne", count: 0, dotColor: "#9ca3af" },
  ];

  it("affiche tous les pills avec compteurs", () => {
    render(<StatusPills items={items} current="" onChange={() => {}} />);
    expect(screen.getByText("Tous")).toBeInTheDocument();
    expect(screen.getByText("2 878")).toBeInTheDocument();
    expect(screen.getByText("2 847")).toBeInTheDocument();
  });

  it("met le pill actif en noir (bg-ink)", () => {
    render(<StatusPills items={items} current="ONLINE" onChange={() => {}} />);
    const active = screen.getByRole("button", { name: /En ligne/ });
    expect(active.className).toMatch(/bg-ink/);
  });

  it("appelle onChange au clic", () => {
    const onChange = vi.fn();
    render(<StatusPills items={items} current="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /En ligne/ }));
    expect(onChange).toHaveBeenCalledWith("ONLINE");
  });
});
