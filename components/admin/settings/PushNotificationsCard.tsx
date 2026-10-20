"use client";

/**
 * Carte de gestion des notifications push PWA (/admin/parametres > Notifications).
 *
 * Côté admin, la cliente :
 *   1. Installe le site sur son écran d'accueil (Safari iOS → Partager →
 *      Sur l'écran d'accueil). Sans cette étape, Apple ne distribue
 *      aucune notification à un PWA.
 *   2. Lance l'app depuis l'icône (pas depuis Safari).
 *   3. Clique « Activer les notifications » ici → autorise → l'appareil
 *      apparaît dans la liste des appareils liés.
 *
 * Chaque appareil (iPhone, Mac, PC) obtient son propre abonnement.
 */

import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  subscribeToPush,
  unsubscribeFromPush,
  listMyPushDevices,
  deletePushDevice,
  sendTestPushNotification,
  type PushDeviceDTO,
} from "@/app/actions/admin/push-subscriptions";

type PermissionState = "default" | "granted" | "denied";
type SupportState =
  | "checking"       // Détection en cours
  | "unsupported"    // Navigateur sans Push API
  | "no-vapid"       // Serveur sans clés VAPID
  | "insecure"       // Pas en HTTPS (ni localhost) — Safari iOS exige un contexte sécurisé
  | "ios-not-pwa"    // iOS, mais site pas ajouté à l'écran d'accueil
  | "ready";         // Tout OK, on peut proposer l'activation

interface Props {
  publicVapidKey: string | null;
  initialDevices: PushDeviceDTO[];
}

