-- À exécuter après avoir activé les extensions pg_cron, pg_net et Supabase Vault.
-- Créez d'abord dans Database > Vault ces deux secrets :
--   nom = moov_supabase_url ; valeur = https://VOTRE_PROJECT_REF.supabase.co
--   nom = moov_cron_secret ; valeur = EXACTEMENT le même secret que MOOV_CRON_SECRET
-- N'inscrivez pas la valeur du secret dans ce fichier ou dans GitHub.

select cron.schedule(
  'moov-daily-reminders',
  '0 8 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'moov_supabase_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'moov_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- Vérification du job planifié :
-- select jobid, jobname, schedule, active from cron.job where jobname = 'moov-daily-reminders';
