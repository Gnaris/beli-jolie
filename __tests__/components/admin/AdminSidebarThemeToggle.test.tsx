import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/actions/admin/admin-theme", () => ({
  setAdminTheme: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/admin-theme-transition", () => ({
  applyAdminThemeWithTransition: vi.fn(),
}));

import AdminSidebarThemeToggle from "@/components/admin/AdminSidebarThemeToggle";

describe("AdminSidebarThemeToggle", () => {
  it("rend les 2 boutons clair/sombre en layout sidebar (par défaut)", () => {
    render(<AdminSidebarThemeToggle initialTheme="light" />);
    const light = screen.getByRole("button", { name: /mode clair/i });
    const dark = screen.getByRole("button", { name: /mode sombre/i });
    expect(light).toBeInTheDocument();
    expect(dark).toBeInTheDocument();
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");
    // Les labels texte restent masqués (max-w-0 + opacity-0) tant que la
    // sidebar n'est pas expand au survol — mais sont présents dans le DOM
    // pour une transition fluide.
    const label = screen.getByText("Mode clair");
    expect(label.className).toMatch(/max-w-0/);
    expect(label.className).toMatch(/opacity-0/);
  });

  it("révèle les labels quand la sidebar est expand (survol)", () => {
    render(<AdminSidebarThemeToggle initialTheme="light" expanded />);
    const light = screen.getByText("Mode clair");
    const dark = screen.getByText("Mode sombre");
    expect(light.className).toMatch(/max-w-\[160px\]/);
    expect(light.className).toMatch(/opacity-100/);
    expect(dark.className).toMatch(/max-w-\[160px\]/);
    expect(dark.className).toMatch(/opacity-100/);
  });

  it("rend les 2 boutons avec labels texte en layout drawer (nav mobile)", () => {
    render(<AdminSidebarThemeToggle initialTheme="dark" layout="drawer" />);
    expect(screen.getByText("Clair")).toBeInTheDocument();
    expect(screen.getByText("Sombre")).toBeInTheDocument();
    const dark = screen.getByRole("button", { name: /mode sombre/i });
    expect(dark).toHaveAttribute("aria-pressed", "true");
  });
});
