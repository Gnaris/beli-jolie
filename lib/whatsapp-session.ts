/**
 * lib/whatsapp-session.ts
 *
 * Session Baileys pour la vérification « a WhatsApp oui/non », **scopée par tenant**.
 *
 * - 1 session par boutique → chaque tenant doit appairer son propre numéro.
 * - Store `Map<tenantId, WhatsappStore>` sur `globalThis` (survit aux HMR dev).
 * - Fichiers de session isolés dans `private/whatsapp-session/{tenantSlug}/`.
 * - 2 modes de pairing au choix de la cliente :
 *     a) code à 8 chiffres (saisie du numero + saisie du code sur le telephone)
 *     b) QR code (scan depuis WhatsApp -> Appareils connectes -> Scanner)
 * - Au boot (`instrumentation-node.ts`), on remonte toutes les sessions
 *   déjà appairées en scannant le dossier parent.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";

type Baileys = typeof import("baileys");
type WASocket = ReturnType<Baileys["default"]>;

export type WhatsappStatus =
  | "disconnected"
  | "awaiting_pairing"
  | "connecting"
  | "connected"
  | "logged_out"
  | "error";

export interface WhatsappSessionState {
  status: WhatsappStatus;
  phoneNumber: string | null;
  pairingCode: string | null;
  pairingCodeExpiresAt: Date | null;
  /**
   * QR code encode en data URL (`data:image/png;base64,...`). Non-null
   * uniquement quand on est en mode QR et qu'un QR frais a ete emis par
   * Baileys. Baileys rafraichit le QR toutes les ~20s pendant 5 cycles
   * puis ferme la connexion si personne n'a scanne.
   */
  qrCode: string | null;
  connectedSince: Date | null;
  lastError: string | null;
}

interface WhatsappStore {
  sock: WASocket | null;
  state: WhatsappSessionState;
  starting: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  tenantSlug: string;
  shuttingDown: boolean;
}

const GLOBAL_KEY = Symbol.for("beliandjolie.whatsapp.sessions.by-tenant");

type StoreMap = Map<string, WhatsappStore>;

function stores(): StoreMap {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, WhatsappStore>();
  }
  return g[GLOBAL_KEY] as StoreMap;
}

function getStore(tenantId: string, tenantSlug: string): WhatsappStore {
  const map = stores();
  let s = map.get(tenantId);
  if (!s) {
    s = {
      sock: null,
      state: {
        status: "disconnected",
        phoneNumber: null,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        qrCode: null,
        connectedSince: null,
        lastError: null,
      },
      starting: false,
      reconnectTimer: null,
      tenantSlug,
      shuttingDown: false,
    };
    map.set(tenantId, s);
  } else if (s.tenantSlug !== tenantSlug) {
    // Rename de slug — garde la session, mais met à jour le slug pour que
    // les prochains appels disque pointent au bon endroit.
    s.tenantSlug = tenantSlug;
  }
  return s;
}

const PARENT_DIR = path.resolve(process.cwd(), "private", "whatsapp-session");

function sessionDir(tenantSlug: string): string {
  return path.join(PARENT_DIR, tenantSlug);
}

export function getWhatsappSessionState(tenantId: string, tenantSlug: string): WhatsappSessionState {
  return { ...getStore(tenantId, tenantSlug).state };
}

export async function startWhatsappSession(tenantId: string, tenantSlug: string): Promise<void> {
  const store = getStore(tenantId, tenantSlug);
  if (store.sock || store.starting) return;
  store.starting = true;
  try {
    const dir = sessionDir(tenantSlug);
    await fs.mkdir(dir, { recursive: true });
    const hasCreds = await hasExistingSession(tenantSlug);
    if (!hasCreds) {
      store.state = { ...store.state, status: "disconnected" };
      return;
    }
    await bootSocket({ tenantId, tenantSlug, requestPairingFor: null });
  } catch (err) {
    logger.error("[WhatsApp] Demarrage de la session echoue", { error: err as Error });
    store.state = { ...store.state, status: "error", lastError: (err as Error).message };
  } finally {
    store.starting = false;
  }
}

