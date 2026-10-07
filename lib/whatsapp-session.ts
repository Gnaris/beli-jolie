/**
 * lib/whatsapp-session.ts
 *
 * Singleton Baileys socket pour la vérification « a WhatsApp oui/non ».
 *
 * - Session **partagée** (1 numéro WhatsApp secondaire pour les 2 boutiques BJ + Issyma).
 * - Stockage sur disque dans `private/whatsapp-session/` (hors `uploads/`).
 * - Pairing par **code à 8 chiffres** uniquement (pas de QR).
 * - Reconnexion automatique si la session existe au démarrage (`instrumentation-node.ts`).
 *
 * Singleton persiste sur `globalThis` pour survivre aux HMR Next.js dev :
 * sans ca, chaque rechargement a chaud reset le socket a null et l'UI retombe
 * sur « Non appairee », meme si Baileys tourne toujours en fond.
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
  connectedSince: Date | null;
  lastError: string | null;
}

interface WhatsappStore {
  sock: WASocket | null;
  state: WhatsappSessionState;
  starting: boolean;
  reconnectTimer: NodeJS.Timeout | null;
}

// Persistance du singleton sur globalThis pour survivre aux HMR Next.js dev.
// Sans ca, chaque rechargement a chaud reset `sock` a null et l'UI retombe
// sur « Non appairee », meme si le socket Baileys reel tourne toujours en fond.
// (Meme pattern que Prisma Client dans un projet Next.js.)
const GLOBAL_KEY = Symbol.for("beliandjolie.whatsapp.session.store");

function getStore(): WhatsappStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      sock: null,
      state: {
        status: "disconnected",
        phoneNumber: null,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        connectedSince: null,
        lastError: null,
      } satisfies WhatsappSessionState,
      starting: false,
      reconnectTimer: null,
    } satisfies WhatsappStore;
  }
  return g[GLOBAL_KEY] as WhatsappStore;
}

const SESSION_DIR = path.resolve(process.cwd(), "private", "whatsapp-session");

export function getWhatsappSessionState(): WhatsappSessionState {
  return { ...getStore().state };
}

export async function startWhatsappSession(): Promise<void> {
  const store = getStore();
  if (store.sock || store.starting) return;
  store.starting = true;
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
    const hasCreds = await hasExistingSession();
    if (!hasCreds) {
      store.state = { ...store.state, status: "disconnected" };
      return;
    }
    await bootSocket({ requestPairingFor: null });
  } catch (err) {
    logger.error("[WhatsApp] Demarrage de la session echoue", { error: err as Error });
    store.state = { ...store.state, status: "error", lastError: (err as Error).message };
  } finally {
    store.starting = false;
  }
}

export async function requestWhatsappPairingCode(
  phoneNumber: string,
): Promise<{ code: string; expiresAt: Date }> {
  const normalized = normalizeInternational(phoneNumber);
  if (!normalized) throw new Error("Numero de telephone invalide");

  const store = getStore();

  // On repart TOUJOURS d'un etat propre avant de redemander un code :
  // close socket + wipe disque. Sinon, si une session precedente est deja
  // enregistree (creds.json sur disque), Baileys voit creds.registered=true
  // et skip silencieusement l'appel requestPairingCode -> cryptic error.
  await closeSocket();
  try {
    await fs.rm(SESSION_DIR, { recursive: true, force: true });
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (err) {
    logger.warn("[WhatsApp] Nettoyage avant pairing echoue", { error: err as Error });
  }
  store.state = {
    status: "disconnected",
    phoneNumber: null,
    pairingCode: null,
    pairingCodeExpiresAt: null,
    connectedSince: null,
    lastError: null,
  };

  await bootSocket({ requestPairingFor: normalized });

  if (!store.state.pairingCode || !store.state.pairingCodeExpiresAt) {
    throw new Error("Echec de la generation du code d'appairage");
  }
  return { code: store.state.pairingCode, expiresAt: store.state.pairingCodeExpiresAt };
}

export async function disconnectWhatsappSession(): Promise<void> {
  const store = getStore();
  await closeSocket();
  try {
    await fs.rm(SESSION_DIR, { recursive: true, force: true });
    await fs.mkdir(SESSION_DIR, { recursive: true });
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
    connectedSince: null,
    lastError: null,
  };
}

export async function checkWhatsappNumberRaw(phoneNumber: string): Promise<boolean | null> {
  const store = getStore();
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

async function hasExistingSession(): Promise<boolean> {
  try {
    const creds = path.join(SESSION_DIR, "creds.json");
    await fs.access(creds);
    return true;
  } catch {
    return false;
  }
}

async function bootSocket(opts: { requestPairingFor: string | null }): Promise<void> {
  const baileys = (await import("baileys")) as unknown as Baileys;
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = baileys;

  await fs.mkdir(SESSION_DIR, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

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

  const store = getStore();
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

    const { connection, lastDisconnect, isNewLogin } = update;
    if (connection === "open") {
      store.state = {
        ...store.state,
        status: "connected",
        pairingCode: null,
        pairingCodeExpiresAt: null,
        connectedSince: new Date(),
        lastError: null,
        phoneNumber: extractOwnJid(sock) ?? store.state.phoneNumber,
      };
      if (isNewLogin) {
        logger.info("[WhatsApp] Nouvel appairage reussi");
      } else {
        logger.info("[WhatsApp] Session reconnectee");
      }
    } else if (connection === "connecting") {
      store.state = { ...store.state, status: "connecting" };
    } else if (connection === "close") {
      const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const code = err?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        logger.warn("[WhatsApp] Session invalidee par Meta - deconnexion forcee");
        void disconnectWhatsappSession().then(() => {
          store.state = { ...store.state, status: "logged_out" };
        });
      } else {
        store.state = { ...store.state, status: "connecting" };
        // Annule tout timer de reconnexion precedent pour eviter d'avoir
        // plusieurs sockets qui se battent.
        if (store.reconnectTimer) clearTimeout(store.reconnectTimer);
        store.reconnectTimer = setTimeout(() => {
          store.reconnectTimer = null;
          void bootSocket({ requestPairingFor: null }).catch((e) => {
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
      logger.info("[WhatsApp] Code d'appairage genere");
    } catch (err) {
      logger.error("[WhatsApp] requestPairingCode a echoue", { error: err as Error });
      store.state = {
        ...store.state,
        status: "error",
        lastError: (err as Error).message,
      };
      await closeSocket();
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

async function closeSocket(): Promise<void> {
  const store = getStore();
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

function normalizeInternational(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  if (cleaned.startsWith("0") && cleaned.length === 10) return `33${cleaned.slice(1)}`;
  return cleaned;
}
