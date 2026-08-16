import CrmApp from "./crm-app";
import LoginPage from "./login-page";
import { getApplicationIdentity } from "../lib/app-auth";
import { getOrCreateMember } from "../lib/collaboration";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const identity = await getApplicationIdentity();
    if (!identity) return <LoginPage />;
    // The client session request refreshes last_seen_at immediately after mount.
    // Avoid issuing the same database write twice during the initial navigation.
    await getOrCreateMember(identity);
    if (identity.source === "chatgpt") {
      return <LoginPage />;
    }
    return (
      <CrmApp
        identity={{
          email: identity.email,
          displayName: identity.displayName,
        }}
        signOutPath="/api/auth/logout"
      />
    );
  } catch (error) {
    // Authentication bootstrapping must never take the public entry page down.
    // A fresh password login replaces an old or otherwise unusable session.
    console.error("Authentication bootstrap failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return <LoginPage />;
  }
}

