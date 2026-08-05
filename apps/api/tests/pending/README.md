# The red list — specs for features that do not exist yet

These are **executable specifications**, not tests of current behaviour. Every
one of them fails today. Each failure is a feature to build.

```bash
pnpm --filter @tewiz/mobile test:pending
```

They are excluded from `pnpm test` and from CI on purpose: a permanently red
pipeline stops being a signal within a week, and the green tests are what
protect you *while* you build these.

## Workflow

1. Run `test:pending`. Pick a failing spec.
2. Implement until it goes green.
3. **Move the file** into `tests/features/`, rename `.spec.ts` → `.test.ts`.
   It has stopped being a to-do and become a regression test.
4. Delete its row from the table below.

Step 3 is the important one. A spec left here after it passes is invisible —
nothing runs it in CI, so the feature can regress silently.

## What is left

| Spec | Feature | What must become true |
|---|---|---|
| `apps/mobile/tests/pending/16-locale-completeness.spec.ts` | #16 | hs / ff / snk / wo reach 100 % |

Nine API specs and one mobile spec were on this list and have been implemented;
they now live in `tests/features/`.

## Why #16 is still here

It is the one item on the list that is not an engineering task. Finishing it
means writing roughly 590 strings each in Hassaniya, Pulaar, Soninké and Wolof —
about 2 400 pieces of user-facing copy in languages that need a native speaker
to get right. Machine-generating them would fill the files, turn this spec
green, and ship confidently-worded nonsense to real users, which is worse than
the honest French fallback they see today.

The tooling is ready for whoever does the work: `pnpm --filter @tewiz/api
export:translations` and `seed:translations` exist, and the admin has a
translations screen. The spec's failure output lists the missing keys grouped by
section, so it can be handed out in coherent chunks rather than as 590 loose
strings.

Priority order, if it has to be done in stages: the spec's last block checks the
core ride flow (`rider.current`, `rider.newRide`, `captain.rides`, `common`)
separately — those are the screens a user cannot avoid, and they are worth
finishing first.

## A note on the small strings already added

Implementing features 5 and 6 added a handful of new UI labels ("Naviguer vers
le client", "Votre Captain est à {{distance}}") across all seven locales. The
French, Arabic and English are sound. **The Hassaniya, Pulaar, Soninké and Wolof
versions of those specific keys were written without a native speaker and should
be reviewed** — they are short and low-risk, but they are not verified.
