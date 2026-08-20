import "server-only";

import { cookies } from "next/headers";

const PASSWORD_SETUP_COOKIE = "whizzup_password_setup";
const PASSWORD_SETUP_TTL_MS = 10 * 60 * 1000;

type PasswordSetupTicket = {
  memberId: number;
  email: string;
  expiresAt: number;
};

function signingSecret() {
  const value = String(
    process.env.PASSWORD_SETUP_SECRET ??
      process.env.PRIMARY_EXPORT_SECRET ??
      process.env.STANDBY_SYNC_SECRET ??
      "",
  ).trim();
  if (!value) throw new Error("Password setup signing secret is not configured");
  return value;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Buffer.from(signature).toString("base64url");
}

export async function createPasswordSetupTicket(memberId: number, email: string) {
  const payload: PasswordSetupTicket = {
    memberId,
    email: email.trim().toLowerCase(),
    expiresAt: Date.now() + PASSWORD_SETUP_TTL_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(encoded);
  const store = await cookies();
  store.set(PASSWORD_SETUP_COOKIE, `${encoded}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(payload.expiresAt),
  });
}

export async function readPasswordSetupTicket() {
  const value = (await cookies()).get(PASSWORD_SETUP_COOKIE)?.value ?? "";
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = await sign(encoded);
  if (signature.length !== expected.length) return null;
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (difference !== 0) return null;
  try {
    const ticket = JSON.parse(base64UrlDecode(encoded)) as PasswordSetupTicket;
    if (!Number.isInteger(ticket.memberId) || ticket.memberId <= 0) return null;
    if (!ticket.email || ticket.expiresAt <= Date.now()) return null;
    return ticket;
  } catch {
    return null;
  }
}

export async function clearPasswordSetupTicket() {
  (await cookies()).set(PASSWORD_SETUP_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}
