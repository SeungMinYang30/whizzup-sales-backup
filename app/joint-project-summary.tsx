"use client";

import { useEffect, useMemo, useState } from "react";

type JointProject = {
  id: number;
  name: string;
  sponsor_organization: string;
  budget_type: string;
  project_year: number;
  joint_round: number;
};

type JointMember = {
  id: number;
  project_id: number;
  organization: string;
  business_round: number;
  role: "sponsor" | "site";
  budget_amount: number | null;
  budget_type: string;
  budget_group_id: number | null;
  activity_budget_amount: string;
  budgets_json: string;
};

type BudgetRow = {
  budgetType?: string;
  budgetGroupId?: number | null;
  budgetAmount?: string | number | null;
};

function money(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function formatWon(value: number | null) {
  return value === null ? "금액 미입력" : `${value.toLocaleString("ko-KR")}원`;
}

function memberBudgets(member: JointMember, fallbackBudgetType: string) {
  let parsed: BudgetRow[] = [];
  try {
    const value = JSON.parse(member.budgets_json || "[]");
    if (Array.isArray(value)) parsed = value;
  } catch {
    parsed = [];
  }
  const rows = parsed
    .map((budget) => ({
      name: String(budget.budgetType || "").trim(),
      groupId: Number(budget.budgetGroupId) || null,
      amount: money(budget.budgetAmount),
    }))
    .filter((budget) => budget.name);
  if (rows.length) return rows;
  return [
    {
      name: member.budget_type || fallbackBudgetType || "예산 미정",
      groupId: Number(member.budget_group_id) || null,
      amount:
        money(member.activity_budget_amount) ?? money(member.budget_amount),
    },
  ];
}

export default function JointProjectSummary({
  projectId,
  organization,
}: {
  projectId: number | null | undefined;
  organization: string;
}) {
  const [projects, setProjects] = useState<JointProject[]>([]);
  const [members, setMembers] = useState<JointMember[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void fetch("/api/joint-projects", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          projects?: JointProject[];
          members?: JointMember[];
        };
        if (!response.ok) throw new Error("공동사업을 불러오지 못했습니다.");
        if (!cancelled) {
          setProjects(payload.projects ?? []);
          setMembers(payload.members ?? []);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const projectMembers = useMemo(
    () =>
      members.filter((member) => Number(member.project_id) === Number(projectId)),
    [members, projectId],
  );
  const budgetTracks = useMemo(() => {
    const totals = new Map<string, { name: string; amount: number; missing: number }>();
    projectMembers
      .filter((member) => member.role === "site")
      .flatMap((member) => memberBudgets(member, project?.budget_type || ""))
      .forEach((budget) => {
        const key = budget.groupId ? `group:${budget.groupId}` : `name:${budget.name}`;
        const current = totals.get(key) ?? { name: budget.name, amount: 0, missing: 0 };
        if (budget.amount === null) current.missing += 1;
        else current.amount += budget.amount;
        totals.set(key, current);
      });
    return [...totals.values()];
  }, [project?.budget_type, projectMembers]);

  if (!projectId || failed || !project || !projectMembers.length) return null;
  const current = projectMembers.find((member) => member.organization === organization);
  const siteMembers = projectMembers.filter((member) => member.role === "site");
  const total = budgetTracks.reduce((sum, track) => sum + track.amount, 0);

  return (
    <details className="joint-project-summary">
      <summary>
        <span className="joint-project-summary-role">
          {current?.role === "sponsor" ? "공동사업 주관" : "공동사업 설치"}
        </span>
        <strong>예산 · {project.budget_type || project.name}</strong>
        <small>
          {project.project_year > 0 ? `${project.project_year}년 · ` : ""}
          {Math.max(1, Number(project.joint_round) || 1)}차 · 주관 {project.sponsor_organization} · 설치 {siteMembers.length}곳 · {formatWon(total)}
        </small>
      </summary>
      <div className="joint-project-summary-body">
        <section>
          <h4>예산 구성</h4>
          {budgetTracks.map((track) => (
            <div key={track.name}>
              <strong>{track.name}</strong>
              <span>{formatWon(track.amount)}</span>
              {track.missing > 0 && <small>금액 미입력 {track.missing}곳</small>}
            </div>
          ))}
        </section>
        <section>
          <h4>연결 기관</h4>
          {projectMembers.map((member) => (
            <div
              className={member.organization === organization ? "current" : ""}
              key={member.id}
            >
              <span>{member.role === "sponsor" ? "주관" : "설치"}</span>
              <strong>{member.organization}</strong>
              <small>{member.business_round}차 사업</small>
              <em>
                {memberBudgets(member, project.budget_type)
                  .map((budget) => `${budget.name} ${formatWon(budget.amount)}`)
                  .join(" · ")}
              </em>
            </div>
          ))}
        </section>
        <p>기관별 연락처·지도·영업·수주·회계 기록은 각각 유지되며, 합계는 설치기관만 계산합니다.</p>
      </div>
    </details>
  );
}
