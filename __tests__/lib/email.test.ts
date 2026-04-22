/**
 * Tests for lib/email.ts — envoi d'emails via l'API Resend.
 *
 * On mocke getCachedResendConfig + fetch pour vérifier :
 *   - l'appel HTTP est construit correctement (URL, headers, body)
 *   - fallback no_config si aucune clé configurée
 *   - no_from si pas d'adresse expéditeur
 *   - gestion des erreurs HTTP
 *   - attachments encodés en base64
 *   - format du champ "from" (avec/sans nom)
 *   - validation de clé API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

type ResendConfig = {
  apiKey: string | null;
  fromEmail: string | null;
  fromName: string | null;
  notifyEmail: string | null;
};

const configRef: { current: ResendConfig } = {
  current: { apiKey: null, fromEmail: null, fromName: null, notifyEmail: null },
};

vi.mock("@/lib/cached-data", () => ({
  getCachedResendConfig: vi.fn(async () => configRef.current),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { sendMail, validateResendApiKey } from "@/lib/email";

type FetchCall = [string, RequestInit];

function installFetch(response: Response): Mock {
  const mock = vi.fn(async () => response);
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function installThrowingFetch(err: Error): Mock {
  const mock = vi.fn(async () => {
    throw err;
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function lastCall(mock: Mock): FetchCall {
  return mock.mock.calls[0] as unknown as FetchCall;
}

function parseBody(mock: Mock): Record<string, unknown> {
  const [, init] = lastCall(mock);
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("lib/email", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    configRef.current = {
      apiKey: null,
      fromEmail: null,
      fromName: null,
      notifyEmail: null,
    };
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_NAME;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe("sendMail — configuration absente", () => {
    it("retourne no_config si aucune clé API n'est configurée", async () => {
      const fetchMock = installFetch(new Response("", { status: 200 }));

      const result = await sendMail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      });

      expect(result).toEqual({ sent: false, reason: "no_config" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("retourne no_from si la clé est OK mais pas d'adresse expéditeur", async () => {
      configRef.current.apiKey = "re_test_key";
      const fetchMock = installFetch(new Response("", { status: 200 }));

      const result = await sendMail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      });

      expect(result).toEqual({ sent: false, reason: "no_from" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("sendMail — succès", () => {
    beforeEach(() => {
      configRef.current.apiKey = "re_test_key";
      configRef.current.fromEmail = "contact@maboutique.com";
    });

    it("construit correctement la requête POST vers l'API Resend", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_abc123" }), { status: 200 })
      );

      const result = await sendMail({
        to: "user@example.com",
        subject: "Bienvenue",
        html: "<p>Hello</p>",
      });

      expect(result).toEqual({ sent: true, id: "msg_abc123" });
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = lastCall(fetchMock);
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer re_test_key");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = parseBody(fetchMock);
      expect(body.from).toBe("contact@maboutique.com");
      expect(body.to).toEqual(["user@example.com"]);
      expect(body.subject).toBe("Bienvenue");
      expect(body.html).toBe("<p>Hello</p>");
    });

    it('utilise "Nom <email>" quand fromName est fourni dans le config', async () => {
      configRef.current.fromName = "Ma Boutique";
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({ to: "x@y.com", subject: "s", html: "h" });
      expect(parseBody(fetchMock).from).toBe(
        "Ma Boutique <contact@maboutique.com>"
      );
    });

    it("fromName en params surcharge celui du config", async () => {
      configRef.current.fromName = "Defaut";
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        fromName: "Specifique",
      });
      expect(parseBody(fetchMock).from).toBe(
        "Specifique <contact@maboutique.com>"
      );
    });

    it("nettoie les guillemets du nom d'expéditeur", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        fromName: 'Beli "Jolie" <hack>',
      });
      expect(parseBody(fetchMock).from).toBe(
        "Beli Jolie hack <contact@maboutique.com>"
      );
    });

    it("accepte plusieurs destinataires sous forme de tableau", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({
        to: ["a@y.com", "b@y.com"],
        subject: "s",
        html: "h",
      });
      expect(parseBody(fetchMock).to).toEqual(["a@y.com", "b@y.com"]);
    });

    it("inclut reply_to si fourni", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        replyTo: "support@maboutique.com",
      });
      expect(parseBody(fetchMock).reply_to).toBe("support@maboutique.com");
    });
  });

  describe("sendMail — attachments", () => {
    beforeEach(() => {
      configRef.current.apiKey = "re_test_key";
      configRef.current.fromEmail = "contact@maboutique.com";
    });

    it("encode en base64 un contenu Buffer", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      const data = Buffer.from("Hello world");
      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        attachments: [{ filename: "hello.txt", content: data }],
      });

      expect(parseBody(fetchMock).attachments).toEqual([
        { filename: "hello.txt", content: data.toString("base64") },
      ]);
    });

    it("passe une string content telle quelle (déjà en base64)", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        attachments: [{ filename: "doc.pdf", content: "SGVsbG8=" }],
      });

      expect(parseBody(fetchMock).attachments).toEqual([
        { filename: "doc.pdf", content: "SGVsbG8=" },
      ]);
    });

    it("ignore une pièce jointe sans content ni path", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
        attachments: [{ filename: "missing.txt" }],
      });

      const body = parseBody(fetchMock);
      expect(body.attachments).toBeUndefined();
    });

    it("n'inclut pas la clé attachments si aucune pièce jointe fournie", async () => {
      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      await sendMail({ to: "x@y.com", subject: "s", html: "h" });
      expect("attachments" in parseBody(fetchMock)).toBe(false);
    });
  });

  describe("sendMail — erreurs API", () => {
    beforeEach(() => {
      configRef.current.apiKey = "re_test_key";
      configRef.current.fromEmail = "contact@maboutique.com";
    });

    it("retourne api_error si Resend répond HTTP 4xx/5xx", async () => {
      installFetch(
        new Response(JSON.stringify({ message: "Invalid from address" }), {
          status: 422,
        })
      );

      const result = await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
      });

      expect(result.sent).toBe(false);
      if (!result.sent) {
        expect(result.reason).toBe("api_error");
        expect(result.error).toBe("Invalid from address");
      }
    });

    it("retourne api_error si fetch lève une exception", async () => {
      installThrowingFetch(new Error("network down"));

      const result = await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
      });

      expect(result.sent).toBe(false);
      if (!result.sent) {
        expect(result.reason).toBe("api_error");
        expect(result.error).toBe("network down");
      }
    });

    it("retourne api_error avec HTTP <status> si corps JSON illisible", async () => {
      installFetch(new Response("Internal Server Error", { status: 500 }));

      const result = await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
      });

      expect(result.sent).toBe(false);
      if (!result.sent) {
        expect(result.reason).toBe("api_error");
        expect(result.error).toBe("HTTP 500");
      }
    });
  });

  describe("sendMail — fallback env vars", () => {
    it("utilise process.env.RESEND_API_KEY si aucune config admin", async () => {
      process.env.RESEND_API_KEY = "re_env_key";
      process.env.RESEND_FROM_EMAIL = "env@maboutique.com";

      const fetchMock = installFetch(
        new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })
      );

      const result = await sendMail({
        to: "x@y.com",
        subject: "s",
        html: "h",
      });

      expect(result.sent).toBe(true);
      const [, init] = lastCall(fetchMock);
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer re_env_key");
      expect(parseBody(fetchMock).from).toBe("env@maboutique.com");
    });
  });

  describe("validateResendApiKey", () => {
    it("refuse une clé vide", async () => {
      const result = await validateResendApiKey("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("vide");
    });

    it("refuse une clé qui ne commence pas par re_", async () => {
      const result = await validateResendApiKey("sk_not_resend");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("re_");
    });

    it("retourne valid:true si Resend accepte la clé (HTTP 200)", async () => {
      installFetch(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const result = await validateResendApiKey("re_test_key");
      expect(result.valid).toBe(true);
    });

    it("retourne valid:false si Resend refuse la clé (HTTP 401)", async () => {
      installFetch(
        new Response(JSON.stringify({ message: "Invalid" }), { status: 401 })
      );
      const result = await validateResendApiKey("re_bad_key");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("invalide");
    });

    it("retourne valid:false si le réseau échoue", async () => {
      installThrowingFetch(new Error("timeout"));
      const result = await validateResendApiKey("re_test_key");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });
});
