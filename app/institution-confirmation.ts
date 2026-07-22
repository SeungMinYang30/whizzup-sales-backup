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
  institutionRelationship?: "related" | "different";
  relatedOrganization?: string;
  institutionRejectedOrganizations?: string[];
  cancelled?: boolean;
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
      "이름이 비슷한 기관을 찾았습니다. 기록을 합치거나, 관련 기관으로 구분해 둘 수 있습니다.";

    const requestedBox = document.createElement("div");
    requestedBox.className = "institution-confirmation-requested";
    const requestedLabel = document.createElement("span");
    requestedLabel.textContent = "이번에 입력한 기관";
    const requestedName = document.createElement("strong");
    requestedName.textContent = requested;
    requestedBox.append(requestedLabel, requestedName);

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
      const actions = document.createElement("div");
      actions.className = "institution-confirmation-actions";

      const sameButton = document.createElement("button");
      sameButton.type = "button";
      sameButton.className = "institution-confirmation-primary";
      sameButton.textContent = "같은 기관으로 연결";
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
      card.append(candidateLabel, candidateName, reasons, actions);
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
      "한 번 확인한 관계는 기억해서 다음 입력부터 같은 질문을 줄입니다.";

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

