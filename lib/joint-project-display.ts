export type JointProjectDisplaySource = {
  id: number;
  organization: string;
  jointProjectId?: number | null;
  jointProjectName?: string;
  jointProjectSponsor?: string;
  jointProjectRole?: "sponsor" | "site" | "";
};

export type JointProjectDisplayGroup<T extends JointProjectDisplaySource> = {
  key: string;
  projectId: number | null;
  sponsorOrganization: string;
  projectName: string;
  primary: T;
  members: T[];
};

export function groupJointProjectRows<T extends JointProjectDisplaySource>(
  rows: T[],
): JointProjectDisplayGroup<T>[] {
  const groups = new Map<string, JointProjectDisplayGroup<T>>();
  const order: string[] = [];

  rows.forEach((row) => {
    const projectId = Number(row.jointProjectId) || null;
    const key = projectId ? `joint:${projectId}` : `row:${row.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        projectId,
        sponsorOrganization:
          row.jointProjectSponsor?.trim() || row.organization,
        projectName: row.jointProjectName?.trim() || "",
        primary: row,
        members: [],
      };
      groups.set(key, group);
      order.push(key);
    }
    group.members.push(row);
    if (row.jointProjectRole === "sponsor") {
      group.primary = row;
      group.sponsorOrganization = row.organization;
    } else if (row.jointProjectSponsor?.trim()) {
      group.sponsorOrganization = row.jointProjectSponsor.trim();
    }
  });

  return order.map((key) => {
    const group = groups.get(key)!;
    group.members.sort(
      (left, right) =>
        (left.jointProjectRole === "sponsor" ? 0 : 1) -
          (right.jointProjectRole === "sponsor" ? 0 : 1) ||
        left.organization.localeCompare(right.organization, "ko-KR"),
    );
    return group;
  });
}

export function jointProjectGroupMemberIds<T extends JointProjectDisplaySource>(
  groups: JointProjectDisplayGroup<T>[],
) {
  return groups.flatMap((group) => group.members.map((member) => member.id));
}
