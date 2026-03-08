"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

/**
 * Wrapper client pour le SessionProvider NextAuth
 * Nécessaire car app/layout.tsx est un Server Component
 */
export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
