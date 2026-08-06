# WHIZZUP Sales Hub

Vercel + Supabase 기반 WHIZZUP 영업관리 운영 사이트입니다. 화면과 주요
업무 기능은 기존 OpenAI Sites 운영본을 유지하고, 로그인은 Google 계정과
Supabase Auth를 사용합니다.

현재 소스는 OpenAI Sites 운영본 v399를 Vercel 환경에 맞게 이식한
버전입니다. 최종 전환 전까지 기존 Sites 운영본과 `whizzup.kr`은 변경하지
않습니다.

## 구성

- Vercel: Next.js 애플리케이션
- Supabase: Google 로그인과 PostgreSQL 데이터베이스
- GitHub: 비공개 소스 저장 및 Vercel 자동 배포
- OpenAI API: 사이트 안의 AI 빠른 기록 정리
- GPT Actions OAuth: ChatGPT에서 승인된 사용자 이름으로 기록 저장

## 최초 설정 순서

1. Supabase SQL Editor에서
   `supabase/migrations/202607180001_initial_schema.sql`을 실행합니다.
   기존 데이터베이스라면 앱의 서버 스키마 보정이 누락된 최신 테이블과
   컬럼을 추가합니다.
2. Supabase Auth에서 Google 공급자를 설정합니다.
3. `.env.example`의 항목을 Vercel 환경변수에 등록합니다.
   `DATABASE_URL`은 Supabase `Connect` 화면의 **Transaction pooler
   (포트 6543)** 연결 문자열을 사용합니다.
4. `BOOTSTRAP_ADMIN_EMAIL`에는 최초 대표관리자 Google 이메일을 넣습니다.
5. `API_CREDENTIALS_SECRET`에는 충분히 긴 임의의 비밀값을 등록합니다.
   이 값은 사이트에서 별도 등록한 OpenAI API 키를 암호화할 때 사용합니다.
6. 카카오 지도 키를 서버 환경변수로 사용할 경우
   `KAKAO_JAVASCRIPT_KEY`를 등록합니다.
7. GitHub 저장소를 Vercel에 Import하고 배포합니다.

배포된 서버는 첫 데이터베이스 요청 때 최신 스키마를 한 번 더 확인하므로,
두 번째 마이그레이션을 놓친 기존 백업 환경도 같은 구조로 보정됩니다.

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

## 데이터와 배포

- Vercel 프로젝트와 Supabase PostgreSQL을 사용합니다.
- 공통 스키마는 `db/schema.ts`, Vercel 스키마는 `db/vercel-schema.ts`,
  기능 마이그레이션은 `drizzle/`에 있습니다.
- 앱 코드에서도 필요한 테이블을 `CREATE TABLE IF NOT EXISTS`로 확인해 기존
  배포 데이터와 호환됩니다.
- 기존 GPT Sites 구성원 데이터가 동기화되면 동일한 Google 이메일의
  승인·역할·개별 권한을 이어서 사용합니다. 구성원은 Vercel 사이트에서
  `Google로 계속하기`를 최초 한 번만 누르면 되며, 신규 가입 신청이나
  관리자 재승인은 필요하지 않습니다.

## Google Calendar 연동

- `WHIZZUP_GOOGLE_CALENDAR_ICS_URL`은 Google에서 가져오는 위즈업 공유일정을
  읽기 전용으로 표시합니다.
- 사이트 일정의 등록·수정·삭제를 Google과 양방향으로 동기화하려면
  `WHIZZUP_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON`을 Vercel 비밀 환경 변수로
  등록하고, 해당 서비스 계정 이메일에 대상 캘린더의 일정 변경 권한을 줍니다.
- `WHIZZUP_GOOGLE_CALENDAR_ID`를 등록하지 않으면 ICS 주소에서 캘린더 ID를
  자동으로 확인합니다.
- 시공 일정은 시공·납품 일정표를 원본으로 유지하며 Google에서 변경해도
  원본 일정표 값으로 다시 동기화됩니다.
- `WHIZZUP_GOOGLE_CONSTRUCTION_CALENDAR_ID`에는 사이트가 원본으로 관리하는
  시공·납품 일정 전용 Google 캘린더 `위즈업 시공`의 캘린더 ID를 등록합니다.
  시공 일정은 이 캘린더에만 쓰며 일반 `위즈업` 캘린더에서는 읽거나 만들지 않습니다.
