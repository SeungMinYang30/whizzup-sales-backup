import { NextResponse } from "next/server";
import { chatGPTSignOutPath } from "../../../chatgpt-auth";
import { clearDirectSession } from "../../../../lib/app-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await clearDirectSession();
  return NextResponse.redirect(new URL(chatGPTSignOutPath("/"), request.url));
}
