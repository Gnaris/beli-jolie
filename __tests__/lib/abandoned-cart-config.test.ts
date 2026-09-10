import { describe, it, expect } from "vitest";
import {
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  UNSUBSCRIBE_TOKEN,
  extractLastSentFromFired,
  fromSeconds,
  toSeconds,
  formatCountdown,
  formatDurationShort,
  templateHasUnsubscribeLink,
  validateStages,
} from "@/lib/abandoned-cart-config";
import { decideResumeAction, pickNextStage } from "@/lib/abandoned-cart-trigger";
import type { NewsletterBlock } from "@/lib/newsletter-blocks";

describe("abandoned-cart-config — conversions unité", () => {
  it("toSeconds convertit correctement chaque unité", () => {
    expect(toSeconds(1, "seconds")).toBe(1);
    expect(toSeconds(2, "minutes")).toBe(120);
    expect(toSeconds(3, "hours")).toBe(10800);
    expect(toSeconds(1, "days")).toBe(86400);
  });

  it("toSeconds tronque les valeurs négatives à 0", () => {
    expect(toSeconds(-5, "hours")).toBe(0);
  });

  it("fromSeconds choisit la plus grande unité entière", () => {
    expect(fromSeconds(0)).toEqual({ value: 0, unit: "seconds" });
    expect(fromSeconds(45)).toEqual({ value: 45, unit: "seconds" });
    expect(fromSeconds(120)).toEqual({ value: 2, unit: "minutes" });
    expect(fromSeconds(3600)).toEqual({ value: 1, unit: "hours" });
    expect(fromSeconds(86400 * 3)).toEqual({ value: 3, unit: "days" });
  });

  it("fromSeconds retombe sur secondes si non divisible", () => {
    expect(fromSeconds(90)).toEqual({ value: 90, unit: "seconds" });
  });
});

