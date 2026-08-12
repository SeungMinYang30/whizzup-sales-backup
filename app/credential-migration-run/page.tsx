export const dynamic = "force-dynamic";

export default function CredentialMigrationRunPage() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>직원 비밀번호 이전</h1>
      <p style={{ lineHeight: 1.6, marginBottom: 24 }}>
        이전 GPT 사이트에 남아 있는 직원 비밀번호 설정 기록을 이메일 기준으로 가져옵니다.
        현재 Vercel에 이미 비밀번호가 있는 계정은 변경하지 않습니다.
      </p>
      <form action="/api/credential-migration" method="post">
        <button
          type="submit"
          style={{
            width: "100%",
            minHeight: 48,
            border: 0,
            borderRadius: 10,
            background: "#3048e8",
            color: "white",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          누락된 직원 비밀번호 전체 이전
        </button>
      </form>
    </main>
  );
}
