/**
 * Tests for lib/encryption.ts
 * AES-256-GCM encryption/decryption for sensitive SiteConfig values.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as crypto from "crypto";

// Generate a valid 32-byte key for testing
const TEST_KEY = crypto.randomBytes(32).toString("base64");

describe("lib/encryption", () => {
  let encryptValue: typeof import("@/lib/encryption").encryptValue;
  let decryptValue: typeof import("@/lib/encryption").decryptValue;
  let isEncrypted: typeof import("@/lib/encryption").isEncrypted;
  let encryptIfSensitive: typeof import("@/lib/encryption").encryptIfSensitive;
  let decryptIfSensitive: typeof import("@/lib/encryption").decryptIfSensitive;
  let SENSITIVE_KEYS: typeof import("@/lib/encryption").SENSITIVE_KEYS;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const mod = await import("@/lib/encryption");
    encryptValue = mod.encryptValue;
    decryptValue = mod.decryptValue;
    isEncrypted = mod.isEncrypted;
    encryptIfSensitive = mod.encryptIfSensitive;
    decryptIfSensitive = mod.decryptIfSensitive;
    SENSITIVE_KEYS = mod.SENSITIVE_KEYS;
  });

  // ─── encryptValue / decryptValue ───────────────────────────────

  it("should encrypt and decrypt a simple string", () => {
    const plaintext = "my-secret-api-key-12345";
    const encrypted = encryptValue(plaintext);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(plaintext);
    const decrypted = decryptValue(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should encrypt and decrypt empty string", () => {
    const encrypted = encryptValue("");
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptValue(encrypted)).toBe("");
  });

  it("should encrypt and decrypt unicode characters", () => {
    const plaintext = "clé-secrète-émoji-🔑-日本語";
    const encrypted = encryptValue(plaintext);
    expect(decryptValue(encrypted)).toBe(plaintext);
  });

  it("should encrypt and decrypt very long strings", () => {
    const plaintext = "x".repeat(10000);
    const encrypted = encryptValue(plaintext);
    expect(decryptValue(encrypted)).toBe(plaintext);
  });

  it("should produce different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same-secret";
    const encrypted1 = encryptValue(plaintext);
    const encrypted2 = encryptValue(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
    expect(decryptValue(encrypted1)).toBe(plaintext);
    expect(decryptValue(encrypted2)).toBe(plaintext);
  });

  it("should have correct encrypted format: enc:v1:<iv>:<authTag>:<ciphertext>", () => {
    const encrypted = encryptValue("test");
    const parts = encrypted.split(":");
    expect(parts[0]).toBe("enc");
    expect(parts[1]).toBe("v1");
    // iv = 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32);
    // authTag = 16 bytes = 32 hex chars
    expect(parts[3]).toHaveLength(32);
    // ciphertext is non-empty hex
    expect(parts[4].length).toBeGreaterThan(0);
    expect(parts[4]).toMatch(/^[0-9a-f]+$/);
  });

  // ─── decryptValue edge cases ───────────────────────────────────

  it("should return plaintext as-is if not encrypted (migration progressive)", () => {
    const plaintext = "not-encrypted-value";
    expect(decryptValue(plaintext)).toBe(plaintext);
  });

  it("should throw on tampered ciphertext", () => {
    const encrypted = encryptValue("secret");
    // Tamper with the ciphertext (last part)
    const parts = encrypted.split(":");
    parts[4] = "0".repeat(parts[4].length);
    const tampered = parts.join(":");
    expect(() => decryptValue(tampered)).toThrow();
  });

  it("should throw on invalid encrypted format (wrong number of parts)", () => {
    expect(() => decryptValue("enc:v1:only-two-parts")).toThrow("Format chiffré invalide");
  });

  it("should throw on tampered auth tag", () => {
    const encrypted = encryptValue("secret");
    const parts = encrypted.split(":");
    parts[3] = "f".repeat(32); // fake auth tag
    const tampered = parts.join(":");
    expect(() => decryptValue(tampered)).toThrow();
  });

  // ─── isEncrypted ───────────────────────────────────────────────

  it("should detect encrypted values", () => {
    const encrypted = encryptValue("test");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("should detect plaintext values as not encrypted", () => {
    expect(isEncrypted("plain-value")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("enc:v2:different")).toBe(false);
  });

  // ─── encryptIfSensitive / decryptIfSensitive ──────────────────

  it("should encrypt sensitive keys", () => {
    const encrypted = encryptIfSensitive("stripe_secret_key", "sk_test_123");
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptIfSensitive("stripe_secret_key", encrypted)).toBe("sk_test_123");
  });

  it("should NOT encrypt non-sensitive keys", () => {
    const value = "some-public-value";
    expect(encryptIfSensitive("shop_name", value)).toBe(value);
    expect(decryptIfSensitive("shop_name", value)).toBe(value);
  });

  it("should handle all SENSITIVE_KEYS", () => {
    for (const key of SENSITIVE_KEYS) {
      const value = `test-value-for-${key}`;
      const encrypted = encryptIfSensitive(key, value);
      expect(isEncrypted(encrypted)).toBe(true);
      expect(decryptIfSensitive(key, encrypted)).toBe(value);
    }
  });

  it("SENSITIVE_KEYS should contain expected keys", () => {
    const expected = [
      "stripe_secret_key",
      "stripe_webhook_secret",
      "stripe_publishable_key",
      "easy_express_api_key",
      "gmail_app_password",
      "deepl_api_key",
      "pfs_email",
      "pfs_password",
      "stripe_connect_account_id",
    ];
    for (const key of expected) {
      expect(SENSITIVE_KEYS.has(key)).toBe(true);
    }
  });

  // ─── Error: missing ENCRYPTION_KEY ─────────────────────────────

  it("should throw if ENCRYPTION_KEY is missing", async () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;

    // Re-import to get fresh module (vitest module cache won't help here,
    // so we test the function directly which reads env at call time)
    vi.resetModules();
    const freshMod = await import("@/lib/encryption");
    expect(() => freshMod.encryptValue("test")).toThrow("ENCRYPTION_KEY manquante");

    process.env.ENCRYPTION_KEY = originalKey;
  });

  it("should throw if ENCRYPTION_KEY is wrong length", async () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");

    vi.resetModules();
    const freshMod = await import("@/lib/encryption");
    expect(() => freshMod.encryptValue("test")).toThrow("32 bytes");

    process.env.ENCRYPTION_KEY = originalKey;
  });

  // ─── Cross-key decryption should fail ──────────────────────────

  it("should fail to decrypt with a different key", async () => {
    const encrypted = encryptValue("secret");

    const originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

    vi.resetModules();
    const freshMod = await import("@/lib/encryption");
    expect(() => freshMod.decryptValue(encrypted)).toThrow();

    process.env.ENCRYPTION_KEY = originalKey;
  });
});
