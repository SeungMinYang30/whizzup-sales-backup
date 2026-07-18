# WHIZZUP 영업관리 독립 운영 사이트

기존 OpenAI Sites 영업관리 시스템과 별도로 운영할 수 있도록 만든
Vercel + Supabase 기반 독립 사이트입니다. 화면과 주요 업무 기능은 기존
사이트를 유지하고, 로그인은 Google 계정과 Supabase Auth를 사용합니다.

## 구성

- Vercel: Next.js 애플리케이션
- Supabase: Google 로그인과 PostgreSQL 데이터베이스
- GitHub: 비공개 소스 저장 및 Vercel 자동 배포
- OpenAI API: 사이트 안의 AI 빠른 기록 정리
- GPT Actions OAuth: ChatGPT에서 승인된 사용자 이름으로 기록 저장

## 최초 설정 순서

1. Supabase SQL Editor에서
   `supabase/migrations/202607180001_initial_schema.sql`을 실행합니다.
2. Supabase Auth에서 Google 공급자를 설정합니다.
3. `.env.example`의 항목을 Vercel 환경변수에 등록합니다.
   `DATABASE_URL`은 Supabase `Connect` 화면의 **Transaction pooler
   (포트 6543)** 연결 문자열을 사용합니다.
4. `BOOTSTRAP_ADMIN_EMAIL`에는 최초 대표관리자 Google 이메일을 넣습니다.
5. GitHub 저장소를 Vercel에 Import하고 배포합니다.

비밀번호, `DATABASE_URL`, OpenAI API 키는 GitHub에 올리지 않습니다.

## 로컬 검증

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

## 데이터 보안

- 브라우저는 업무 테이블에 직접 접근하지 않습니다.
- 모든 업무 요청은 로그인과 구성원 권한을 확인하는 Next.js API를 통합니다.
- Supabase의 `anon`, `authenticated` 역할에는 업무 테이블 권한을 주지 않습니다.
- 데이터베이스 연결 문자열은 Vercel 서버 환경변수에만 저장합니다.
