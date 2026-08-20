"use client";

import { useEffect, useMemo, useState } from "react";

export type JointProjectMemberListItem = {
  id: number;
  organization: string;
  businessRound: number;
  jointProjectRole?: "sponsor" | "site" | "";
  jointProjectMemberBudgetAmount?: number | null;
  jointProjectBudgetType?: string;
  budgetType?: string;
  budgetAmount?: number | string | null;
};

export default function JointProjectMemberList({
  members,
  matchingMembers,
  searchActive,
  showBudget = true,
  onSelectMember,
}: {
  members: JointProjectMemberListItem[];
  matchingMembers: JointProjectMemberListItem[];
  searchActive: boolean;
  showBudget?: boolean;
  onSelectMember?: (member: JointProjectMemberListItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const siteMembers = useMemo(
    () => members.filter((member) => member.jointProjectRole !== "sponsor"),
    [members],
  );
  const matchingIds = useMemo(
    () => new Set(matchingMembers.map((member) => member.id)),
    [matchingMembers],
  );
  const matchingSiteMembers = useMemo(
    () => siteMembers.filter((member) => matchingIds.has(member.id)),
    [matchingIds, siteMembers],
  );
  const otherSiteMembers = useMemo(
    () => siteMembers.filter((member) => !matchingIds.has(member.id)),
    [matchingIds, siteMembers],
  );
  const matchingKey = matchingSiteMembers.map((member) => member.id).join(":");

  useEffect(() => {
    if (!searchActive) {
      setOpen(false);
      return;
    }
    if (matchingSiteMembers.length > 0) setOpen(true);
  }, [matchingKey, matchingSiteMembers.length, searchActive]);

  const visibleMembers =
    searchActive && matchingSiteMembers.length > 0
      ? matchingSiteMembers
      : siteMembers;

  const renderMember = (
    member: JointProjectMemberListItem,
    matched: boolean,
  ) => {
    const amount =
      member.jointProjectMemberBudgetAmount === null ||
      member.jointProjectMemberBudgetAmount === undefined
        ? null
        : member.jointProjectMemberBudgetAmount;
    const budgetName =
      member.jointProjectBudgetType?.trim() ||
      member.budgetType?.trim() ||
      "예산명 미확인";
    return (
      <button
        type="button"
        className={matched ? "search-match" : ""}
        key={member.id}
        onClick={(event) => {
          event.stopPropagation();
          onSelectMember?.(member);
        }}
      >
        <b>{member.organization}</b>
        <small>
          기관 사업 {member.businessRound}차
          {showBudget
            ? ` · ${budgetName} · ${
                amount === null
                  ? "금액 미입력"
                  : `${amount.toLocaleString("ko-KR")}원`
              }`
            : ""}
        </small>
      </button>
    );
  };

  return (
    <details
      className="joint-project-member-list"
      open={open}
      onClick={(event) => event.stopPropagation()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {searchActive && matchingSiteMembers.length > 0
          ? `전체 ${siteMembers.length}곳 중 검색 일치 ${matchingSiteMembers.length}곳`
          : `설치기관 ${siteMembers.length}곳 펼쳐보기`}
      </summary>
      {visibleMembers.map((member) =>
        renderMember(member, matchingIds.has(member.id)),
      )}
      {searchActive && matchingSiteMembers.length > 0 && otherSiteMembers.length > 0 && (
        <details className="joint-project-other-member-list">
          <summary>다른 설치기관 {otherSiteMembers.length}곳 보기</summary>
          {otherSiteMembers.map((member) => renderMember(member, false))}
        </details>
      )}
    </details>
  );
}
