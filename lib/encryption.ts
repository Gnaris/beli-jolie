/**
 * Chiffrement AES-256-GCM pour les secrets stockés en base de données.
 *
 * Clé maître : variable d'env ENCRYPTION_KEY (base64, 32 bytes).
 * Format stocké : "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const PREFIX = "enc:v1:";

/** Clés SiteConfig considérées sensibles — chiffrées en BDD. */
export const SENSITIVE_KEYS = new Set([
  "easy_express_api_key",
  "resend_api_key",
  "deepl_api_key",
  "pfs_email",
  "pfs_password",
  "stripe_connect_account_id",
  "ankors_client_secret",
]);

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY manquante. Générez-la avec : node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY doit être exactement 32 bytes (base64).");
  }
  return buf;
}

/** Chiffre une valeur en clair. Retourne le format `enc:v1:...` */
export function encryptValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${PREFIX}${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/** Déchiffre une valeur. Si la valeur n'a pas le préfixe enc:v1:, la retourne telle quelle (migration progressive). */
export function decryptValue(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Valeur en clair (pas encore migrée) — retourne telle quelle
    return stored;
  }

  const key = getEncryptionKey();
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Format chiffré invalide.");
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Vérifie si une valeur est déjà chiffrée. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Chiffre si la clé est sensible, sinon retourne la valeur telle quelle. */
export function encryptIfSensitive(key: string, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    return encryptValue(value);
  }
  return value;
}

/** Déchiffre si la clé est sensible, sinon retourne la valeur telle quelle. */
export function decryptIfSensitive(key: string, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    return decryptValue(value);
  }
  return value;
}