export async function requestWhatsappPairingCode(
  tenantId: string,
  tenantSlug: string,
  phoneNumber: string,
): Promise<{ code: string; expiresAt: Date }> {
  const normalized = normalizeInternational(phoneNumber);
  if (!normalized) throw new Error("Numero de telephone invalide");

  const store = getStore(tenantId, tenantSlug);

  // On repart TOUJOURS d'un etat propre avant de redemander un code :
  // close socket + wipe disque. Sinon, si une session precedente est deja
  // enregistree (creds.json sur disque), Baileys voit creds.registered=true
  // et skip silencieusement l'appel requestPairingCode -> cryptic error.
  await resetStoreForPairing(tenantId, tenantSlug);

  await bootSocket({ tenantId, tenantSlug, requestPairingFor: normalized });

  if (!store.state.pairingCode || !store.state.pairingCodeExpiresAt) {
    throw new Error("Echec de la generation du code d'appairage");
  }
  return { code: store.state.pairingCode, expiresAt: store.state.pairingCodeExpiresAt };
}

/**
 * Mode QR : demarre une session Baileys sans telephone. Baileys emet
 * ensuite des QR codes successifs via `connection.update` (champ `qr`).
 * On les transforme en data URL PNG et on les stocke dans `state.qrCode`.
 * La cliente ouvre WhatsApp -> Appareils connectes -> Scanner un QR code.
 *
 * Note : Baileys rafraichit automatiquement le QR toutes les ~20s (5 cycles
 * max) puis ferme la connexion si personne n'a scanne. Le polling cote UI
 * se chargera d'afficher le QR a jour.
 */
export async function requestWhatsappQrPairing(
  tenantId: string,
  tenantSlug: string,
): Promise<void> {
  await resetStoreForPairing(tenantId, tenantSlug);
  const store = getStore(tenantId, tenantSlug);
  // Statut provisoire : la UI peut afficher un spinner le temps que le
  // premier QR arrive de Baileys (~1-2s apres l'ouverture WS).
  store.state = {
    ...store.state,
    status: "awaiting_pairing",
    phoneNumber: null,
  };
  await bootSocket({ tenantId, tenantSlug, requestPairingFor: null, qrMode: true });
}

async function resetStoreForPairing(tenantId: string, tenantSlug: string): Promise<void> {
  const store = getStore(tenantId, tenantSlug);
  await closeSocket(tenantId, tenantSlug);
  const dir = sessionDir(tenantSlug);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    logger.warn("[WhatsApp] Nettoyage avant pairing echoue", { error: err as Error });
  }
  store.state = {
    status: "disconnected",
    phoneNumber: null,
    pairingCode: null,
    pairingCodeExpiresAt: null,
    qrCode: null,
    connectedSince: null,
    lastError: null,
  };
}

export async function disconnectWhatsappSession(tenantId: string, tenantSlug: string): Promise<void> {
  const store = getStore(tenantId, tenantSlug);
  await closeSocket(tenantId, tenantSlug);
  const dir = sessionDir(tenantSlug);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    logger.warn("[WhatsApp] Suppression du dossier de session echouee", {
      error: err as Error,
    });
  }
  store.state = {
    status: "disconnected",
    phoneNumber: null,
    pairingCode: null,
    pairingCodeExpiresAt: null,
    qrCode: null,
    connectedSince: null,
    lastError: null,
  };
}

export async function checkWhatsappNumberRaw(
  tenantId: string,
  tenantSlug: string,
  phoneNumber: string,
): Promise<boolean | null> {
  const store = getStore(tenantId, tenantSlug);
  if (!store.sock || store.state.status !== "connected") return null;
  const normalized = normalizeInternational(phoneNumber);
  if (!normalized) return null;
  try {
    const results = await store.sock.onWhatsApp(normalized);
    if (!results || results.length === 0) return false;
    const first = results[0];
    return !!first?.exists;
  } catch (err) {
    logger.warn("[WhatsApp] onWhatsApp a echoue pour un numero", {
      error: err as Error,
    });
    return null;
  }
}

/**
 * Liste les slugs qui ont déjà une session Baileys sur disque. Utilisé par
 * `instrumentation-node.ts` au boot pour remonter chaque session dans son
 * `tenantALS.run(...)`.
 */
export async function listPersistedWhatsappSessionSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(PARENT_DIR, { withFileTypes: true });
    const slugs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const credsPath = path.join(PARENT_DIR, entry.name, "creds.json");
      try {
        await fs.access(credsPath);
        slugs.push(entry.name);
      } catch {
        // Pas de creds.json dans ce sous-dossier → rien à remonter.
      }
    }
    return slugs;
  } catch {
    return [];
  }
}

