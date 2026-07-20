type InstitutionConfirmationPayload = {
  error?: string;
  record?: Record<string, unknown>;
  needsInstitutionConfirmation?: boolean;
  requestedOrganization?: string;
  suggestedOrganizations?: string[];
  suggestedInstitutionMatches?: Array<{
    organization: string;
    reasons: string[];
    score: number;
  }>;
};

export type InstitutionDecision = {
  confirmedOrganization?: string;
  institutionSeparate?: boolean;
};

export async function fetchWithInstitutionConfirmation(
  input: RequestInfo | URL,
  init: Omit<RequestInit, "body"> & {
    body: Record<string, unknown>;
  },
  decisions = new Map<string, InstitutionDecision>(),
) {
  let body = { ...init.body };
  for (;;) {
    const response = await fetch(input, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as InstitutionConfirmationPayload &
      Record<string, unknown>;
    if (
      response.status !== 409 ||
      !payload.needsInstitutionConfirmation ||
      !payload.requestedOrganization ||
      !payload.suggestedOrganizations?.length
    ) {
      return { response, payload };
    }

    const requested = payload.requestedOrganization;
    let decision = decisions.get(requested);
    if (!decision) {
      const confirmedOrganization = payload.suggestedOrganizations.find(
        (candidate) => {
          const match = payload.suggestedInstitutionMatches?.find(
            (item) => item.organization === candidate,
          );
          const reasons = match?.reasons?.length
            ? `\n판단 근거: ${match.reasons.join(", ")}`
            : "";
          return window.confirm(
            `입력한 기관: ${requested}\n기존 기관: ${candidate}${reasons}\n\n두 기관의 전체 기록을 하나의 기관으로 합칠까요?\n지역별 단톡 공유 묶음과는 별개입니다.\n확인: 기관 데이터 전체 합치기\n취소: 서로 다른 기관으로 저장`,
          );
        },
      );
      decision = confirmedOrganization
        ? { confirmedOrganization }
        : { institutionSeparate: true };
      decisions.set(requested, decision);
    }

    body = {
      ...body,
      ...decision,
      institutionDecisions: {
        ...(body.institutionDecisions &&
        typeof body.institutionDecisions === "object"
          ? (body.institutionDecisions as Record<string, InstitutionDecision>)
          : {}),
        [requested]: decision,
      },
    };
  }
}
