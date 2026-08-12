import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../lib/supabase/server";
import { getLocalAuthIdentity } from "../lib/local-auth";

export type ChatGPTUser = {
  authUserId: string | null;
  memberId: number | null;
  username: string;
  provider: "google" | "local";
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const localIdentity = await getLocalAuthIdentity();
  if (localIdentity) {
    return {
      authUserId: null,
      memberId: localIdentity.memberId,
      username: localIdentity.username,
      provider: "local",
      displayName: localIdentity.displayName,
      email: localIdentity.email,
      fullName: localIdentity.displayName,
    };
  }
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id || !user.email) return null;

  const metadata = user.user_metadata ?? {};
  const fullName =
    stringValue(metadata.full_name) ||
    stringValue(metadata.name) ||
    stringValue(metadata.preferred_username) ||
    null;

  return {
    authUserId: user.id,
    memberId: null,
    username: "",
    provider: "google",
    displayName: fullName ?? user.email,
    email: user.email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/login?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function googleSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/auth/google?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/auth/signout?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (
    url.pathname === "/login" ||
    url.pathname.startsWith("/auth/google") ||
    url.pathname.startsWith("/auth/callback") ||
    url.pathname.startsWith("/auth/signout")
  ) {
    return "/";
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