describe("abandoned-cart-config — validateStages", () => {
  it("aucune erreur sur liste vide (traité comme automatisation off)", () => {
    expect(validateStages([])).toEqual([]);
  });

  it("refuse un délai < MIN_DELAY_SECONDS", () => {
    const errs = validateStages([
      { stageIndex: 1, delaySeconds: MIN_DELAY_SECONDS - 1 },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("DELAY_TOO_SMALL");
  });

  it("refuse un délai > MAX_DELAY_SECONDS", () => {
    const errs = validateStages([
      { stageIndex: 1, delaySeconds: MAX_DELAY_SECONDS + 1 },
    ]);
    expect(errs[0].code).toBe("DELAY_TOO_LARGE");
  });

  it("refuse des délais non strictement croissants (égalité)", () => {
    const errs = validateStages([
      { stageIndex: 1, delaySeconds: 3600 },
      { stageIndex: 2, delaySeconds: 3600 },
    ]);
    expect(errs.some((e) => e.code === "DELAY_NOT_INCREASING")).toBe(true);
  });

  it("refuse des délais décroissants", () => {
    const errs = validateStages([
      { stageIndex: 1, delaySeconds: 3600 },
      { stageIndex: 2, delaySeconds: 60 },
    ]);
    expect(errs.some((e) => e.code === "DELAY_NOT_INCREASING")).toBe(true);
  });

  it("accepte un jeu valide de 3 stades croissants", () => {
    const errs = validateStages([
      { stageIndex: 1, delaySeconds: 86400 },
      { stageIndex: 2, delaySeconds: 3 * 86400 },
      { stageIndex: 3, delaySeconds: 7 * 86400 },
    ]);
    expect(errs).toEqual([]);
  });

  it("tolère les stages passés en ordre quelconque (trie par index)", () => {
    const errs = validateStages([
      { stageIndex: 2, delaySeconds: 3600 },
      { stageIndex: 1, delaySeconds: 60 },
    ]);
    expect(errs).toEqual([]);
  });
});

describe("abandoned-cart-config — templateHasUnsubscribeLink", () => {
  const footerBlock = (content: string): NewsletterBlock => ({
    id: "f",
    type: "footer",
    data: { content },
  });

  it("détecte {unsubscribeLink} dans un bloc footer dédié", () => {
    expect(
      templateHasUnsubscribeLink([
        footerBlock(`Se désinscrire : {${UNSUBSCRIBE_TOKEN}}`),
      ]),
    ).toBe(true);
  });

  it("tolère la convention historique : token dans un bloc heading", () => {
    // SCENARIO_DEFAULTS.ABANDONED_CART utilise encore des blocs `heading`
    // pour le pied de page — on ne veut pas casser les modèles legacy.
    expect(
      templateHasUnsubscribeLink([
        {
          id: "h",
          type: "heading",
          data: {
            title: "",
            body: `Se désinscrire : {${UNSUBSCRIBE_TOKEN}}`,
            align: "center" as const,
          },
        },
      ]),
    ).toBe(true);
  });

  it("refuse si la variable est totalement absente du template", () => {
    expect(templateHasUnsubscribeLink([footerBlock("Se désinscrire : ici.")])).toBe(false);
  });

  it("refuse un template vide", () => {
    expect(templateHasUnsubscribeLink([])).toBe(false);
  });
});

describe("abandoned-cart-config — pickNextStage", () => {
  const stages = [
    { stageIndex: 1, delaySeconds: 60 },
    { stageIndex: 2, delaySeconds: 300 },
    { stageIndex: 3, delaySeconds: 3600 },
  ];

  it("trouve le premier stade quand rien n'a été envoyé", () => {
    expect(pickNextStage(stages, 0)?.stageIndex).toBe(1);
  });

  it("passe au stade 2 après stade 1", () => {
    expect(pickNextStage(stages, 1)?.stageIndex).toBe(2);
  });

  it("undefined quand tous les stades sont épuisés", () => {
    expect(pickNextStage(stages, 3)).toBeUndefined();
  });

  it("skip les stades manquants (config a été rétrécie)", () => {
    // Si config = [1, 3] et maxFired=1, le prochain est 3 (pas 2 qui n'existe plus).
    const partial = [
      { stageIndex: 1, delaySeconds: 60 },
      { stageIndex: 3, delaySeconds: 3600 },
    ];
    expect(pickNextStage(partial, 1)?.stageIndex).toBe(3);
  });
});

describe("abandoned-cart-trigger — decideResumeAction (activation seed)", () => {
  const stages = [
    { stageIndex: 1, delaySeconds: 60 },
    { stageIndex: 2, delaySeconds: 300 },
    { stageIndex: 3, delaySeconds: 3600 },
  ];

  it("CREATE quand aucun job existant : timer = délai du stade 1", () => {
    const d = decideResumeAction(null, stages);
    expect(d.action).toBe("CREATE");
    expect(d.currentStage).toBe(0);
    expect(d.nextStageDelaySeconds).toBe(60);
  });

  it("LEAVE_UNCHANGED sur un job déjà PENDING (le worker s'en occupe)", () => {
    const d = decideResumeAction(
      { status: "PENDING", stagesFired: [] },
      stages,
    );
    expect(d.action).toBe("LEAVE_UNCHANGED");
  });

  it("LEAVE_UNCHANGED sur un job COMPLETED (client a déjà tout reçu)", () => {
    const d = decideResumeAction(
      {
        status: "COMPLETED",
        stagesFired: [
          { stageIndex: 1, sentAt: "2026-01-01T00:00:00.000Z" },
          { stageIndex: 2, sentAt: "2026-01-02T00:00:00.000Z" },
          { stageIndex: 3, sentAt: "2026-01-03T00:00:00.000Z" },
        ],
      },
      stages,
    );
    expect(d.action).toBe("LEAVE_UNCHANGED");
  });

  it("RESUME sur un job CANCELLED avec stades déjà envoyés", () => {
    // Le client avait reçu le stade 1 puis le job a été annulé → on reprend
    // au stade 2 (délai = 300 s), currentStage préservé à 1 pour ne jamais
    // renvoyer le stade 1.
    const d = decideResumeAction(
      {
        status: "CANCELLED",
        stagesFired: [
          { stageIndex: 1, sentAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
      stages,
    );
    expect(d.action).toBe("RESUME");
    expect(d.currentStage).toBe(1);
    expect(d.nextStageDelaySeconds).toBe(300);
  });

  it("RESUME sur un job CANCELLED sans aucun stade envoyé", () => {
    // Panier vidé puis rerempli avant que le stade 1 ne parte → repart du
    // stade 1 comme un nouveau client.
    const d = decideResumeAction(
      { status: "CANCELLED", stagesFired: [] },
      stages,
    );
    expect(d.action).toBe("RESUME");
    expect(d.currentStage).toBe(0);
    expect(d.nextStageDelaySeconds).toBe(60);
  });

  it("COMPLETE_NOW quand tous les stades ont déjà été envoyés (CANCELLED)", () => {
    // Bizarre en pratique (COMPLETED aurait dû être posé), mais on gère : si
    // le job était CANCELLED avec tous les stades tirés → on le passe direct
    // en COMPLETED plutôt que de le relancer.
    const d = decideResumeAction(
      {
        status: "CANCELLED",
        stagesFired: [
          { stageIndex: 1, sentAt: "2026-01-01T00:00:00.000Z" },
          { stageIndex: 2, sentAt: "2026-01-02T00:00:00.000Z" },
          { stageIndex: 3, sentAt: "2026-01-03T00:00:00.000Z" },
        ],
      },
      stages,
    );
    expect(d.action).toBe("COMPLETE_NOW");
    expect(d.currentStage).toBe(3);
  });

  it("LEAVE_UNCHANGED si aucun stade configuré (sécurité)", () => {
    const d = decideResumeAction(null, []);
    expect(d.action).toBe("LEAVE_UNCHANGED");
  });

  it("tolère un stagesFired mal formé (données legacy)", () => {
    const d = decideResumeAction(
      { status: "CANCELLED", stagesFired: "not-an-array" },
      stages,
    );
    // maxFired retombe à 0 → reprend au stade 1.
    expect(d.action).toBe("RESUME");
    expect(d.currentStage).toBe(0);
    expect(d.nextStageDelaySeconds).toBe(60);
  });
});

describe("abandoned-cart-config — extractLastSentFromFired", () => {
  const currentStages = new Set([1, 2, 3]);

  it("null si stagesFired vide", () => {
    expect(extractLastSentFromFired([], currentStages)).toBeNull();
  });

  it("null si stagesFired mal typé (legacy / corruption)", () => {
    expect(extractLastSentFromFired("not-an-array", currentStages)).toBeNull();
    expect(extractLastSentFromFired(null, currentStages)).toBeNull();
    expect(extractLastSentFromFired({ foo: "bar" }, currentStages)).toBeNull();
  });

  it("renvoie le stade au plus grand index (dernier envoyé)", () => {
    const raw = [
      { stageIndex: 1, sentAt: "2026-01-01T10:00:00.000Z" },
      { stageIndex: 2, sentAt: "2026-01-02T10:00:00.000Z" },
    ];
    const res = extractLastSentFromFired(raw, currentStages);
    expect(res).not.toBeNull();
    expect(res!.stageIndex).toBe(2);
    expect(res!.at.toISOString()).toBe("2026-01-02T10:00:00.000Z");
    expect(res!.stillExists).toBe(true);
  });

  it("stillExists=false si le stade n'existe plus dans la config", () => {
    const raw = [
      { stageIndex: 1, sentAt: "2026-01-01T10:00:00.000Z" },
      { stageIndex: 4, sentAt: "2026-01-02T10:00:00.000Z" },
    ];
    // La config actuelle a stades 1, 2, 3 — le stade 4 a été supprimé.
    const res = extractLastSentFromFired(raw, currentStages);
    expect(res!.stageIndex).toBe(4);
    expect(res!.stillExists).toBe(false);
  });

  it("ignore les entrées invalides (stageIndex manquant/négatif, sentAt vide)", () => {
    const raw = [
      { stageIndex: 1, sentAt: "2026-01-01T10:00:00.000Z" },
      { stageIndex: 0, sentAt: "2026-01-05T10:00:00.000Z" },
      { stageIndex: 2, sentAt: "" },
      { foo: "bar" },
    ];
    const res = extractLastSentFromFired(raw, currentStages);
    expect(res!.stageIndex).toBe(1);
  });

  it("null si aucun sentAt parsable", () => {
    const raw = [{ stageIndex: 1, sentAt: "date-pourrie" }];
    expect(extractLastSentFromFired(raw, currentStages)).toBeNull();
  });
});

describe("abandoned-cart-config — formatage humain", () => {
  it("formatDurationShort", () => {
    expect(formatDurationShort(0)).toBe("0 s");
    expect(formatDurationShort(45)).toBe("45 s");
    expect(formatDurationShort(3600)).toBe("1 h");
    expect(formatDurationShort(86400)).toBe("1 j");
    expect(formatDurationShort(86400 + 3600)).toBe("1 j 1 h");
  });

  it("formatCountdown priorise l'unité de tête pertinente", () => {
    expect(formatCountdown(90)).toBe("1 min 30 s");
    expect(formatCountdown(3660)).toBe("1 h 1 min");
    expect(formatCountdown(86400 * 2 + 3600 * 3)).toBe("2 j 3 h");
  });
});
