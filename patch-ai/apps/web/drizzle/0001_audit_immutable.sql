-- The audit log is append-only: it is evidence of who authorized and ran each scan.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint
-- Attestations are likewise immutable once signed.
CREATE TRIGGER attestations_no_update
  BEFORE UPDATE ON attestations
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint
INSERT INTO system_settings (key, value) VALUES ('scans_paused', 'false'::jsonb)
  ON CONFLICT (key) DO NOTHING;
