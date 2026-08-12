import { getD1 } from "../../db";
import { requirePrimaryOwner } from "../../lib/collaboration";

export const dynamic = "force-dynamic";

export default async function CredentialMigrationRunPage() {
  await requirePrimaryOwner();
  const row = await getD1()
    .prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN credential.member_id IS NULL THEN 1 ELSE 0 END) AS missing
      FROM members member
      LEFT JOIN member_credentials credential ON credential.member_id = member.id
      WHERE member.status = 'approved'
        AND LOWER(member.email) NOT LIKE '%-noreply@chatgpt.com'
        AND LOWER(member.email) NOT LIKE 'sites-%'
        AND LOWER(member.display_name) NOT LIKE '%screenshot service%'
        AND LOWER(member.display_name) NOT LIKE '%system service%'
    `)
    .first<{ total: number; missing: number }>();
  const total = Number(row?.total ?? 0);
  const missing = Number(row?.missing ?? 0);

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>직원 비밀번호 이전</h1>
      <p style={{ lineHeight: 1.6, marginBottom: 18 }}>
        승인 직원 {total}명 중 비밀번호 설정 완료 {total - missing}명, 미설정 {missing}명입니다.
      </p>
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
