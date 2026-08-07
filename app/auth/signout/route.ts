import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { safeRelativeReturnPath } from "../../chatgpt-auth";
import { deleteLocalSession } from "../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeRelativeReturnPath(
    requestUrl.searchParams.get("return_to") ?? "/",
  );
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  await deleteLocalSession();

  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(loginUrl);
}
