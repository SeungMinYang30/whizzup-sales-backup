type InstitutionConfirmationPayload = {
  error?: string;
  needsInstitutionConfirmation?: boolean;
  requestedOrganization?: string;
  requestedInstitutionDetails?: {
    region?: string;
    address?: string;
    schoolCode?: string;
    phone?: string;
    officialName?: string;
  };
  suggestedOrganizations?: string[];
  suggestedInstitutionMatches?: Array<{
    organization: string;
    reasons: string[];
    score: number;
    region?: string;
    address?: string;
    schoolCode?: string;
    phone?: string;
    officialName?: string;
  }>;
};

export type InstitutionDecision = {
  confirmedOrganization?: string;
  institutionSeparate?: boolean;
  institutionRelationship?: "related" | "different";
  relatedOrganization?: string;
  institutionRejectedOrganizations?: string[];
  cancelled?: boolean;
};

export type OfficialSchoolConfirmation = {
  draftIndex: number;
  requestedOrganization: string;
  candidates: Array<{
    officeCode: string;
    schoolCode: string;
    name: string;
    kind: string;
    region: string;
    address: string;
    phone: string;
    coeducation: string;
    existingOrganizations: string[];
    existingRecordCount: number;
  }>;
};

export type OfficialSchoolDecision = {
  organization: string;
  normalizeExistingAliases: boolean;
  useOriginal?: boolean;
};

