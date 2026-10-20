/* eslint-disable */
/**
 * Service Worker — PWA Beli & Jolie / Issyma (admin notifications).
 *
 * Rôle unique : recevoir les push notifications envoyées par le serveur
 * et les afficher sur l'écran de l'admin (iPhone, Mac, Windows, Android).
 *
 * Fichier servi en /sw.js — scope = racine du site, donc contrôle tout le
 * domaine. Enregistré depuis `components/admin/push/registerServiceWorker.ts`.
 */

self.addEventListener("install", (event) => {
  // Activation immédiate — pas d'ancien SW à remplacer.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Prend le contrôle des pages déjà ouvertes sans attendre un reload.
  event.waitUntil(self.clients.claim());
});

/**
 * Réception d'une notification push.
 * Payload JSON attendu depuis `lib/push-notifications.ts` :
 *   { title, body, url?, tag?, icon?, badge? }
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    // Fallback texte brut si le serveur n'envoie pas de JSON.
    payload = { title: "Notification", body: event.data.text() };
  }

  const title = payload.title || "Notification";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/apple-icon",
    badge: payload.badge || "/icon",
    // `tag` regroupe les notifications du même type : une 2ᵉ commande qui
    // tombe avant que la 1ʳᵉ soit lue remplace la précédente dans le centre
    // de notifications au lieu d'empiler. Facultatif.
    tag: payload.tag,
    // `data` est passé à l'event `notificationclick` plus bas.
    data: {
      url: payload.url || "/admin",
      ...payload.data,
    },
    // Vibration sur Android (ignorée par Apple). Pattern court et discret.
    vibrate: [100, 50, 100],
    // `requireInteraction` : garde la notif à l'écran tant qu'elle n'est pas
    // tapée. Évite qu'une commande qui tombe en pleine nuit disparaisse
    // après 5s sans que la cliente l'ait vue.
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Clic sur une notification → ouvre (ou focalise) la page cible.
 * Si un onglet admin est déjà ouvert sur le domaine, on le réutilise ;
 * sinon on en ouvre un nouveau sur l'URL fournie dans le payload.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/admin";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Essaie de retrouver un onglet déjà ouvert sur /admin
      for (const client of clients) {
        try {
          const url = new URL(client.url);
          if (url.pathname.startsWith("/admin") || url.pathname === "/") {
            client.focus();
            // Navigue vers l'URL demandée si on peut (sinon on reste sur
            // la page actuelle, l'admin saura où aller).
            if ("navigate" in client) {
              return client.navigate(targetUrl);
            }
            return;
          }
        } catch { /* ignore URL malformée */ }
      }
      // Aucun onglet admin → en ouvrir un neuf.
      return self.clients.openWindow(targetUrl);
    }),
  );
});
