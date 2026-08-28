import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkLoginLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/security";
import { verifyLoginOtp } from "@/lib/login-otp";
import { sendAdminLoginNotification } from "@/lib/admin-login-notify";
import { tenantALS } from "@/lib/tenant-als";
import type { Role, UserStatus } from "@prisma/client";

/**
 * Configuration NextAuth
 *
 * Stratégie : JWT (pas de session en base de données)
 * Provider  : Credentials (email + mot de passe)
 *
 * Flux d'authentification :
 * 1. L'utilisateur soumet email + mot de passe
 * 2. On vérifie en base de données
 * 3. On vérifie que le statut est APPROVED
 * 4. On retourne l'utilisateur avec son rôle
 * 5. Le middleware redirige selon le rôle (ADMIN → /admin, CLIENT → /)
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 jours
  },

  pages: {
    signIn: "/connexion",
    error: "/connexion",
  },

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },

      async authorize(credentials, req) {
        // Vérification des champs obligatoires
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email et mot de passe requis.");
        }

        const email = credentials.email.toLowerCase().trim();
        const ip =
          req?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
          req?.headers?.["x-real-ip"]?.toString() ||
          "unknown";

        // ── Vérification verrouillage du compte ──
        const lockoutMessage = await checkLoginLockout(email);
        if (lockoutMessage) {
          throw new Error(lockoutMessage);
        }

        // Recherche de l'utilisateur en base
        const user = await prisma.user.findFirst({
          where: { email },
        });

        // Generic message to prevent user enumeration
        const INVALID_CREDENTIALS = "Identifiants incorrects ou compte non activé.";

        if (!user) {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID_CREDENTIALS);
        }

        // Vérification du statut du compte
        // PENDING et REJECTED peuvent se connecter : la première voit la boutique
        // sans prix (en attente de validation), la seconde a été révoquée mais
        // garde accès en lecture (badge « Révoqué » dans le header). L'accès
        // aux fonctions d'achat (prix, commande, messages) est filtré côté
        // action serveur via `canSeePrices()` / `requireAuth(APPROVED)`.

        // Vérification du mot de passe
        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!passwordMatch) {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID_CREDENTIALS);
        }

        // Connexion réussie — reset du lockout + enregistrer date de connexion
        await Promise.all([
          recordLoginSuccess(email, ip),
          prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        ]);

        // Notification connexion admin sur le mail perso vérifié (fire-and-forget,
        // ne bloque jamais le login même si SMTP est down). tenantALS.run est
        // obligatoire ici car l'IIFE continue après la fin du scope requête.
        if (user.role === "ADMIN" && user.tenantId) {
          const tenantId = user.tenantId;
          const userAgent = req?.headers?.["user-agent"]?.toString() || "inconnu";
          void tenantALS.run(tenantId, () =>
            sendAdminLoginNotification({
              tenantId,
              adminEmail: user.email,
              ip,
              userAgent,
            })
          );
        }

        // Retour de l'utilisateur (sans le mot de passe)
        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          status: user.status,
          company: user.company,
        };
      },
    }),

    // ── Connexion par code OTP envoyé par email (clients uniquement) ──
    CredentialsProvider({
      id: "otp",
      name: "Code par email",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },

      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.code) {
          throw new Error("Email et code requis.");
        }

        const email = credentials.email.toLowerCase().trim();
        const ip =
          req?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
          req?.headers?.["x-real-ip"]?.toString() ||
          "unknown";

        const lockoutMessage = await checkLoginLockout(email);
        if (lockoutMessage) {
          throw new Error(lockoutMessage);
        }

        const INVALID = "Code invalide ou expiré.";

        const result = await verifyLoginOtp(email, credentials.code);
        if (!result.success) {
          await recordLoginFailure(email, ip);
          if (result.reason === "too_many_attempts") {
            throw new Error(
              "Trop de tentatives. Veuillez demander un nouveau code."
            );
          }
          if (result.reason === "expired") {
            throw new Error("Ce code a expiré. Veuillez en demander un nouveau.");
          }
          throw new Error(INVALID);
        }

        const user = await prisma.user.findFirst({ where: { email } });
        if (!user) {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID);
        }

        // Connexion OTP réservée aux clients (PENDING/APPROVED/REJECTED tous
        // autorisés : la révocation ne bloque pas la connexion, elle retire
        // seulement l'accès aux prix et à la commande — cf. `canSeePrices()`).
        if (user.role !== "CLIENT") {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID);
        }

        await Promise.all([
          recordLoginSuccess(email, ip),
          prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        ]);

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          status: user.status,
          company: user.company,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * redirect callback — résout `callbackUrl` sur le domaine du tenant courant
     *
     * Sans ce callback, NextAuth v4 préfixe les URLs relatives (ex : `signOut({
     * callbackUrl: "/" })`) avec `NEXTAUTH_URL` qui est fixée à un unique
     * domaine (`beliandjolie.com` en prod). Résultat : un client qui se
     * déconnecte depuis `issyma.fr` finit sur `beliandjolie.com`.
     *
     * On reconstruit ici l'origin depuis le `Host:` header courant. Le fallback
     * `baseUrl` (= `NEXTAUTH_URL`) reste actif si `headers()` n'est pas
     * disponible (contextes hors requête).
     */
    async redirect({ url, baseUrl }) {
      let origin = baseUrl;
      try {
        const { headers } = await import("next/headers");
        const h = await headers();
        const host = h.get("host");
        if (host) {
          const forwarded = h.get("x-forwarded-proto");
          const proto = forwarded
            ? forwarded.split(",")[0]!.trim()
            : host.startsWith("localhost") || host.startsWith("127.0.0.1")
              ? "http"
              : "https";
          origin = `${proto}://${host}`;
        }
      } catch {
        /* headers indisponibles → fallback baseUrl */
      }
      if (url.startsWith("/")) return `${origin}${url}`;
      try {
        if (new URL(url).origin === origin) return url;
      } catch {
        /* URL invalide → fallback origin */
      }
      return origin;
    },

    /**
     * jwt callback — enrichit le token avec les données custom
     * Appelé à chaque création/refresh de token. Lors d'un `update()` côté
     * client, on relit le statut/role en base pour propager une approbation
     * admin sans demander à l'utilisateur de se reconnecter.
     */
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.status = (user as { status: UserStatus }).status;
        token.company = (user as { company: string }).company;
        // Multi-tenant : on grave le tenantId au moment du login. Ainsi un cookie
        // exporté puis rejoué sur un autre domaine sera refusé par requireAdmin
        // (voir lib/auth-helpers.ts).
        token.tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
        token.lastCheckedAt = Date.now();
        token.deleted = false;
        return token;
      }

      // Si la session a déjà été marquée supprimée, on ne la ressuscite pas.
      if (token.deleted) return token;

      // Re-vérification périodique de l'existence de l'utilisateur en BDD.
      // Sans ça, un client supprimé garde une session JWT valide jusqu'à 30 jours
      // car le cookie est auto-suffisant (pas de session DB-backed).
      const now = Date.now();
      const lastCheck = token.lastCheckedAt ?? 0;
      const VERIFY_INTERVAL_MS = 30_000;
      const shouldVerify =
        trigger === "update" || now - lastCheck > VERIFY_INTERVAL_MS;

      if (token.id && shouldVerify) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { status: true, role: true, company: true, tenantId: true },
          });
          if (fresh === null) {
            // Utilisateur supprimé : on invalide la session.
            token.deleted = true;
          } else {
            token.status = fresh.status;
            token.role = fresh.role;
            token.company = fresh.company;
            token.tenantId = fresh.tenantId ?? null;
            token.lastCheckedAt = now;
          }
        } catch {
          // Erreur BDD (réseau, lock…) : on ne déconnecte PAS l'utilisateur.
          // On retentera au prochain tick — le compteur lastCheckedAt n'est pas avancé.
        }
      }
      return token;
    },

    /**
     * session callback — expose les données du token dans la session client
     * Appelé à chaque accès à useSession() ou getServerSession()
     */
    async session({ session, token }) {
      // Token marqué supprimé en BDD : on renvoie une session "sentinelle"
      // qui échoue tous les checks (rôle CLIENT + statut REJECTED).
      // Garde session.user défini pour ne pas casser les `session.user.role`
      // déjà disséminés partout dans le code.
      if (token?.deleted) {
        return {
          ...session,
          user: {
            id: "",
            email: "",
            name: "",
            role: "CLIENT" as Role,
            status: "REJECTED" as UserStatus,
            company: "",
          },
        };
      }
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.status = token.status as UserStatus;
        session.user.company = token.company as string;
        (session.user as { tenantId?: string | null }).tenantId =
          (token.tenantId as string | null | undefined) ?? null;
      }
      return session;
    },
  },
};