function requestInstitutionDecision(
  payload: InstitutionConfirmationPayload,
): Promise<InstitutionDecision> {
  return new Promise((resolve) => {
    const requested = payload.requestedOrganization ?? "입력한 기관";
    const candidates = payload.suggestedOrganizations ?? [];
    const previousOverflow = document.body.style.overflow;
    const overlay = document.createElement("div");
    overlay.className = "institution-confirmation-overlay";
    overlay.setAttribute("role", "presentation");

    const dialog = document.createElement("section");
    dialog.className = "institution-confirmation-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "institution-confirmation-title");

    const eyebrow = document.createElement("span");
    eyebrow.className = "institution-confirmation-eyebrow";
    eyebrow.textContent = "기관명 확인";
    const title = document.createElement("h2");
    title.id = "institution-confirmation-title";
    title.textContent = "기존 기관과 연결할까요?";
    const description = document.createElement("p");
    description.className = "institution-confirmation-description";
    description.textContent =
      "이름이 비슷한 기존 기관을 찾았습니다. 지역·주소·학교 코드·전화번호를 비교한 뒤 이번 새 기록을 연결할 기관을 선택해 주세요.";

    const requestedBox = document.createElement("div");
    requestedBox.className = "institution-confirmation-requested";
    const requestedLabel = document.createElement("span");
    requestedLabel.textContent = "이번에 입력한 기관";
    const requestedName = document.createElement("strong");
    requestedName.textContent = requested;
    requestedBox.append(requestedLabel, requestedName);
    const requestedDetails = [
      payload.requestedInstitutionDetails?.officialName &&
      payload.requestedInstitutionDetails.officialName !== requested
        ? `공식명 ${payload.requestedInstitutionDetails.officialName}`
        : "",
      payload.requestedInstitutionDetails?.region
        ? `지역 ${payload.requestedInstitutionDetails.region}`
        : "",
      payload.requestedInstitutionDetails?.address
        ? `주소 ${payload.requestedInstitutionDetails.address}`
        : "",
      payload.requestedInstitutionDetails?.schoolCode
        ? `학교 코드 ${payload.requestedInstitutionDetails.schoolCode}`
        : "",
      payload.requestedInstitutionDetails?.phone
        ? `전화 ${payload.requestedInstitutionDetails.phone}`
        : "",
    ].filter(Boolean);
    if (requestedDetails.length) {
      const details = document.createElement("small");
      details.className = "official-school-details";
      details.textContent = requestedDetails.join(" · ");
      requestedBox.append(details);
    }

    const list = document.createElement("div");
    list.className = "institution-confirmation-candidates";

    const finish = (decision: InstitutionDecision) => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      resolve(decision);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish({ cancelled: true });
      }
    };

    candidates.forEach((candidate) => {
      const match = payload.suggestedInstitutionMatches?.find(
        (item) => item.organization === candidate,
      );
      const card = document.createElement("article");
      card.className = "institution-confirmation-candidate";
      const candidateLabel = document.createElement("span");
      candidateLabel.textContent = "기존 기관";
      const candidateName = document.createElement("strong");
      candidateName.textContent = candidate;
      const reasons = document.createElement("p");
      reasons.textContent = match?.reasons?.length
        ? match.reasons.join(" · ")
        : "기관명이 비슷합니다.";
      const comparison = document.createElement("p");
      comparison.className = "official-school-details";
      const comparisonValues = [
        match?.officialName && match.officialName !== candidate
          ? `공식명 ${match.officialName}`
          : "",
        match?.region ? `지역 ${match.region}` : "",
        match?.address ? `주소 ${match.address}` : "",
        match?.schoolCode ? `학교 코드 ${match.schoolCode}` : "",
        match?.phone ? `전화 ${match.phone}` : "",
      ].filter(Boolean);
      comparison.textContent = comparisonValues.length
        ? comparisonValues.join(" · ")
        : "비교할 지역·주소·학교 코드·전화번호가 아직 등록되지 않았습니다.";
      const actions = document.createElement("div");
      actions.className = "institution-confirmation-actions";

      const sameButton = document.createElement("button");
      sameButton.type = "button";
      sameButton.className = "institution-confirmation-primary";
      sameButton.textContent = "이 기존 기관에 새 기록 연결";
      sameButton.addEventListener("click", () =>
        finish({ confirmedOrganization: candidate }),
      );

      const relatedButton = document.createElement("button");
      relatedButton.type = "button";
      relatedButton.className = "institution-confirmation-secondary";
      relatedButton.textContent = "관련 기관으로 구분";
      relatedButton.addEventListener("click", () =>
        finish({
          institutionSeparate: true,
          institutionRelationship: "related",
          relatedOrganization: candidate,
        }),
      );
      actions.append(sameButton, relatedButton);
      card.append(candidateLabel, candidateName, reasons, comparison, actions);
      list.append(card);
    });

    const separateButton = document.createElement("button");
    separateButton.type = "button";
    separateButton.className = "institution-confirmation-separate";
    separateButton.textContent = "새로운 별도 기관으로 등록";
    separateButton.addEventListener("click", () =>
      finish({
        institutionSeparate: true,
        institutionRelationship: "different",
        institutionRejectedOrganizations: candidates,
      }),
    );

    const note = document.createElement("small");
    note.className = "institution-confirmation-note";
    note.textContent =
      "같은 기관으로 확인한 축약명은 해당 지역의 기관 별칭으로 기억합니다. 확인 전에는 자동으로 병합하지 않습니다.";

    dialog.append(
      eyebrow,
      title,
      description,
      requestedBox,
      list,
      separateButton,
      note,
    );
    overlay.append(dialog);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
  });
}