export default function PushNotificationsCard({ publicVapidKey, initialDevices }: Props) {
  const [support, setSupport] = useState<SupportState>("checking");
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [devices, setDevices] = useState<PushDeviceDTO[]>(initialDevices);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  useEffect(() => {
    void detectSupport();
    async function detectSupport() {
      if (!publicVapidKey) {
        setSupport("no-vapid");
        return;
      }
      if (typeof window === "undefined") return;

      // Les Push APIs ne sont exposées qu'en contexte sécurisé (HTTPS ou
      // localhost). Un accès via `http://192.168.x.x:3000` depuis le phone
      // en Wi-Fi fait apparaître « non compatible » à tort — on détecte
      // explicitement ce cas pour afficher la vraie raison.
      if (!window.isSecureContext) {
        setSupport("insecure");
        return;
      }

      // ORDRE IMPORTANT : on détecte iOS AVANT de vérifier Notification/PushManager.
      // Avant installation sur l'écran d'accueil, Safari iOS n'expose pas
      // `Notification` ni `PushManager` même en version récente — ce qui
      // ferait tomber la détection sur "unsupported" alors que la vraie
      // raison est "pas encore installé en PWA". iPadOS 13+ ment en se
      // faisant passer pour macOS : on recoupe via `maxTouchPoints`.
      const ua = navigator.userAgent;
      const isIOSUA = /iPhone|iPad|iPod/.test(ua);
      const isIPadMasquerading =
        /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
      const isIOS = isIOSUA || isIPadMasquerading;
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true;

      if (isIOS && !isStandalone) {
        setSupport("ios-not-pwa");
        // Sur iOS Safari hors PWA, on NE lit PAS Notification.permission
        // (l'objet peut être absent ou throw). On s'arrête ici proprement.
        return;
      }

      // Depuis cet instant on sait qu'on est soit sur desktop, soit sur iOS
      // en mode standalone — dans les deux cas les APIs doivent être là.
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setSupport("unsupported");
        return;
      }

      setSupport("ready");
      setPermission(Notification.permission as PermissionState);

      // Vérifie si cet appareil a déjà un abonnement actif.
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          setSubscribed(Boolean(sub));
        }
      } catch {
        /* non critique */
      }
    }
  }, [publicVapidKey]);

  async function handleActivate() {
    if (!publicVapidKey) return;
    try {
      // 1. Enregistre le service worker (idempotent).
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // 2. Demande la permission système.
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        toast.error(
          "Autorisation refusée",
          "Autorisez les notifications dans les réglages du navigateur pour continuer.",
        );
        return;
      }

      // 3. Souscrit au service push avec notre clé VAPID.
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Spec Web Push : applicationServerKey accepte un BufferSource.
          // Les types TS stricts refusent Uint8Array<ArrayBufferLike> sur
          // certaines versions — on cast via BufferSource.
          applicationServerKey: urlBase64ToUint8Array(publicVapidKey) as BufferSource,
        }));

      // 4. Envoie l'abonnement au serveur.
      const subJson = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error("Abonnement incomplet renvoyé par le navigateur.");
      }
      startTransition(async () => {
        const res = await subscribeToPush(
          {
            endpoint: subJson.endpoint!,
            keys: { p256dh: subJson.keys!.p256dh!, auth: subJson.keys!.auth! },
          },
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        );
        if (!res.success) {
          toast.error("Erreur", res.error ?? "Impossible d'enregistrer cet appareil.");
          return;
        }
        setSubscribed(true);
        toast.success("Notifications activées", "Cet appareil recevra les alertes importantes.");
        setDevices(await listMyPushDevices());
      });
    } catch (err) {
      toast.error("Erreur", err instanceof Error ? err.message : "Échec de l'activation.");
    }
  }

  async function handleDeactivate() {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        startTransition(async () => {
          await unsubscribeFromPush(endpoint);
          setSubscribed(false);
          toast.success("Notifications désactivées", "Cet appareil ne recevra plus d'alertes.");
          setDevices(await listMyPushDevices());
        });
      } else {
        setSubscribed(false);
      }
    } catch (err) {
      toast.error("Erreur", err instanceof Error ? err.message : "Échec de la désactivation.");
    }
  }

  function handleDeleteDevice(id: string) {
    startTransition(async () => {
      const res = await deletePushDevice(id);
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Suppression impossible.");
        return;
      }
      setDevices(await listMyPushDevices());
      toast.success("Appareil retiré", "Il ne recevra plus de notifications.");
    });
  }

  function handleSendTest() {
    startTransition(async () => {
      const res = await sendTestPushNotification();
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Envoi impossible.");
        return;
      }
      toast.success(
        "Test envoyé",
        `Notification envoyée à ${res.devicesTargeted} appareil${(res.devicesTargeted ?? 0) > 1 ? "s" : ""}.`,
      );
    });
  }

  return (
    <div className="space-y-5">
      <StatusBanner support={support} permission={permission} subscribed={subscribed} />

      {support === "ready" && !subscribed && permission !== "denied" && (
        <button
          type="button"
          onClick={handleActivate}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-bg-dark text-white text-sm font-heading font-semibold hover:bg-bg-darker transition disabled:opacity-50"
        >
          <IcoBell />
          {isPending ? "Activation…" : "Activer sur cet appareil"}
        </button>
      )}

      {support === "ready" && subscribed && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={isPending || devices.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary text-text-primary border border-border-strong text-sm font-heading font-semibold hover:bg-bg-tertiary transition disabled:opacity-50"
          >
            Envoyer une notification test
          </button>
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-heading font-semibold text-rose-700 hover:bg-rose-50 transition disabled:opacity-50"
          >
            Désactiver sur cet appareil
          </button>
        </div>
      )}

      {devices.length > 0 && (
        <div>
          <h4 className="text-[11px] font-body font-bold uppercase tracking-[0.14em] text-text-muted mb-2">
            Appareils liés ({devices.length})
          </h4>
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-start sm:items-center justify-between gap-3 p-3 rounded-xl border border-border bg-bg-primary"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-body font-semibold text-text-primary">
                    {d.label || "Appareil"}
                  </div>
                  <div className="text-[11.5px] text-text-muted font-body mt-0.5">
                    Dernière alerte : {formatRelative(d.lastUsedAt)} · Ajouté {formatRelative(d.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteDevice(d.id)}
                  disabled={isPending}
                  className="text-[11px] font-body font-bold uppercase tracking-[0.14em] text-rose-700 hover:underline disabled:opacity-50"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusBanner({
  support,
  permission,
  subscribed,
}: {
  support: SupportState;
  permission: PermissionState;
  subscribed: boolean;
}) {
  if (support === "checking") {
    return <Banner tone="info">Vérification du navigateur…</Banner>;
  }
  if (support === "no-vapid") {
    return (
      <Banner tone="warn" title="Push non configuré sur le serveur">
        Les clés VAPID manquent dans l&apos;environnement (contactez votre développeur).
      </Banner>
    );
  }
  if (support === "insecure") {
    return (
      <Banner tone="warn" title="Connexion non sécurisée (HTTP)">
        Les notifications push demandent une connexion <strong>HTTPS</strong>.
        Vous accédez au site via une adresse en <code>http://…</code>, ce que
        Safari (et tous les autres navigateurs) refuse pour les push.
        <br /><br />
        <strong>Pour tester depuis votre iPhone :</strong> ouvrez le site en
        passant par votre domaine en ligne (<code>https://beliandjolie.com</code>)
        plutôt que par l&apos;IP locale <code>192.168.x.x</code>.
      </Banner>
    );
  }
  if (support === "unsupported") {
    return (
      <Banner tone="warn" title="Navigateur non compatible">
        Les notifications push demandent un navigateur moderne (Safari 16.4+, Chrome, Firefox, Edge).
      </Banner>
    );
  }
  if (support === "ios-not-pwa") {
    return (
      <Banner tone="warn" title="Installez d'abord l'app sur votre écran d'accueil">
        Sur iPhone/iPad, Apple exige que le site soit lancé depuis l&apos;icône d&apos;accueil.
        Ouvrez le site dans Safari → appuyez sur <strong>Partager</strong> → <strong>Sur l&apos;écran d&apos;accueil</strong>,
        puis revenez ici depuis la nouvelle icône.
      </Banner>
    );
  }
  if (permission === "denied") {
    return (
      <Banner tone="warn" title="Autorisation bloquée">
        Les notifications ont été refusées. Ouvrez les réglages du navigateur
        (ou de l&apos;app iOS) pour réautoriser ce site, puis rechargez cette page.
      </Banner>
    );
  }
  if (subscribed) {
    return (
      <Banner tone="ok" title="Cet appareil est connecté">
        Les notifications sont actives. Vous recevrez une alerte à chaque nouvelle commande,
        nouvelle inscription, nouveau SAV ou message chat.
      </Banner>
    );
  }
  return (
    <Banner tone="info" title="Prêt à activer">
      Cliquez sur « Activer » ci-dessous. Votre navigateur demandera l&apos;autorisation d&apos;afficher
      des alertes — acceptez pour recevoir les notifications en temps réel.
    </Banner>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "info" | "warn" | "ok";
  title?: string;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "ok"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : tone === "warn"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : "bg-sky-50 border-sky-200 text-sky-900";
  return (
    <div className={`rounded-2xl border p-4 text-[13px] font-body leading-relaxed ${toneClass}`}>
      {title && <div className="font-heading font-bold text-[14px] mb-1">{title}</div>}
      <div>{children}</div>
    </div>
  );
}

function IcoBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/**
 * Convertit une clé VAPID base64url en Uint8Array (format attendu par
 * `pushManager.subscribe`). Spec : RFC 7515 Appendix C.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return date.toLocaleDateString("fr-FR");
}
