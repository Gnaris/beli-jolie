import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDragReorder, DragHandle, dropIndicatorClass } from "@/components/admin/shared/useDragReorder";

// jsdom renvoie un rect vide → on force chaque ligne à occuper y=[100, 140]
// afin de piloter le côté « above » / « below » via clientY.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { top: 100, left: 0, right: 100, bottom: 140, width: 100, height: 40, x: 0, y: 100, toJSON: () => ({}) } as DOMRect;
  };
});

// Composant de test qui expose le hook sur une liste très simple.
function Harness({
  ids,
  onReorder,
  locked,
  canDropOn,
}: {
  ids: string[];
  onReorder: (next: string[]) => void;
  locked?: (id: string) => boolean;
  canDropOn?: (a: string, b: string) => boolean;
}) {
  const { bind, overId, overPos } = useDragReorder({
    orderedIds: ids,
    isLocked: locked,
    canDropOn,
    onReorder,
  });
  return (
    <div>
      {ids.map((id) => {
        const b = bind(id);
        return (
          <div
            key={id}
            data-testid={`row-${id}`}
            draggable={b.draggable}
            onDragStart={b.onDragStart}
            onDragEnd={b.onDragEnd}
            onDragOver={b.onDragOver}
            onDragLeave={b.onDragLeave}
            onDrop={b.onDrop}
            className={dropIndicatorClass(overId, overPos, id)}
          >
            {id}
          </div>
        );
      })}
    </div>
  );
}

// Utilitaires — jsdom ne fournit pas de vrai DataTransfer.
function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    effectAllowed: "" as string,
    dropEffect: "" as string,
    setData: (key: string, value: string) => { data[key] = value; },
    getData: (key: string) => data[key] ?? "",
    types: [] as string[],
  } as unknown as DataTransfer;
}

// fireEvent.drop crée un Event nu qui ne porte pas de clientY. On construit
// une DragEvent (héritière de MouseEvent) manuellement pour transporter la
// coordonnée jusqu'au handler.
function fireDrag(type: string, target: HTMLElement, clientY: number, dt: DataTransfer) {
  const evt = createEvent[type as "dragStart"](target) as unknown as MouseEvent & { dataTransfer: DataTransfer; clientY: number };
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dt, configurable: true });
  fireEvent(target, evt);
}

function drop(fromEl: HTMLElement, toEl: HTMLElement, above = true) {
  const dt = makeDataTransfer();
  // rect target = top:100 bottom:140 → midpoint 120.
  const clientY = above ? 105 : 135;
  fireDrag("dragStart", fromEl, clientY, dt);
  fireDrag("dragOver", toEl, clientY, dt);
  fireDrag("drop", toEl, clientY, dt);
  fireDrag("dragEnd", fromEl, clientY, dt);
}

describe("useDragReorder", () => {
  it("déplace un élément avant la cible quand on drop dans la moitié haute", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c"]} onReorder={onReorder} />);
    // Déplace "c" au-dessus de "a"
    drop(screen.getByTestId("row-c"), screen.getByTestId("row-a"), true);
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("déplace un élément après la cible quand on drop dans la moitié basse", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c"]} onReorder={onReorder} />);
    // Déplace "a" sous "b" → doit donner ["b", "a", "c"]
    drop(screen.getByTestId("row-a"), screen.getByTestId("row-b"), false);
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("ne fait rien quand on drop sur soi-même", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b"]} onReorder={onReorder} />);
    drop(screen.getByTestId("row-a"), screen.getByTestId("row-a"), true);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("un item verrouillé n'est ni draggable ni droppable", () => {
    const onReorder = vi.fn();
    render(
      <Harness
        ids={["a", "b"]}
        onReorder={onReorder}
        locked={(id) => id === "a"}
      />
    );
    expect(screen.getByTestId("row-a")).toHaveAttribute("draggable", "false");
    // Drop sur un verrouillé : rien
    drop(screen.getByTestId("row-b"), screen.getByTestId("row-a"), true);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("canDropOn bloque les drops cross-groupe", () => {
    const onReorder = vi.fn();
    // Deux groupes : {a, b} et {c, d}. On ne peut pas dropper cross-groupe.
    const group = (id: string) => (id === "a" || id === "b" ? "G1" : "G2");
    render(
      <Harness
        ids={["a", "b", "c", "d"]}
        onReorder={onReorder}
        canDropOn={(from, to) => group(from) === group(to)}
      />
    );
    // b → c : bloqué (cross-groupe)
    drop(screen.getByTestId("row-b"), screen.getByTestId("row-c"), true);
    expect(onReorder).not.toHaveBeenCalled();
    // b → a : autorisé (même groupe)
    drop(screen.getByTestId("row-b"), screen.getByTestId("row-a"), true);
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c", "d"]);
  });
});

describe("dropIndicatorClass", () => {
  it("renvoie une chaîne vide si l'id ne correspond pas", () => {
    expect(dropIndicatorClass("a", "above", "b")).toBe("");
  });
  it("applique before:* pour above", () => {
    expect(dropIndicatorClass("a", "above", "a")).toContain("before:");
  });
  it("applique after:* pour below", () => {
    expect(dropIndicatorClass("a", "below", "a")).toContain("after:");
  });
});

describe("DragHandle", () => {
  it("expose un aria-label", () => {
    render(<DragHandle />);
    expect(screen.getByLabelText(/Glisser/i)).toBeInTheDocument();
  });
  it("passe en disabled + curseur bloqué", () => {
    const { container } = render(<DragHandle disabled />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/opacity-30/);
    expect(el.className).toMatch(/cursor-not-allowed/);
  });
});
