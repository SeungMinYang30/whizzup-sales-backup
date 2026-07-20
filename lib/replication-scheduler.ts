import { getD1 } from "../db";

const JOB_NAME = "whizzup-standby-sync-every-5-minutes";
const VAULT_SECRET_NAME = "whizzup_standby_sync_secret";
const CRON_EXPRESSION = "*/5 * * * *";

type VaultSecretRow = {
  id: string;
};

type CronJobRow = {
  jobid: number;
};

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
    .prepare("SELECT jobid FROM cron.job WHERE jobname = ?")
    .bind(JOB_NAME)
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
    .prepare("SELECT jobid FROM cron.job WHERE jobname = ?")
    .bind(JOB_NAME)
    .all<CronJobRow>();
  for (const job of existingJobs.results) {
    await d1.prepare("SELECT cron.unschedule(?::bigint)").bind(job.jobid).run();
  }
  return {
    jobName: JOB_NAME,
    removed: existingJobs.results.length,
  };
}