/**
 * Arret propre de TOUTES les sessions WhatsApp du process (toutes boutiques
 * confondues). Appele depuis `instrumentation-node.ts` sur SIGTERM/SIGINT
 * (ex: `pm2 restart beliandjolie` au moment d'un push en prod).
 *
 * Objectif : envoyer un close frame WebSocket propre a Meta pour que la
 * session soit percue comme un offline normal plutot qu'une coupure
 * brutale. Les creds restent sur disque, le prochain boot reprend la
 * session telle quelle sans ré-appairage.
 *
 * Timebox 2.5s : au-dela, PM2 va envoyer SIGKILL (kill_timeout cote PM2
 * configure a 5s), on preferre rendre la main avant.
 */
export async function shutdownAllWhatsappSessions(): Promise<void> {
  const map = stores();
  if (map.size === 0) return;

  const deadlineMs = 2_500;
  const started = Date.now();

  for (const store of map.values()) {
    store.shuttingDown = true;
    if (store.reconnectTimer) {
      clearTimeout(store.reconnectTimer);
      store.reconnectTimer = null;
    }
    if (store.sock) {
      try {
        store.sock.end(undefined);
      } catch {
        // noop
      }
    }
  }

  // Petite fenetre pour laisser Baileys flusher le close frame + saveCreds
  // pendant.
  const remaining = Math.max(0, deadlineMs - (Date.now() - started));
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 1_500)));
  }
}

async function hasExistingSession(tenantSlug: string): Promise<boolean> {
  try {
    const creds = path.join(sessionDir(tenantSlug), "creds.json");
    await fs.access(creds);
    return true;
  } catch {
    return false;
  }
}

async function bootSocket(opts: {
  tenantId: string;
  tenantSlug: string;
  requestPairingFor: string | null;
  qrMode?: boolean;
}): Promise<void> {
  const baileys = (await import("baileys")) as unknown as Baileys;
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = baileys;

  const dir = sessionDir(opts.tenantSlug);
  await fs.mkdir(dir, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(dir);

  const silentLogger = {
    level: "silent" as const,
    fatal: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    child: () => silentLogger,
  };

  const store = getStore(opts.tenantId, opts.tenantSlug);
  store.sock = makeWASocket({
    auth: authState,
    logger: silentLogger as unknown as Parameters<typeof makeWASocket>[0]["logger"],
    browser: Browsers.appropriate("Chrome"),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  const sock = store.sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    // Garde CRITIQUE : si cet event vient d'un socket perime (remplace par
    // un nouveau pairing/reconnect), on ignore. Sinon l'ancien socket qui
    // vit encore en fond declenche un faux "logged_out" et wipe la session
    // fraichement appairee.
    if (store.sock !== sock) return;

    const { connection, lastDisconnect, isNewLogin, qr } = update;

    // QR code emis par Baileys (mode qrMode). Rafraichi toutes les ~20s
    // tant que personne ne scanne. On encode en data URL PNG pour que le
    // composant React l'affiche directement via <img src=…>.
    if (qr && opts.qrMode) {
      void renderQrToDataUrl(qr)
        .then((dataUrl) => {
          if (store.sock !== sock) return;
          store.state = {
            ...store.state,
            status: "awaiting_pairing",
            qrCode: dataUrl,
            pairingCode: null,
            pairingCodeExpiresAt: null,
            lastError: null,
          };
        })
        .catch((err) => {
          logger.warn("[WhatsApp] Encodage QR echoue", { error: err as Error });
        });
    }

    if (connection === "open") {
      store.state = {
        ...store.state,
        status: "connected",
        pairingCode: null,
        pairingCodeExpiresAt: null,
        qrCode: null,
        connectedSince: new Date(),
        lastError: null,
        phoneNumber: extractOwnJid(sock) ?? store.state.phoneNumber,
      };
      if (isNewLogin) {
        logger.info(`[WhatsApp] Nouvel appairage reussi pour ${opts.tenantSlug}`);
      } else {
        logger.info(`[WhatsApp] Session reconnectee pour ${opts.tenantSlug}`);
      }
    } else if (connection === "connecting") {
      store.state = { ...store.state, status: "connecting" };
    } else if (connection === "close") {
      const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const code = err?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        logger.warn(
          `[WhatsApp] Session invalidee par Meta pour ${opts.tenantSlug} - deconnexion forcee`,
        );
        void disconnectWhatsappSession(opts.tenantId, opts.tenantSlug).then(() => {
          store.state = { ...store.state, status: "logged_out" };
        });
      } else if (store.shuttingDown) {
        // Arret propre en cours (SIGTERM/SIGINT) : pas de reconnexion, pas
        // de log parasite. On laisse le socket mourir en douceur, Meta
        // percoit un offline propre plutot qu'une coupure franche.
        store.state = { ...store.state, status: "disconnected" };
      } else {
        store.state = { ...store.state, status: "connecting" };
        // Annule tout timer de reconnexion precedent pour eviter d'avoir
        // plusieurs sockets qui se battent.
        if (store.reconnectTimer) clearTimeout(store.reconnectTimer);
        store.reconnectTimer = setTimeout(() => {
          store.reconnectTimer = null;
          void bootSocket({
            tenantId: opts.tenantId,
            tenantSlug: opts.tenantSlug,
            requestPairingFor: null,
          }).catch((e) => {
            logger.error("[WhatsApp] Reconnexion echouee", { error: e as Error });
          });
        }, 5_000);
      }
    }
  });

  if (opts.requestPairingFor && !sock.authState.creds.registered) {
    try {
      // Baileys ouvre la WebSocket de maniere asynchrone apres makeWASocket.
      // Appeler requestPairingCode avant l'ouverture leve "428 Precondition
      // Required: Connection Closed". On attend donc le premier
      // connection.update (= WS prete pour les requetes IQ) + delai de garde.
      await waitForSocketReady(sock);
      const code = await sock.requestPairingCode(opts.requestPairingFor);
      const prettyCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
      store.state = {
        ...store.state,
        status: "awaiting_pairing",
        phoneNumber: opts.requestPairingFor,
        pairingCode: prettyCode,
        pairingCodeExpiresAt: new Date(Date.now() + 60_000),
        lastError: null,
      };
      logger.info(`[WhatsApp] Code d'appairage genere pour ${opts.tenantSlug}`);
    } catch (err) {
      logger.error("[WhatsApp] requestPairingCode a echoue", { error: err as Error });
      store.state = {
        ...store.state,
        status: "error",
        lastError: (err as Error).message,
      };
      await closeSocket(opts.tenantId, opts.tenantSlug);
      throw err;
    }
  }
}

