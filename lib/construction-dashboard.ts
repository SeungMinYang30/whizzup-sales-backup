export type ConstructionDashboardCounts = {
  planned: number;
  active: number;
  completed: number;
};

type ConstructionDashboardProject = {
  organization: string;
  businessRound: number;
  completed: boolean;
  hidden: boolean;
};

type ConstructionDashboardSchedule = {
  organization: string;
  businessRound: number;
  scheduledDate: string;
  completed: boolean;
};

const scopeKey = (organization: string, businessRound: number) =>
  `${organization}\u001f${businessRound}`;

export function constructionDashboardLocalDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function calculateConstructionDashboardCounts(
  projects: ConstructionDashboardProject[],
  schedules: ConstructionDashboardSchedule[],
  today = constructionDashboardLocalDate(),
): ConstructionDashboardCounts {
  const schedulesByProject = new Map<string, ConstructionDashboardSchedule[]>();
  schedules.forEach((schedule) => {
    const key = scopeKey(schedule.organization, schedule.businessRound);
    schedulesByProject.set(key, [
      ...(schedulesByProject.get(key) ?? []),
      schedule,
    ]);
  });

  return projects.filter((project) => !project.hidden).reduce(
    (counts, project) => {
      if (project.completed) {
        counts.completed += 1;
        return counts;
      }
      const hasStarted = (
        schedulesByProject.get(
          scopeKey(project.organization, project.businessRound),
        ) ?? []
      ).some(
        (schedule) =>
          !schedule.completed &&
          Boolean(schedule.scheduledDate) &&
          schedule.scheduledDate <= today,
      );
      counts[hasStarted ? "active" : "planned"] += 1;
      return counts;
    },
    { planned: 0, active: 0, completed: 0 },
  );
}
