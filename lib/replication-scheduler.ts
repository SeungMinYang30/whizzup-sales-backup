import { getD1 } from "../db";

const JOB_NAME = "whizzup-standby-sync-daily-0430-kst";
const LEGACY_JOB_NAME = "whizzup-standby-sync-every-10-minutes";
const VAULT_SECRET_NAME = "whizzup_standby_sync_secret";
// Supabase pg_cron uses UTC. 19:30 UTC is 04:30 KST on the next calendar day.
const CRON_EXPRESSION = "30 19 * * *";

type VaultSecretRow = {
  id: string;
};

type CronJobRow = {
  jobid: number;
};

export async function getStandbyScheduleStatus() {
  try {
    const jobs = await getD1()
      .prepare(
        `SELECT jobid
         FROM cron.job
         WHERE jobname IN (?, ?)
         ORDER BY jobid DESC`,
      )
      .bind(JOB_NAME, LEGACY_JOB_NAME)
      .all<CronJobRow>();
    return {
      configured: jobs.results.length > 0,
      jobIds: jobs.results.map((job) => job.jobid),
      jobName: JOB_NAME,
      schedule: CRON_EXPRESSION,
    };
  } catch {
    return {
      configured: false,
      jobIds: [] as number[],
      jobName: JOB_NAME,
      schedule: CRON_EXPRESSION,
    };
  }
}

export async function configureStandbySchedule(input: {
  syncUrl: string;
  syncSecret: string;
}) {
  const d1 = getD1();

  await d1
    .prepare("CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog")
    .run();
  await d1
    .prepare("CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions")
    .run();

  const existingSecret = await d1
    .prepare("SELECT id::text AS id FROM vault.secrets WHERE name = ? LIMIT 1")
    .bind(VAULT_SECRET_NAME)
    .first<VaultSecretRow>();
  if (existingSecret) {
    await d1
      .prepare("SELECT vault.update_secret(?::uuid, ?, ?, ?)")
      .bind(
        existingSecret.id,
        input.syncSecret,
        VAULT_SECRET_NAME,
        "WHIZZUP standby sync bearer token",
      )
      .run();
  } else {
    await d1
      .prepare("SELECT vault.create_secret(?, ?, ?)")
      .bind(
        input.syncSecret,
        VAULT_SECRET_NAME,
        "WHIZZUP standby sync bearer token",
      )
      .run();
  }

  const existingJobs = await d1
    .prepare("SELECT jobid FROM cron.job WHERE jobname IN (?, ?)")
    .bind(JOB_NAME, LEGACY_JOB_NAME)
    .all<CronJobRow>();
  for (const job of existingJobs.results) {
    await d1.prepare("SELECT cron.unschedule(?::bigint)").bind(job.jobid).run();
  }

  const command = `
    SELECT net.http_post(
      url := '${input.syncUrl.replaceAll("'", "''")}',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = '${VAULT_SECRET_NAME}'
          ORDER BY created_at DESC
          LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  `;
  const scheduled = await d1
    .prepare("SELECT cron.schedule(?, ?, ?) AS jobid")
    .bind(JOB_NAME, CRON_EXPRESSION, command)
    .first<CronJobRow>();

  return {
    jobName: JOB_NAME,
    jobId: scheduled?.jobid ?? null,
    schedule: CRON_EXPRESSION,
    syncUrl: input.syncUrl,
  };
}

export async function removeStandbySchedule() {
  const d1 = getD1();
  const existingJobs = await d1
    .prepare("SELECT jobid FROM cron.job WHERE jobname IN (?, ?)")
    .bind(JOB_NAME, LEGACY_JOB_NAME)
    .all<CronJobRow>();
  for (const job of existingJobs.results) {
    await d1.prepare("SELECT cron.unschedule(?::bigint)").bind(job.jobid).run();
  }
  return {
    jobName: JOB_NAME,
    removed: existingJobs.results.length,
  };
}
