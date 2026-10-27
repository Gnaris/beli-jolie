import { describe, it, expect } from "vitest";
import { computeReviewMailStatus } from "@/lib/order-review-mail-status";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("computeReviewMailStatus", () => {
  it("renvoie 'none' pour une commande PENDING", () => {
    const r = computeReviewMailStatus(
      { status: "PENDING", shippedAt: null, reviewRequestEmailSentAt: null },
      NOW,
    );
    expect(r.kind).toBe("none");
  });

  it("renvoie 'none' pour une commande CANCELLED", () => {
    const r = computeReviewMailStatus(
      { status: "CANCELLED", shippedAt: new Date("2026-10-10T00:00:00Z"), reviewRequestEmailSentAt: null },
      NOW,
    );
    expect(r.kind).toBe("none");
  });

  it("renvoie 'none' pour une commande SHIPPED legacy sans shippedAt", () => {
    const r = computeReviewMailStatus(
      { status: "SHIPPED", shippedAt: null, reviewRequestEmailSentAt: null },
      NOW,
    );
    expect(r.kind).toBe("none");
  });

  it("renvoie 'scheduled' avec le compte à rebours restant", () => {
    const shippedAt = new Date("2026-10-24T12:00:00Z"); // il y a 3 jours
    const r = computeReviewMailStatus(
      { status: "SHIPPED", shippedAt, reviewRequestEmailSentAt: null },
      NOW,
    );
    expect(r.kind).toBe("scheduled");
    if (r.kind === "scheduled") expect(r.daysRemaining).toBe(7);
  });

  it("renvoie 'scheduled' avec 1 jour quand shippedAt = J-9", () => {
    const shippedAt = new Date("2026-10-18T12:00:00Z"); // il y a 9 jours
    const r = computeReviewMailStatus(
      { status: "SHIPPED", shippedAt, reviewRequestEmailSentAt: null },
      NOW,
    );
    expect(r.kind).toBe("scheduled");
    if (r.kind === "scheduled") expect(r.daysRemaining).toBe(1);
  });

  it("renvoie 'imminent' quand shippedAt dépasse 10 jours sans envoi", () => {
    const shippedAt = new Date("2026-10-15T12:00:00Z"); // il y a 12 jours
    const r = computeReviewMailStatus(
      { status: "SHIPPED", shippedAt, reviewRequestEmailSentAt: null },
      NOW,
    );
    expect(r.kind).toBe("imminent");
  });

  it("renvoie 'sent' si le mail a déjà été envoyé, peu importe le statut", () => {
    const sentAt = new Date("2026-10-25T12:00:00Z");
    const r = computeReviewMailStatus(
      {
        status: "SHIPPED",
        shippedAt: new Date("2026-10-10T00:00:00Z"),
        reviewRequestEmailSentAt: sentAt,
      },
      NOW,
    );
    expect(r.kind).toBe("sent");
    if (r.kind === "sent") expect(r.sentAt).toBe(sentAt);
  });

  it("renvoie 'sent' même si la commande repasse en PENDING par erreur", () => {
    // Cas théorique : si on retire shippedAt mais on garde sentAt (ne doit pas arriver).
    const sentAt = new Date("2026-10-25T12:00:00Z");
    const r = computeReviewMailStatus(
      { status: "PENDING", shippedAt: null, reviewRequestEmailSentAt: sentAt },
      NOW,
    );
    expect(r.kind).toBe("sent");
  });
});
