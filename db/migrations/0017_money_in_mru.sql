-- Convert all money columns from khoums to MRU.
--
-- Why:
--   The khoums-as-storage / MRU-as-input split was a constant source of bugs
--   (mobile multiplying by 5 on send, dividing by 5 on display, getting it
--   wrong once → captain wallet shows 1000 → "200 MRU"). Users only ever
--   think in MRU. Storing in khoums saved us nothing.
--
-- What changes:
--   - All *_khoums columns renamed to *_mru
--   - All existing values divided by 5 (ROUND to nearest integer to avoid
--     truncation drift, since BIGINT integer division would silently lose
--     1-4 khoums per row)
--   - The wallet drift trigger rewritten against the new column names
--
-- Safety:
--   - Wrapped in a single transaction; all-or-nothing
--   - The trigger is dropped BEFORE the column rename so it doesn't fire on
--     the conversion UPDATE
--   - Recreated AFTER the rename so it watches the new column

BEGIN;

-- 1. Drop the audit trigger that watches balance_khoums. It would fire on
--    every row we convert and trip the drift check (because we're updating
--    wallets and wallet_transactions in different statements).
DROP TRIGGER IF EXISTS trg_wallet_balance_consistency ON wallets;

-- 2. Rename and convert each column.

ALTER TABLE wallets
  RENAME COLUMN balance_khoums TO balance_mru;
UPDATE wallets
   SET balance_mru = ROUND(balance_mru::numeric / 5);

ALTER TABLE wallet_transactions
  RENAME COLUMN amount_khoums TO amount_mru;
UPDATE wallet_transactions
   SET amount_mru     = ROUND(amount_mru::numeric / 5),
       balance_after  = ROUND(balance_after::numeric / 5);

ALTER TABLE topup_requests
  RENAME COLUMN claimed_amount_khoums TO claimed_amount_mru;
ALTER TABLE topup_requests
  RENAME COLUMN approved_amount_khoums TO approved_amount_mru;
UPDATE topup_requests
   SET claimed_amount_mru  = ROUND(claimed_amount_mru::numeric / 5),
       approved_amount_mru = CASE
         WHEN approved_amount_mru IS NULL THEN NULL
         ELSE ROUND(approved_amount_mru::numeric / 5)
       END;

ALTER TABLE rides
  RENAME COLUMN fare_estimate_khoums TO fare_estimate_mru;
ALTER TABLE rides
  RENAME COLUMN fare_final_khoums TO fare_final_mru;
ALTER TABLE rides
  RENAME COLUMN commission_khoums TO commission_mru;
UPDATE rides
   SET fare_estimate_mru = CASE WHEN fare_estimate_mru IS NULL THEN NULL
                                ELSE ROUND(fare_estimate_mru::numeric / 5) END,
       fare_final_mru    = CASE WHEN fare_final_mru    IS NULL THEN NULL
                                ELSE ROUND(fare_final_mru::numeric / 5) END,
       commission_mru    = CASE WHEN commission_mru    IS NULL THEN NULL
                                ELSE ROUND(commission_mru::numeric / 5) END;

ALTER TABLE recurring_rides
  RENAME COLUMN locked_fare_khoums TO locked_fare_mru;
UPDATE recurring_rides
   SET locked_fare_mru = ROUND(locked_fare_mru::numeric / 5);

-- 3. Recreate the wallet drift trigger against the renamed columns.
CREATE OR REPLACE FUNCTION assert_wallet_balance_consistency()
RETURNS trigger AS $$
DECLARE
  ledger_balance BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_mru), 0) INTO ledger_balance
  FROM wallet_transactions
  WHERE captain_id = NEW.captain_id;

  IF ledger_balance <> NEW.balance_mru THEN
    RAISE EXCEPTION 'Wallet drift detected for captain %: wallet=% ledger=%',
      NEW.captain_id, NEW.balance_mru, ledger_balance;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_balance_consistency
  AFTER UPDATE OF balance_mru ON wallets
  FOR EACH ROW EXECUTE FUNCTION assert_wallet_balance_consistency();

COMMIT;