export function requestOfficialSchoolDecision(
  payload: OfficialSchoolConfirmation,
): Promise<OfficialSchoolDecision> {
  return new Promise((resolve) => {
    const previousOverflow = document.body.style.overflow;
    const overlay = document.createElement("div");
    overlay.className = "institution-confirmation-overlay";
    overlay.setAttribute("role", "presentation");

    const dialog = document.createElement("section");
    dialog.className = "institution-confirmation-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "official-school-confirmation-title");

    const eyebrow = document.createElement("span");
    eyebrow.className = "institution-confirmation-eyebrow";
    eyebrow.textContent = "교육청 학교정보 확인";
    const title = document.createElement("h2");
    title.id = "official-school-confirmation-title";
    title.textContent = "어느 학교가 맞나요?";
    const description = document.createElement("p");
    description.className = "institution-confirmation-description";
    description.textContent =
      "교육청 공식 학교명과 지역·주소를 확인한 뒤 선택해 주세요. 선택한 명칭으로 이번 기록을 정리합니다.";

    const requestedBox = document.createElement("div");
    requestedBox.className = "institution-confirmation-requested";
    const requestedLabel = document.createElement("span");
    requestedLabel.textContent = "채팅에서 확인한 학교명";
    const requestedName = document.createElement("strong");
    requestedName.textContent = payload.requestedOrganization;
    requestedBox.append(requestedLabel, requestedName);

    const list = document.createElement("div");
    list.className = "institution-confirmation-candidates";

    const finish = (decision: OfficialSchoolDecision) => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      resolve(decision);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish({
          organization: payload.requestedOrganization,
          normalizeExistingAliases: false,
          useOriginal: true,
        });
      }
    };

    payload.candidates.forEach((candidate) => {
      const card = document.createElement("article");
      card.className = "institution-confirmation-candidate";
      const candidateLabel = document.createElement("span");
      candidateLabel.textContent = "교육청 공식 학교";
      const candidateName = document.createElement("strong");
      candidateName.textContent = candidate.name;
      const details = document.createElement("p");
      details.className = "official-school-details";
      details.textContent = [
        candidate.kind,
        candidate.region,
        candidate.address,
      ]
        .filter(Boolean)
        .join(" · ");
      const existing = document.createElement("p");
      existing.className = "official-school-existing";
      existing.textContent = candidate.existingRecordCount
        ? `기존 ${candidate.existingOrganizations.join(", ")} 기록 ${candidate.existingRecordCount.toLocaleString()}건도 이 공식 명칭으로 통일됩니다.`
        : "기존 축약 기록은 없으며 이번 기록부터 공식 명칭을 사용합니다.";
      const actions = document.createElement("div");
      actions.className =
        "institution-confirmation-actions official-school-actions";
      const chooseButton = document.createElement("button");
      chooseButton.type = "button";
      chooseButton.className = "institution-confirmation-primary";
      chooseButton.textContent = candidate.existingRecordCount
        ? "이 학교로 선택하고 기존 기록도 통일"
        : "이 학교로 선택";
      chooseButton.addEventListener("click", () =>
        finish({
          organization: candidate.name,
          normalizeExistingAliases: candidate.existingRecordCount > 0,
        }),
      );
      actions.append(chooseButton);
      card.append(
        candidateLabel,
        candidateName,
        details,
        existing,
        actions,
      );
      list.append(card);
    });

    const originalButton = document.createElement("button");
    originalButton.type = "button";
    originalButton.className = "institution-confirmation-separate";
    originalButton.textContent = "입력한 이름 그대로 사용";
    originalButton.addEventListener("click", () =>
      finish({
        organization: payload.requestedOrganization,
        normalizeExistingAliases: false,
        useOriginal: true,
      }),
    );

    const note = document.createElement("small");
    note.className = "institution-confirmation-note";
    note.textContent =
      "이름이 비슷하더라도 지역·주소가 다르면 다른 학교를 선택하거나 입력한 이름을 그대로 사용해 주세요.";

    dialog.append(
      eyebrow,
      title,
      description,
      requestedBox,
      list,
      originalButton,
      note,
    );
    overlay.append(dialog);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
  });
}

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
    const responseText = await response.text();
    let payload: InstitutionConfirmationPayload & Record<string, unknown>;
    try {
      payload = responseText
        ? (JSON.parse(responseText) as InstitutionConfirmationPayload &
            Record<string, unknown>)
        : {};
    } catch {
      payload = {
        error: response.ok
          ? "등록 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해 주세요."
          : response.status >= 500
            ? "기관 등록 처리 시간이 길어졌습니다. 잠시 후 목록을 새로고침해 확인해 주세요."
            : "기관 등록 요청을 처리하지 못했습니다. 입력 내용을 확인해 주세요.",
      };
    }
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
      decision = await requestInstitutionDecision(payload);
      decisions.set(requested, decision);
    }
    if (decision.cancelled) {
      throw new Error("기관 연결 확인을 취소했습니다. 입력 내용을 다시 확인해 주세요.");
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
