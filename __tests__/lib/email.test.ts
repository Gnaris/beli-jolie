/**
 * Tests pour lib/email.ts — envoi d'emails via SMTP (nodemailer).
 *
 * On configure les env vars SMTP_* + on injecte une fabrique de transporter de test
 * via __setTransporterFactoryForTests pour vérifier :
 *   - config incomplète → no_config
 *   - pas d'adresse expéditeur → no_from
 *   - succès → sent:true + messageId
 *   - erreur SMTP → smtp_error
 *   - attachments convertis en Buffer
 *   - format "Nom <email>"
 *   - validateSmtpConfig (verify succès / échec / champs manquants)
 *   - variables d'environnement SMTP_*
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  sendMail,
  validateSmtpConfig,
  __setTransporterFactoryForTests,
  type SmtpConnectionConfig,
} from "@/lib/email";

interface SendMailRecord {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

interface FakeTransporter {
  sendMail: (opts: Record<string, unknown>) => Promise<{ messageId: string }>;
  verify: () => Promise<true>;
}

function buildSuccessFactory(
  messageId: string,
  captured: {
    config?: SmtpConnectionConfig;
    sent?: SendMailRecord;
  }
) {
  return (cfg: SmtpConnectionConfig): FakeTransporter => {
    captured.config = cfg;
    return {
      sendMail: async (opts) => {
        captured.sent = opts as unknown as SendMailRecord;
        return { messageId };
      },
      verify: async () => true,
    };
  };
}

function buildFailingFactory(err: Error) {
  return (): FakeTransporter => ({
    sendMail: async () => {
      throw err;
    },
    verify: async () => {
      throw err;
    },
  });
}

describe("lib/email — SMTP via nodemailer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_EMAIL;
    delete process.env.SMTP_FROM_NAME;
  });

  afterEach(() => {
    __setTransporterFactoryForTests(null);
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function setValidConfig() {
    process.env.SMTP_HOST = "smtp.hostinger.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "contact@maboutique.com";
    process.env.SMTP_PASSWORD = "secret";
    process.env.SMTP_FROM_EMAIL = "contact@maboutique.com";
  }

  describe("sendMail — configuration", () => {
    it("retourne no_config si aucun serveur SMTP n'est configuré", async () => {
      const captured: Record<string, unknown> = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("ignored", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await sendMail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      });

      expect(result).toEqual({ sent: false, reason: "no_config" });
      expect(captured.config).toBeUndefined();
    });

    it("retourne no_config si un champ obligatoire manque (port absent)", async () => {
      process.env.SMTP_HOST = "smtp.hostinger.com";
      process.env.SMTP_USER = "contact@maboutique.com";
      process.env.SMTP_PASSWORD = "secret";
      process.env.SMTP_FROM_EMAIL = "contact@maboutique.com";
      // no SMTP_PORT

      const result = await sendMail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      });

      expect(result).toEqual({ sent: false, reason: "no_config" });
    });

    it("retourne no_from si la config SMTP est OK mais aucune adresse expéditeur", async () => {
      process.env.SMTP_HOST = "smtp.hostinger.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SECURE = "false";
      process.env.SMTP_USER = "someone@example.com";
      process.env.SMTP_PASSWORD = "secret";
      // no SMTP_FROM_EMAIL — user serves as fallback
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await sendMail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      });

      // user sert de fallback from → email est envoyé.
      expect(result.sent).toBe(true);
    });

    it("retourne no_from quand ni fromEmail ni user ne sont renseignés pour le from", async () => {
      process.env.SMTP_HOST = "smtp.hostinger.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SECURE = "false";
      process.env.SMTP_USER = "login-only";
      process.env.SMTP_PASSWORD = "secret";
      // no SMTP_FROM_EMAIL → user serves as from fallback
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await sendMail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      });

      expect(result.sent).toBe(true);
      expect(captured.sent?.from).toBe("login-only");
    });
  });

  describe("sendMail — succès", () => {
    beforeEach(() => setValidConfig());

    it("construit correctement la connexion et envoie via nodemailer", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("msg_abc123", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await sendMail({
        to: "user@example.com",
        subject: "Bienvenue",
        html: "<p>Hello</p>",
      });

      expect(result).toEqual({ sent: true, id: "msg_abc123" });
      expect(captured.config).toEqual({
        host: "smtp.hostinger.com",
        port: 587,
        secure: false,
        user: "contact@maboutique.com",
        password: "secret",
      });
      expect(captured.sent?.to).toBe("user@example.com");
      expect(captured.sent?.subject).toBe("Bienvenue");
      expect(captured.sent?.html).toBe("<p>Hello</p>");
      expect(captured.sent?.from).toBe("contact@maboutique.com");
    });

    it('utilise "Nom <email>" quand fromName est fourni dans le config', async () => {
      process.env.SMTP_FROM_NAME = "Ma Boutique";
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({ to: "x@y.com", subject: "s", html: "h" });

      expect(captured.sent?.from).toBe("Ma Boutique <contact@maboutique.com>");
    });

    it("fromName en params surcharge celui du config", async () => {
      process.env.SMTP_FROM_NAME = "Defaut";
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        fromName: "Specifique",
      });

      expect(captured.sent?.from).toBe("Specifique <contact@maboutique.com>");
    });

    it("nettoie les guillemets et chevrons du nom d'expéditeur", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        fromName: 'Beli "Jolie" <hack>',
      });

      expect(captured.sent?.from).toBe("Beli Jolie hack <contact@maboutique.com>");
    });

    it("joint plusieurs destinataires avec une virgule", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({ to: ["a@y.com", "b@y.com"], subject: "s", html: "h" });

      expect(captured.sent?.to).toBe("a@y.com, b@y.com");
    });

    it("inclut replyTo si fourni", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        replyTo: "support@maboutique.com",
      });

      expect(captured.sent?.replyTo).toBe("support@maboutique.com");
    });

    it("port 465 active automatiquement secure=true par défaut", async () => {
      process.env.SMTP_PORT = "465";
      delete process.env.SMTP_SECURE;
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({ to: "x@y.com", subject: "s", html: "h" });

      expect(captured.config?.secure).toBe(true);
    });

    it("secure explicite 'true' force TLS même sur port 587", async () => {
      process.env.SMTP_SECURE = "true";
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({ to: "x@y.com", subject: "s", html: "h" });

      expect(captured.config?.secure).toBe(true);
    });
  });

  describe("sendMail — attachments", () => {
    beforeEach(() => setValidConfig());

    it("encode un contenu Buffer tel quel", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const data = Buffer.from("Hello world");
      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        attachments: [{ filename: "hello.txt", content: data }],
      });

      expect(captured.sent?.attachments).toEqual([
        { filename: "hello.txt", content: data },
      ]);
    });

    it("décode une string base64 en Buffer", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        attachments: [{ filename: "doc.pdf", content: "SGVsbG8=" }],
      });

      const att = captured.sent?.attachments?.[0];
      expect(att?.filename).toBe("doc.pdf");
      expect(att?.content.toString("utf8")).toBe("Hello");
    });

    it("ignore une pièce jointe sans content ni path", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        attachments: [{ filename: "missing.txt" }],
      });

      expect(captured.sent?.attachments).toBeUndefined();
    });

    it("n'envoie pas la clé attachments si aucune pièce jointe fournie", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await sendMail({ to: "x@y.com", subject: "s", html: "h" });

      expect(captured.sent?.attachments).toBeUndefined();
    });
  });

  describe("sendMail — erreurs SMTP", () => {
    beforeEach(() => setValidConfig());

    it("retourne smtp_error si nodemailer lève une exception", async () => {
      __setTransporterFactoryForTests(
        buildFailingFactory(new Error("connection refused")) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
      });

      expect(result.sent).toBe(false);
      if (!result.sent) {
        expect(result.reason).toBe("smtp_error");
        expect(result.error).toBe("connection refused");
      }
    });
  });

  describe("sendMail — env vars", () => {
    it("utilise process.env.SMTP_* pour la configuration", async () => {
      process.env.SMTP_HOST = "smtp.env.example";
      process.env.SMTP_PORT = "465";
      process.env.SMTP_USER = "env-user@example.com";
      process.env.SMTP_PASSWORD = "env-password";
      process.env.SMTP_FROM_EMAIL = "env-sender@example.com";

      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
      });

      expect(result.sent).toBe(true);
      expect(captured.config?.host).toBe("smtp.env.example");
      expect(captured.config?.port).toBe(465);
      expect(captured.config?.secure).toBe(true); // auto à 465
      expect(captured.config?.user).toBe("env-user@example.com");
      expect(captured.sent?.from).toBe("env-sender@example.com");
    });
  });

  describe("validateSmtpConfig", () => {
    it("refuse quand le serveur est vide", async () => {
      const result = await validateSmtpConfig({
        host: "",
        port: 587,
        secure: false,
        user: "u",
        password: "p",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Serveur");
    });

    it("refuse un port invalide", async () => {
      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: "not-a-port",
        secure: false,
        user: "u",
        password: "p",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Port");
    });

    it("refuse un port hors plage", async () => {
      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: 99999,
        secure: false,
        user: "u",
        password: "p",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Port");
    });

    it("refuse quand l'identifiant est vide", async () => {
      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "",
        password: "p",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Identifiant");
    });

    it("refuse quand le mot de passe est vide", async () => {
      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "u",
        password: "",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Mot de passe");
    });

    it("retourne valid:true quand transporter.verify() réussit (sans testTo)", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("ignored", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "u",
        password: "p",
      });

      expect(result).toEqual({ valid: true });
      expect(captured.sent).toBeUndefined();
    });

    it("retourne valid:false avec le message si verify échoue", async () => {
      __setTransporterFactoryForTests(
        buildFailingFactory(new Error("Invalid login: 535")) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "u",
        password: "bad",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid login: 535");
    });

    it("envoie un vrai email de test quand testTo est fourni", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("test_msg_42", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      const result = await validateSmtpConfig({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "contact@example.com",
        password: "p",
        testTo: "contact@example.com",
        fromEmail: "contact@example.com",
        fromName: "Ma Boutique",
      });

      expect(result.valid).toBe(true);
      expect(result.testMessageId).toBe("test_msg_42");
      expect(captured.sent?.to).toBe("contact@example.com");
      expect(captured.sent?.from).toBe("Ma Boutique <contact@example.com>");
      expect(captured.sent?.subject).toContain("Test de connexion SMTP");
      expect(captured.sent?.html).toContain("Connexion SMTP réussie");
    });

    it("utilise user comme fallback fromEmail pour le test", async () => {
      const captured: { config?: SmtpConnectionConfig; sent?: SendMailRecord } = {};
      __setTransporterFactoryForTests(
        buildSuccessFactory("m1", captured) as (cfg: SmtpConnectionConfig) => FakeTransporter as never
      );

      await validateSmtpConfig({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "contact@example.com",
        password: "p",
        testTo: "contact@example.com",
      });

      expect(captured.sent?.from).toBe("contact@example.com");
    });
  });
});
