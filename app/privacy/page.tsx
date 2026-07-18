export const metadata = {
  title: "개인정보 처리 안내 | 위즈업 영업관리",
};

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <article>
        <p className="section-kicker">PRIVACY</p>
        <h1>개인정보 처리 안내</h1>
        <p className="policy-date">시행일: 2026년 7월 17일</p>

        <h2>1. 처리 목적</h2>
        <p>
          위즈업 TM·미팅 영업관리 시스템은 승인된 구성원이 통화·미팅 기록을
          공동으로 관리하고 후속 업무를 수행하기 위해 사용됩니다.
        </p>

        <h2>2. 처리하는 정보</h2>
        <p>
          Google 로그인으로 확인된 이름과 이메일, 사용자가 입력한 기관·담당자·
          통화 및 미팅 내용, 후속 일정, 기록 작성 시각을 처리합니다.
        </p>

        <h2>3. 공유 GPT 연결</h2>
        <p>
          사용자가 공유 GPT에서 저장을 승인하면 해당 대화에서 구조화된 영업
          기록만 이 시스템으로 전송됩니다. 기존 기록 삭제나 사용자 관리 권한은
          GPT에 제공하지 않습니다.
        </p>

        <h2>4. 보관 및 접근</h2>
        <p>
          기록은 회사 업무 관리 목적으로 보관되며, 관리자 승인을 받은 사용자만
          열람할 수 있습니다. 관리자는 사용자의 접근을 중지할 수 있습니다.
        </p>

        <h2>5. 정정 및 삭제</h2>
        <p>
          사용자는 잘못된 기록의 수정 또는 삭제를 사이트 관리자에게 요청할 수
          있습니다. 계정 접근 중지가 필요한 경우에도 관리자에게 요청합니다.
        </p>

        <Link className="policy-back" href="/">
          ← 관리사이트로 돌아가기
        </Link>
      </article>
    </main>
  );
}
import Link from "next/link";
