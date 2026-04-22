import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkLoginLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/security";
import { verifyLoginOtp } from "@/lib/login-otp";
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
        const user = await prisma.user.findUnique({
          where: { email },
        });

        // Generic message to prevent user enumeration
        const INVALID_CREDENTIALS = "Identifiants incorrects ou compte non activé.";

        if (!user) {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID_CREDENTIALS);
        }

        // Vérification du statut du compte
        // PENDING peut se connecter pour voir l'état et modifier ses infos
        // (l'accès aux routes d'achat est bloqué par le middleware).
        if (user.status === "REJECTED") {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID_CREDENTIALS);
        }

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

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          await recordLoginFailure(email, ip);
          throw new Error(INVALID);
        }

        // Connexion OTP réservée aux clients non rejetés
        if (user.role !== "CLIENT" || user.status === "REJECTED") {
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
     * jwt callback — enrichit le token avec les données custom
     * Appelé à chaque création/refresh de token
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.status = (user as { status: UserStatus }).status;
        token.company = (user as { company: string }).company;
      }
      return token;
    },

    /**
     * session callback — expose les données du token dans la session client
     * Appelé à chaque accès à useSession() ou getServerSession()
     */
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.status = token.status as UserStatus;
        session.user.company = token.company as string;
      }
      return session;
    },
  },
};
