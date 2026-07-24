import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import {
  MC_PID,
  MC_SECRET,
  decodeMicrostoreTokenExpiration,
  generateMicrostoreScanCode,
  isMicrostoreSessionExpiredError,
} from "@/lib/microstore-auth";

describe("microstore-auth — generateMicrostoreScanCode", () => {
  it("génère un code au format attendu pid&random&ts&md5", () => {
    const { code, random, timestamp } = generateMicrostoreScanCode(1784885187);
    // Le code doit toujours commencer par le pid
    expect(code.startsWith(`${MC_PID}&`)).toBe(true);
    // Format complet : 4 segments séparés par &
    const parts = code.split("&");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(MC_PID);
    expect(parts[1]).toBe(random);
    expect(parts[2]).toBe(String(timestamp));
    // Le 4ᵉ segment = md5 (32 chars hex)
    expect(parts[3]).toMatch(/^[a-f0-9]{32}$/);
  });

  it("reproduit exactement le hash observé dans un HAR réel", () => {
    // HAR capturé le 2026-07-24 : ce code a été poll par le vrai web.mc.app.
    // On regénère le même code à partir des mêmes inputs et on vérifie le hash.
    const random = "enPrbkB2BHbx";
    const timestamp = 1784885187;
    const expected = "a873076405f803f857219adebe281ab7";

    // Reproduit manuellement (on ne peut pas forcer `random` dans la fonction).
    const toHash = `${MC_PID}&${random}&${timestamp}&${MC_SECRET}`;
    const hash = crypto.createHash("md5").update(toHash).digest("hex");
    expect(hash).toBe(expected);
  });

  it("le random fait 12 caractères alphanumériques", () => {
    const { random } = generateMicrostoreScanCode();
    expect(random).toHaveLength(12);
    // Alphabet Microstore (pas de I ni O ni l ni q ni u ni v ni z pour éviter
    // les ambiguïtés visuelles dans le QR).
    expect(random).toMatch(/^[ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz0123456789]{12}$/);
  });

  it("le QR payload contient l'URL du auth handler + secretCode encodé", () => {
    const { code, qrPayload } = generateMicrostoreScanCode();
    expect(qrPayload).toMatch(/^https:\/\/mc2-h5\.dokkr\.net\/auth\.html/);
    expect(qrPayload).toContain("secretCode=");
    // Le code est bien encodé (les & sont %26)
    expect(qrPayload).toContain(encodeURIComponent(code));
  });

  it("utilise le timestamp fourni ou la date actuelle", () => {
    const explicit = generateMicrostoreScanCode(9999);
    expect(explicit.timestamp).toBe(9999);
    const now = Math.floor(Date.now() / 1000);
    const auto = generateMicrostoreScanCode();
    expect(auto.timestamp).toBeGreaterThanOrEqual(now - 1);
    expect(auto.timestamp).toBeLessThanOrEqual(now + 1);
  });
});

describe("microstore-auth — isMicrostoreSessionExpiredError", () => {
  it("reconnaît les codes 6011 / 6061 / 6001 comme expiration", () => {
    expect(isMicrostoreSessionExpiredError(6011)).toBe(true);
    expect(isMicrostoreSessionExpiredError(6061)).toBe(true);
    expect(isMicrostoreSessionExpiredError(6001)).toBe(true);
  });

  it("retourne false pour les autres codes", () => {
    expect(isMicrostoreSessionExpiredError(0)).toBe(false);
    expect(isMicrostoreSessionExpiredError(undefined)).toBe(false);
    expect(isMicrostoreSessionExpiredError(6244)).toBe(false);
    expect(isMicrostoreSessionExpiredError(6245)).toBe(false);
  });
});

describe("microstore-auth — decodeMicrostoreTokenExpiration", () => {
  // JWT réel observé dans le HAR (payload contient exp: 1798405655)
  const realToken =
    "1eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJSRUxBVElPTl9DT0RFIiwicmVsYXRpb25Db2RlIjoiZFlRZm4xbDdnTmJSNm5rSmttWTIyaGtqRXFScjNNT0EiLCJhcHBJZCI6MTAwMDIyLCJleHAiOjE3OTg0MDU2NTUsImlhdCI6MTc2Njg2OTY1NSwianRpIjoiZTEyNzU0NWMtZTEwMC00YzdiLTgyZDYtYWU0MjEwODNlZTBjIn0.jaUapPGpfozWyeF7XVqAW6_CRIzfR8KJlLpKNxp8lk4";

  it("décode le champ exp d'un mask_token réel", () => {
    const exp = decodeMicrostoreTokenExpiration(realToken);
    expect(exp).toBe(1798405655);
  });

  it("retourne null pour une chaîne vide ou invalide", () => {
    expect(decodeMicrostoreTokenExpiration("")).toBeNull();
    expect(decodeMicrostoreTokenExpiration("pas-un-jwt")).toBeNull();
    expect(decodeMicrostoreTokenExpiration("only.two")).toBe(null);
  });

  it("gère un JWT dont le payload n'a pas d'exp", () => {
    // header.payload.sig où payload = {"sub":"x"} (base64url)
    const noExp =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature";
    expect(decodeMicrostoreTokenExpiration(noExp)).toBeNull();
  });
});
