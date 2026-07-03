import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  FilterPendingProvider,
  useFilterPending,
} from "@/components/admin/products/FilterPendingContext";

function Probe() {
  const { isFiltering, startFiltering } = useFilterPending();
  return (
    <div>
      <span data-testid="pending">{isFiltering ? "yes" : "no"}</span>
      <button
        type="button"
        onClick={() =>
          startFiltering(() => {
            // no-op — juste pour vérifier que la fonction est appelable
          })
        }
      >
        go
      </button>
    </div>
  );
}

describe("FilterPendingContext", () => {
  it("expose isFiltering=false et une fonction startFiltering à l'état initial (via provider)", () => {
    render(
      <FilterPendingProvider>
        <Probe />
      </FilterPendingProvider>,
    );
    expect(screen.getByTestId("pending").textContent).toBe("no");
    // Le clic sur "go" ne doit rien casser même si startFiltering ne fait rien
    // de spécial ici (test uniquement le contrat d'API).
    act(() => {
      screen.getByText("go").click();
    });
    // Après un microtask, la transition (vide) doit être terminée.
    expect(screen.getByTestId("pending").textContent).toBe("no");
  });

  it("fournit un fallback local (useTransition) quand aucun provider n'entoure l'arbre", () => {
    // Le hook doit rester utilisable sur d'autres pages (ex : tests unitaires
    // isolés) sans crasher — le fallback local préserve l'API.
    render(<Probe />);
    expect(screen.getByTestId("pending").textContent).toBe("no");
    act(() => {
      screen.getByText("go").click();
    });
    expect(screen.getByTestId("pending").textContent).toBe("no");
  });
});
