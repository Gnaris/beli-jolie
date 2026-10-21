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
const serverMocks = {
  deletePushDevice: vi.fn(async () => ({ success: true })),
  listMyPushDevices: vi.fn(async (): Promise<unknown[]> => []),
};
vi.mock("@/app/actions/admin/push-subscriptions", () => ({
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  listMyPushDevices: (...a: unknown[]) => serverMocks.listMyPushDevices(...a as []),
  deletePushDevice: (...a: unknown[]) => serverMocks.deletePushDevice(...a as [string]),
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

  it("ré-affiche « Activer sur cet appareil » quand on retire l'appareil courant", async () => {
    const myEndpoint = "https://push.example.com/me-current";
    const otherEndpoint = "https://push.example.com/other";
    const me = {
      id: "me",
      label: "Mac de Boris",
      userAgent: "Macintosh",
      endpoint: myEndpoint,
      createdAt: "2026-10-20T10:00:00.000Z",
      lastUsedAt: "2026-10-21T08:00:00.000Z",
    };
    const other = { ...me, id: "other", label: "iPhone de Boris", endpoint: otherEndpoint };

    // Le navigateur a l'abonnement de "me" → detectSupport() le détecte.
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({ endpoint: myEndpoint, unsubscribe: async () => true }),
          },
        }),
        register: async () => ({}),
      },
      configurable: true,
    });

    serverMocks.listMyPushDevices.mockResolvedValueOnce([other]);

    const Card = await importCard();
    render(
      <Card
        publicVapidKey="BA_fake_vapid_key_short"
        initialDevices={[me, other]}
        addDeviceUrl="https://beliandjolie.com/admin/parametres?open=notifications"
        addDeviceQrPng={null}
      />,
    );

    // Attend que l'état « cet appareil est connecté » s'affiche (support ready + sub).
    await screen.findByText(/Cet appareil est connecté/i);
    expect(screen.queryByRole("button", { name: /^Activer sur cet appareil$/ })).toBeNull();

    // Clic « Retirer » sur l'appareil courant (celui dont endpoint === myEndpoint).
    const retirerButtons = screen.getAllByRole("button", { name: /^Retirer$/i });
    // Dans l'ordre d'affichage initialDevices : me (index 0), other (index 1).
    fireEvent.click(retirerButtons[0]);

    await waitFor(() => {
      expect(serverMocks.deletePushDevice).toHaveBeenCalledWith("me");
    });

    // Le bouton « Activer sur cet appareil » doit réapparaître pour que la
    // cliente puisse se réabonner immédiatement depuis le même appareil.
    await screen.findByRole("button", { name: /^Activer sur cet appareil$/ });
  });
});
