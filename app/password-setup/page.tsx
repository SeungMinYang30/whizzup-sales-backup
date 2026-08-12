import InitialPasswordSetup from "../initial-password-setup";
import {
  chatGPTSignOutPath,
  getChatGPTUser,
  googleSignInPath,
} from "../chatgpt-auth";
import { redirect } from "next/navigation";
import {
  findMemberByEmail,
  memberHasPassword,
} from "../../lib/app-auth";

export const dynamic = "force-dynamic";

export default async function PasswordSetupPage() {
  const chatgpt = await getChatGPTUser();
  if (!chatgpt) redirect(googleSignInPath("/password-setup"));
  const email = chatgpt.email.trim().toLowerCase();
  const member = await findMemberByEmail(email);

  if (!member || String(member.status) !== "approved") {
    return (
      <div
        className="initial-password-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-setup-unavailable-title"
      >
        <section className="initial-password-card">
          <div className="direct-login-brand initial-password-brand">
            <img
              className="direct-login-logo"
              src="/whizzup-logo.png"
              alt="WHIZZUP SALES HUB"
              width={126}
              height={83}
            />
          </div>
          <h2 id="password-setup-unavailable-title">승인 계정을 확인해 주세요</h2>
          <p>
            현재 확인된 Google 이메일({email})과 일치하는 승인 계정이 없습니다.
          </p>
          <div className="initial-password-actions">
            <a
              className="initial-password-account-link"
              href={chatGPTSignOutPath("/password-setup")}
            >
              다른 Google 계정으로 확인
            </a>
          </div>
        </section>
      </div>
    );
  }

  const hasPassword = await memberHasPassword(Number(member.id));
  return (
    <InitialPasswordSetup
      email={email}
      mode={hasPassword ? "reset" : "initial"}
    />
  );
}
