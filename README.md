# WHIZZUP TM·미팅 공동 관리

ChatGPT 로그인, 관리자 승인, 공유 GPT Actions를 결합한 공동 영업
관리사이트입니다. 기존 대화 내보내기에서 정리한 TM·미팅 기록을 유지하면서
승인된 동료가 새 기록과 후속 일정을 함께 관리할 수 있습니다.

## 동작 방식

1. 사용자가 자기 ChatGPT 계정으로 사이트에 로그인합니다.
2. 첫 번째 사용자는 관리자가 되고, 이후 사용자는 승인 대기 상태가 됩니다.
3. 관리자가 구성원을 승인하면 대시보드와 공동 기록에 접근할 수 있습니다.
4. 공유 GPT는 사용자에게 정리 결과를 먼저 확인받은 뒤 OAuth Action으로
   기록을 저장합니다.
5. 저장된 기록에는 실제 작성자 이름이 표시됩니다.

사이트 안에서 OpenAI API를 별도로 호출하지 않습니다. AI 대화와 음성 입력은
각 사용자의 ChatGPT에서 실행되고, 이 사이트는 인증·권한·공동 데이터 저장을
담당합니다.

## 주요 기능

- 전체 활동, 재연락, 관심도, 기관별 대시보드
- 통화·미팅 기록 추가, 수정, 검색, 필터, CSV 내보내기
- ChatGPT 로그인과 서버 측 구성원 승인
- 관리자 전용 구성원 승인·사용 중지
- 기관별 선택 체크박스와 기관 기록 일괄삭제
- 위즈업 수주·타업체 수주 구분과 실제 수주 업체명 기록
- 사용자별 OAuth 토큰을 사용하는 GPT Actions
- 공유 GPT 연결 안내, OpenAPI 스키마, 개인정보 처리 안내
- 기록별 작성자 표시와 관리자 전용 삭제

## 로컬 실행과 검증

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
npm run lint
npm test
npm run test:integration
```

`npm run test:integration`은 로컬 개발 서버에서 승인 대기, 관리자 승인, OAuth
코드 교환, GPT Action 저장, 작성자 표시와 테스트 기록 삭제까지 검증합니다.

## 데이터와 배포

- `.openai/hosting.json`의 Sites 프로젝트와 D1 바인딩을 사용합니다.
- Drizzle 스키마는 `db/schema.ts`, 마이그레이션은 `drizzle/`에 있습니다.
- 앱 코드에서도 필요한 테이블을 `CREATE TABLE IF NOT EXISTS`로 확인해 기존
  배포 데이터와 호환됩니다.
- 실제 동료 초대 전 소유자가 비공개 배포에 먼저 접속해 최초 관리자 등록을
  완료해야 합니다.

## Google Calendar 연동

- `WHIZZUP_GOOGLE_CALENDAR_ICS_URL`은 Google에서 가져오는 위즈업 공유일정을
  읽기 전용으로 표시합니다.
- 사이트 일정의 등록·수정·삭제를 Google과 양방향으로 동기화하려면
  `WHIZZUP_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON`을 Sites 비밀 환경 변수로
  등록하고, 해당 서비스 계정 이메일에 대상 캘린더의 일정 변경 권한을 줍니다.
- `WHIZZUP_GOOGLE_CALENDAR_ID`를 등록하지 않으면 ICS 주소에서 캘린더 ID를
  자동으로 확인합니다.
- 시공 일정은 시공·납품 일정표를 원본으로 유지하며 Google에서 변경해도
  원본 일정표 값으로 다시 동기화됩니다.
- `WHIZZUP_GOOGLE_CONSTRUCTION_CALENDAR_ID`에는 사이트가 원본으로 관리하는
  시공·납품 일정 전용 Google 캘린더 `위즈업 시공`의 캘린더 ID를 등록합니다.
  시공 일정은 이 캘린더에만 쓰며 일반 `위즈업` 캘린더에서는 읽거나 만들지 않습니다.
