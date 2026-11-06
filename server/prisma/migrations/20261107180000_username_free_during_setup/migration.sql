-- Choosing a username while setting up an account is free. The 30-day rule starts once setup is finished.
CREATE OR REPLACE FUNCTION "enforce_username_cooldown"() RETURNS trigger AS $$
BEGIN
  IF NEW."username" IS DISTINCT FROM OLD."username" THEN
    IF NEW."deletedAt" IS NULL AND OLD."onboarded" THEN
      IF OLD."usernameChangedAt" IS NOT NULL AND OLD."usernameChangedAt" > now() - interval '30 days' THEN
        RAISE EXCEPTION 'username_cooldown: a username can only change once every 30 days' USING ERRCODE = 'check_violation';
      END IF;
      NEW."usernameChangedAt" := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
