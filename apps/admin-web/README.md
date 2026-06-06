# Tewiz Admin Web

Next.js web dashboard for admins.

## Scaffold later

```bash
cd apps
pnpm create next-app@latest admin-web --typescript --tailwind --app --src-dir
```

## Screens to build (priority order)

1. **Login** — phone+OTP (same flow as apps; admin role)
2. **KYC queue** — pending captain applications, side-by-side document review
3. **Top-up queue** — pending wallet top-ups with screenshot view
4. **Captains** — list, filter, suspend, audit log per captain
5. **Live map** — all active captains + ongoing rides
6. **Rides** — search/filter, detail with GPS trace + fare breakdown
7. **Road reports** — see + remove abusive reports
8. **Disputes** — wallet adjustments, refunds (with reason)
9. **Settings** — commission rate, surge, service zones
10. **Reports** — daily reconciliation: top-ups in vs. captain balance changes vs. commission revenue

## Tech choices

- Next.js 15 (App Router)
- Tailwind CSS
- shadcn/ui for components
- TanStack Query for data fetching
- Mapbox GL JS for maps
- Recharts for KPI charts
