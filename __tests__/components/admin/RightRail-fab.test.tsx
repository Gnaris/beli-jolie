import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useEffect } from "react";
import { RightRail } from "@/components/admin/widgets-rail/RightRail";
import { RightRailProvider, useRightRail } from "@/components/admin/widgets-rail/RightRailContext";

// Nouveau widget flottant (FAB en bas à droite + mini-menu qui se déploie).
// Validé par la cliente le 2026-07-13 — remplace l'ancien rail latéral droit
// pour libérer la largeur du contenu admin.

function Wrapped() {
  return (
    <RightRailProvider>
      <RightRail />
    </RightRailProvider>
  );
}

// Helper : monte le rail + un composant qui pose des badges via le contexte,
// pour tester l'affichage du badge cumul et du halo pulsant.
function WithBadges() {
  const { setBadge } = useRightRail();
  useEffect(() => {
    setBadge("marketplaces", { count: 5, pulse: true });
    setBadge("shooting", { count: 2 });
    setBadge("images", { count: 12 });
  }, [setBadge]);
  return <RightRail />;
}

function WithBadgesWrapped() {
  return (
    <RightRailProvider>
      <WithBadges />
    </RightRailProvider>
  );
}

// Helper : ouvre un tiroir depuis l'extérieur pour vérifier le comportement
// du FAB quand un panneau est déjà ouvert.
function WithOpener({ target }: { target: "marketplaces" | "chat" }) {
  const { open } = useRightRail();
  return (
    <>
      <button data-testid="opener" onClick={() => open(target)}>
        open
      </button>
      <RightRail />
    </>
  );
}

function WithOpenerWrapped({ target }: { target: "marketplaces" | "chat" }) {
  return (
    <RightRailProvider>
      <WithOpener target={target} />
    </RightRailProvider>
  );
}

describe("RightRail — FAB flottant", () => {
  it("affiche un unique bouton FAB au montage, mini-menu fermé", () => {
    render(<Wrapped />);
    const fab = screen.getByRole("button", { name: /ouvrir le menu widgets/i });
    expect(fab).toBeInTheDocument();
    // Pas de mini-bouton visible tant que le FAB n'a pas été cliqué.
    expect(screen.queryByRole("button", { name: /marketplaces/i })).not.toBeInTheDocument();
  });

  it("clic FAB déploie le mini-menu avec les 5 raccourcis", () => {
    render(<Wrapped />);
    const fab = screen.getByRole("button", { name: /ouvrir le menu widgets/i });
    fireEvent.click(fab);

    // Les 5 mini-boutons sont maintenant visibles (ordre indifférent).
    expect(screen.getByRole("button", { name: /^marketplaces$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shooting efashion/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import masse images/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /messages clients/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /traductions/i })).toBeInTheDocument();
  });

  it("clic FAB une deuxième fois referme le mini-menu", () => {
    render(<Wrapped />);
    const fab = screen.getByRole("button", { name: /ouvrir le menu widgets/i });
    fireEvent.click(fab);
    expect(screen.getByRole("button", { name: /^marketplaces$/i })).toBeInTheDocument();

    // Après ouverture, l'aria-label du FAB devient exactement « Fermer le menu ».
    const fabAfter = screen.getByRole("button", { name: /^fermer le menu$/i });
    fireEvent.click(fabAfter);
    expect(screen.queryByRole("button", { name: /^marketplaces$/i })).not.toBeInTheDocument();
  });

  it("clic sur un mini-bouton ouvre le tiroir associé (setOpenWidget)", () => {
    render(<Wrapped />);
    fireEvent.click(screen.getByRole("button", { name: /ouvrir le menu widgets/i }));
    fireEvent.click(screen.getByRole("button", { name: /^marketplaces$/i }));

    // Le mini-menu doit se refermer une fois le tiroir demandé.
    expect(screen.queryByRole("button", { name: /^marketplaces$/i })).not.toBeInTheDocument();
    // Le FAB passe en mode « fermer le panneau ».
    expect(screen.getByRole("button", { name: /fermer le panneau/i })).toBeInTheDocument();
  });

  it("badge cumul agrège les compteurs de toutes les files", () => {
    render(<WithBadgesWrapped />);
    // 5 + 2 + 12 = 19
    expect(screen.getByLabelText(/19 tâches en cours/i)).toBeInTheDocument();
  });

  it("quand un tiroir est ouvert, clic FAB le ferme sans rouvrir le menu", () => {
    render(<WithOpenerWrapped target="marketplaces" />);
    fireEvent.click(screen.getByTestId("opener"));

    // Le FAB affiche « Fermer le panneau »
    const fab = screen.getByRole("button", { name: /fermer le panneau/i });
    fireEvent.click(fab);

    // Après clic, le FAB doit revenir à son état initial (menu widgets à ouvrir),
    // pas afficher le mini-menu.
    expect(screen.getByRole("button", { name: /ouvrir le menu widgets/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^marketplaces$/i })).not.toBeInTheDocument();
  });

  it("touche Escape referme le mini-menu ouvert", () => {
    render(<Wrapped />);
    fireEvent.click(screen.getByRole("button", { name: /ouvrir le menu widgets/i }));
    expect(screen.getByRole("button", { name: /^marketplaces$/i })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(screen.queryByRole("button", { name: /^marketplaces$/i })).not.toBeInTheDocument();
  });

  it("clic backdrop referme le mini-menu", () => {
    render(<Wrapped />);
    fireEvent.click(screen.getByRole("button", { name: /ouvrir le menu widgets/i }));
    fireEvent.click(screen.getByTestId("rail-backdrop"));

    // Après le clic, le mini-menu est refermé.
    expect(screen.queryByRole("button", { name: /^marketplaces$/i })).not.toBeInTheDocument();
  });
});
