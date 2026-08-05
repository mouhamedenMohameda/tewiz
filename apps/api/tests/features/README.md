# Feature coverage suite

Regression tests for the 18 features the product cannot ship without. Everything
here is **green** and must stay green.

| # | Feature | Files |
|---|---|---|
| 1 | Commander une course | `01-book-ride` |
| 2 | Le captain reçoit la course | `02-captain-receives-ride`, `02-push-is-retried` |
| 3 | Accepter (premier arrivé) | `03-accept-first-wins` |
| 4 | Le rider sait qu'un captain a accepté | `04-rider-notified-on-accept` |
| 5 | Voir où est mon chauffeur | `05-captain-live-position`, `05-rider-sees-captain-position` |
| 6 | Le captain trouve le ramassage | `apps/mobile/tests/feature-06-captain-navigation` |
| 7 | Le rider sait que le captain est arrivé | `07-rider-arrival-notification`, `07-rider-notified-on-arrival` |
| 8 | Terminer la course + tarif final | `08-complete-ride-fare` |
| 9 | Commission prélevée | `09-commission-debit` |
| 10 | Recharger le wallet | `10-wallet-topup` |
| 11 | Le captain annule | `11-captain-cancel`, `11-captain-cancellation-has-consequences` |
| 12 | Personne n'accepte | `12-ride-expiry`, `12-rider-notified-when-no-captain` |
| 13 | Rester en ligne / position fraîche | `13-online-presence` |
| 14 | KYC captain | `14-kyc-submission` |
| 15 | Noter le chauffeur | `15-rating`, `15-captain-rates-rider` |
| 16 | Utiliser l'app dans sa langue | `apps/mobile/tests/feature-16-i18n-coverage` ⚠️ ratchet only |
| 17 | Tenir la charge | `17-crons-take-a-distributed-lock`, `apps/mobile/tests/feature-17-polling-budget` |
| 18 | Limiter les abus rider | `18-rider-active-ride-limit` |

Where a feature has two files, the first pins the mechanism that already worked
and the second pins the guarantee added on top of it. They are kept apart so a
change to one cannot quietly loosen the other.

**Feature 16 is the only one not finished.** Four locales ship around 56 %
translated; the target is still a red spec in
[`../pending/`](../pending/README.md). Everything else on the list is done.

## Conventions

`_fixtures.ts` provides `rideRow()`, `pricingSettings()` and `fakeClient()`.
`fakeClient` records every statement issued, so a test can assert what was
*never* queried — not only what a payload contained.

`_harness.ts` provides `capturePush()`, which stubs `fetch` and asserts that a
push reached a given token. Push tests deliberately do NOT mock the push module:
they mock the database (token lookups) and the network, then assert the outcome.
That keeps them agnostic to how the notification is produced — rename the
function, move it, batch it, and the tests still hold.