/**
 * Attend que la WebSocket Baileys soit ouverte (premier connection.update
 * emis par le socket). Sans ca, requestPairingCode leve une 428.
 *
 * Timeout 15 s + petit delai de garde 400 ms une fois la WS prete.
 */
function waitForSocketReady(s: WASocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Timeout en attendant l'ouverture de la connexion WhatsApp"));
    }, 15_000);

    const handler = (u: { connection?: string }) => {
      if (u.connection === "connecting" || u.connection === "open") {
        clearTimeout(timeoutId);
        s.ev.off("connection.update", handler);
        // Petit sursis : Baileys emet "connecting" des que la WS s'ouvre, mais
        // le handshake reel se termine ~200-400 ms plus tard. Appeler
        // requestPairingCode trop tot renvoie encore 428 chez certains utilisateurs.
        setTimeout(resolve, 400);
      }
    };
    s.ev.on("connection.update", handler);
  });
}

async function closeSocket(tenantId: string, tenantSlug: string): Promise<void> {
  const store = getStore(tenantId, tenantSlug);
  // Toute reconnexion planifiee devient obsolete.
  if (store.reconnectTimer) {
    clearTimeout(store.reconnectTimer);
    store.reconnectTimer = null;
  }
  if (!store.sock) return;
  try {
    store.sock.end(undefined);
  } catch {
    // noop
  }
  store.sock = null;
}

function extractOwnJid(s: WASocket | null): string | null {
  if (!s) return null;
  const me = s.user?.id ?? null;
  if (!me) return null;
  const match = /^(\d+)[:@]/.exec(me);
  return match?.[1] ?? null;
}

async function renderQrToDataUrl(payload: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 8,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}

function normalizeInternational(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  if (cleaned.startsWith("0") && cleaned.length === 10) return `33${cleaned.slice(1)}`;
  return cleaned;
}
