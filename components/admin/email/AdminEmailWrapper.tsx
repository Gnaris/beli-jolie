"use client";

import EmailComposeProvider from "./EmailComposeProvider";
import ComposeEmailDrawer from "./ComposeEmailDrawer";

export default function AdminEmailWrapper({ children }: { children: React.ReactNode }) {
  return (
    <EmailComposeProvider>
      {children}
      <ComposeEmailDrawer />
    </EmailComposeProvider>
  );
}
