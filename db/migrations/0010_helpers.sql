-- Helper triggers and constraints.

-- Auto-update updated_at on row UPDATE for tables that have it.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_captain_applications_touch
  BEFORE UPDATE ON captain_applications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_recurring_rides_touch
  BEFORE UPDATE ON recurring_rides
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Update wallet balance from a transaction insert.
-- Application code is expected to:
--   BEGIN;
--   SELECT balance_khoums FROM wallets WHERE captain_id = $1 FOR UPDATE;
--   <compute new balance>
--   INSERT INTO wallet_transactions(..., balance_after = new_balance);
--   UPDATE wallets SET balance_khoums = new_balance WHERE captain_id = $1;
--   COMMIT;
-- This trigger is a SAFETY NET that detects ledger/wallet drift, not the
-- primary updater.
CREATE OR REPLACE FUNCTION assert_wallet_balance_consistency()
RETURNS trigger AS $$
DECLARE
  ledger_balance BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_khoums), 0) INTO ledger_balance
  FROM wallet_transactions
  WHERE captain_id = NEW.captain_id;

  IF ledger_balance <> NEW.balance_khoums THEN
    RAISE EXCEPTION 'Wallet drift detected for captain %: wallet=% ledger=%',
      NEW.captain_id, NEW.balance_khoums, ledger_balance;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_balance_consistency
  AFTER UPDATE OF balance_khoums ON wallets
  FOR EACH ROW EXECUTE FUNCTION assert_wallet_balance_consistency();
