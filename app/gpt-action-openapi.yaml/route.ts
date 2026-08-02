export const dynamic = "force-dynamic";

function yamlString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const yaml = `openapi: 3.1.0
info:
  title: WHIZZUP TM Meeting CRM
  description: 승인된 사용자가 음성 또는 대화로 정리한 통화·미팅 기록을 공동 관리표에 저장합니다.
  version: 5.0.0
servers:
  - url: ${yamlString(origin)}
paths:
  /api/gpt-actions/activities:
    get:
      operationId: checkCrmConnection
      summary: 현재 사용자의 위즈업 CRM 연결 상태 확인
      security:
        - oauth2: [activities:write]
      responses:
        "200":
          description: 연결된 사용자 정보
    post:
      operationId: createActivityRecord
      summary: 사용자가 최종 확인한 통화 또는 미팅 기록 저장
      description: 반드시 사용자에게 구조화된 내용을 먼저 보여주고 명시적으로 저장 승인을 받은 뒤 호출합니다.
      security:
        - oauth2: [activities:write]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [organization, activityType]
              properties:
                activityDate:
                  type: string
                  description: YYYY-MM-DD 형식. 모르면 빈 문자열.
                dateConfidence:
                  type: string
                  enum: [확정, 대화시각 추정, 월만 확인, 날짜 미상]
                activityType:
                  type: string
                  description: TM, TM·통화, 학교 미팅, 학교 진행 중, 기관 미팅, 협력사 미팅, 방문 미팅, 업무 통화, 수주 중 가장 알맞은 값
                category:
                  type: string
                  enum: [학교, 기관, 협력사, 내부, 기타]
                contactMethod:
                  type: string
                  enum: [유선, 방문, 온라인, 진행 공유, 기타]
                  description: 전화와 TM은 유선, 직접 대면은 방문, 화상 미팅은 온라인, 수주 후 공사·설치·교육 진행 전달은 진행 공유
                region:
                  type: string
                  description: 시도와 시군구를 포함한 지역. 모르면 빈 문자열.
                organization:
                  type: string
                budgetType:
                  type: string
                  description: 자체예산, 문체부, 늘봄, 교육청 등 예산 출처나 종류
                budgetAmount:
                  type: string
                  description: "사용자가 말한 단위를 포함한 예산금액. 예: 2,480만원"
                topic:
                  type: string
                summary:
                  type: string
                status:
                  type: string
                  enum: [신규 접촉, 상담 진행, 제안·견적, 결과 대기, 재영업 상담, 사후관리, 수주 전환, 영업 종료]
                  description: 상담 내용과 수주 결과를 기준으로 영업 진행상황을 분류합니다.
                temperature:
                  type: string
                  enum: [높음, 중간, 낮음]
                awardStatus:
                  type: string
                  enum: [미정, 위즈업 수주, 협력사 수주, 타업체 수주]
                  description: 수주 결과가 확인되지 않았으면 미정
                awardCompany:
                  type: string
                  description: 위즈업 수주는 위즈업, 타업체 수주는 실제 수주 업체명, 미정은 빈 문자열
                executionType:
                  type: string
                  enum: [직영, 컨소, 해당 없음]
                  description: 수주 사업의 진행 방식
                consortiumCompany:
                  type: string
                  description: 컨소 방식일 때 함께 진행하는 업체명
                awardStage:
                  type: string
                  enum: [미정, 협상, 계약, 일정 조율, 설치·공사 진행, 검수·교육 진행, 납품 완료]
                  description: 수주 건의 현재 진행 상태
                progressManager:
                  type: string
                  description: 수주 후 업무 진행을 맡는 담당자
                followUpRequired:
                  type: boolean
                followUpDate:
                  type: string
                  description: YYYY-MM-DD 형식. 미정이면 빈 문자열.
                nextAction:
                  type: string
                progressSchedule:
                  type: array
                  description: 수주 후 진행 중인 학교·기관의 여러 작업 일정을 모두 담습니다. 사용자가 연도 없이 월/일만 말하면 현재 연도를 사용해 YYYY-MM-DD로 정리합니다.
                  items:
                    type: object
                    required: [label, date]
                    properties:
                      label:
                        type: string
                        description: 목공, 시스템, 교육처럼 일정의 짧은 이름
                      date:
                        type: string
                        description: YYYY-MM-DD 형식
                contactName:
                  type: string
                  description: 학교나 기관의 담당자 이름 또는 직책
                contactRole:
                  type: string
                  description: 공사 담당자, 회계 담당자처럼 기관 인물의 명시된 역할
                contactPhone:
                  type: string
                contactEmail:
                  type: string
                  description: 학교나 기관 담당자의 이메일 주소
                notes:
                  type: string
      responses:
        "201":
          description: 저장 완료
components:
  schemas:
    ActivityRecord:
      type: object
      description: TM·미팅 기록 저장 요청
      properties:
        organization:
          type: string
        activityType:
          type: string
  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: ${yamlString(`${origin}/oauth/authorize`)}
          tokenUrl: ${yamlString(`${origin}/api/oauth/token`)}
          scopes:
            activities:write: 통화·미팅 기록을 공동 관리표에 저장
`;
  return new Response(yaml, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
