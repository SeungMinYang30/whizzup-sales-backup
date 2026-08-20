import InitialPasswordSetup from "../initial-password-setup";
import { findMemberByEmail, memberHasPassword } from "../../lib/app-auth";
import { readPasswordSetupTicket } from "../../lib/password-setup-ticket";

export const dynamic = "force-dynamic";

export default async function PasswordSetupPage() {
  const ticket = await readPasswordSetupTicket();
  const member = ticket ? await findMemberByEmail(ticket.email) : null;

  if (
    !ticket ||
    !member ||
    String(member.status) !== "approved" ||
    Number(member.id) !== ticket.memberId
  ) {
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
          <h2 id="password-setup-unavailable-title">비밀번호 설정을 다시 시작해 주세요</h2>
          <p>로그인 화면에서 등록된 직원 이메일을 입력하면 새 비밀번호 설정 화면이 열립니다.</p>
          <div className="initial-password-actions">
            <a className="initial-password-account-link" href="/login">
              로그인 화면으로 이동
            </a>
          </div>
        </section>
      </div>
    );
  }

  const hasPassword = await memberHasPassword(Number(member.id));
  return (
    <InitialPasswordSetup
      email={ticket.email}
      mode={hasPassword ? "reset" : "initial"}
    />
  );
}

