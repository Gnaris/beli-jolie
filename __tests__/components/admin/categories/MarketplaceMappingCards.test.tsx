import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MarketplaceMappingCards from "@/components/admin/categories/MarketplaceMappingCards";

describe("MarketplaceMappingCards", () => {
  it("affiche les 5 marketplaces (PFS, eFashion, Faire, Orderchamp, Microstore)", () => {
    render(
      <MarketplaceMappingCards
        pfsLabel="Femme › Bijoux › Colliers"
        efashionLabel="Femme › Bijoux"
        faireLabel={null}
        orderchampLabel={null}
        microstoreLabel={null}
        onEditMapping={() => {}}
      />,
    );
    expect(screen.getByText("PFS")).toBeInTheDocument();
    expect(screen.getByText("eFashion")).toBeInTheDocument();
    expect(screen.getByText("Faire")).toBeInTheDocument();
    expect(screen.getByText("Orderchamp")).toBeInTheDocument();
    expect(screen.getByText("Microstore")).toBeInTheDocument();
  });
  it("carte non mappée affiche 'Non mappé' en italique", () => {
    render(
      <MarketplaceMappingCards
        pfsLabel={null}
        efashionLabel={null}
        faireLabel={null}
        orderchampLabel={null}
        microstoreLabel={null}
        onEditMapping={() => {}}
      />,
    );
    expect(screen.getAllByText(/Non mappé/i).length).toBe(5);
  });
  it("click sur Modifier appelle onEditMapping avec la marketplace", () => {
    const onEdit = vi.fn();
    render(
      <MarketplaceMappingCards
        pfsLabel="x"
        efashionLabel="y"
        faireLabel="z"
        orderchampLabel="oc"
        microstoreLabel="ms"
        onEditMapping={onEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Modifier le mapping PFS/i }));
    expect(onEdit).toHaveBeenCalledWith("pfs");
  });
});
