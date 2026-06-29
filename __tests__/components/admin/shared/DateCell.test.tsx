import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DateCell from "@/components/admin/shared/DateCell";

describe("DateCell", () => {
  it("affiche createdAt toujours", () => {
    render(<DateCell createdAt="2026-04-01T00:00:00Z" updatedAt="2026-04-01T00:00:00Z" lastRefreshedAt={null} />);
    expect(screen.getByLabelText("Créé")).toBeInTheDocument();
  });

  it("affiche updatedAt seulement si différent de createdAt (>1min)", () => {
    render(<DateCell createdAt="2026-01-01T00:00:00Z" updatedAt="2026-06-30T00:00:00Z" lastRefreshedAt={null} />);
    expect(screen.getByLabelText("Modifié")).toBeInTheDocument();
  });

  it("n'affiche pas updatedAt si égal à createdAt", () => {
    render(<DateCell createdAt="2026-04-01T00:00:00Z" updatedAt="2026-04-01T00:00:00Z" lastRefreshedAt={null} />);
    expect(screen.queryByLabelText("Modifié")).not.toBeInTheDocument();
  });

  it("affiche lastRefreshedAt si fourni", () => {
    render(<DateCell createdAt="2026-01-01T00:00:00Z" updatedAt="2026-01-01T00:00:00Z" lastRefreshedAt="2026-06-29T00:00:00Z" />);
    expect(screen.getByLabelText("Rafraîchi")).toBeInTheDocument();
  });
});
