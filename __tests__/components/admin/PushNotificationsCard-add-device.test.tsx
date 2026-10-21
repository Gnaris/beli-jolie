import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";

/**
 * La carte "Notifications push" dans /admin/parametres doit toujours afficher
 * une section "Ajouter un autre appareil" avec QR code + lien à copier dès
 * que le push est configuré (clés VAPID OK). C'est le seul endroit où la
 * cliente peut rediriger ses autres appareils vers l'activation — on garantit
 * sa présence même quand l'appareil courant est déjà abonné.
 */

// Mock des server actions appelées par le composant.
vi.mock("@/app/actions/admin/push-subscriptions", () => ({
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  listMyPushDevices: vi.fn(async () => []),
  deletePushDevice: vi.fn(),
  sendTestPushNotification: vi.fn(),
}));

// Toast context non monté → on remplace le hook par un stub.
const toastSpy = { success: vi.fn(), error: vi.fn() };
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => toastSpy,
}));

// Push APIs absentes de jsdom. On stube navigator pour que la détection
// aboutisse à `ready` (desktop sécurisé avec SW + PushManager + Notification).
beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration: async () => null, register: async () => ({}) },
    configurable: true,
  });
  (window as unknown as { PushManager: unknown }).PushManager = function () {};
  (window as unknown as { Notification: unknown }).Notification = { permission: "default" };
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
  toastSpy.success.mockClear();
  toastSpy.error.mockClear();
});

afterEach(() => cleanup());

async function importCard() {
  const mod = await import("@/components/admin/settings/PushNotificationsCard");
  return mod.default;
}

describe("PushNotificationsCard — section Ajouter un autre appareil", () => {
  it("affiche l'URL + QR + bouton Copier dès que les clés VAPID sont présentes", async () => {
    const Card = await importCard();
    render(
      <Card
        publicVapidKey="BA_fake_vapid_key_short"
        initialDevices={[]}
        addDeviceUrl="https://beliandjolie.com/admin/parametres?open=notifications"
        addDeviceQrPng="data:image/png;base64,QRFAKE"
      />,
    );

    expect(await screen.findByText("Ajouter un autre appareil")).toBeDefined();
    expect(screen.getByText(/https:\/\/beliandjolie\.com/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Copier le lien/i })).toBeDefined();
    const qr = screen.getByAltText(/QR code vers la page notifications/i) as HTMLImageElement;
    expect(qr.src).toContain("QRFAKE");
  });

  it("copie l'URL dans le presse-papier et émet un toast de succès", async () => {
    const Card = await importCard();
    render(
      <Card
        publicVapidKey="BA_fake_vapid_key_short"
        initialDevices={[]}
        addDeviceUrl="https://issyma.fr/admin/parametres?open=notifications"
        addDeviceQrPng={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Copier le lien/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://issyma.fr/admin/parametres?open=notifications",
      );
    });
    expect(toastSpy.success).toHaveBeenCalled();
  });

  it("masque la section si le serveur n'a pas de clés VAPID", async () => {
    const Card = await importCard();
    render(
      <Card
        publicVapidKey={null}
        initialDevices={[]}
        addDeviceUrl="https://beliandjolie.com/admin/parametres?open=notifications"
        addDeviceQrPng={null}
      />,
    );

    // Attendre que detectSupport() ait eu le temps de fixer l'état "no-vapid".
    await waitFor(() => {
      expect(screen.queryByText("Ajouter un autre appareil")).toBeNull();
    });
  });
});
