import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getSupabasePublicConfig,
} from "../../../lib/supabase/server";
import { safeRelativeReturnPath } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    getSupabasePublicConfig();
    const requestUrl = new URL(request.url);
    const returnTo = safeRelativeReturnPath(
      requestUrl.searchParams.get("return_to") ?? "/",
    );
    const configuredOrigin = process.env.APP_ORIGIN?.trim();
    const origin = configuredOrigin || requestUrl.origin;
    const callbackUrl = new URL("/auth/callback", origin);
    callbackUrl.searchParams.set("return_to", returnTo);

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.toString(),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      throw error ?? new Error("Google 로그인 주소를 만들지 못했습니다.");
    }
    return NextResponse.redirect(data.url);
  } catch (error) {
    console.error("Unable to start Google sign-in", error);
    const url = new URL("/login", request.url);
    url.searchParams.set(
      "error",
      "Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    return NextResponse.redirect(url);
  }
}
