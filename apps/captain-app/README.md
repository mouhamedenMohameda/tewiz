# Tewiz Captain App

React Native (Expo) app for drivers ("captains" in Tewiz terminology).

## Scaffold later

When ready:

```bash
cd apps
pnpm create expo-app captain-app --template blank-typescript
```

Then add to root `pnpm-workspace.yaml` (already done — `apps/*`).

## Screens to build (priority order)

1. **Auth** — phone entry → OTP code → onboarding
2. **Registration (KYC)** — multi-step form with photo upload
   - Personal info (name, NNI, DOB, address)
   - Driver license (front/back)
   - National ID — NNI (front/back)
   - Vehicle docs: carte grise, assurance, vignette, visite technique
   - Vehicle photos (front/back/sides/interior)
   - Vehicle details
   - Submit → waiting screen
3. **Home (post-approval)** — online toggle, current ride, balance, earnings today
4. **Going-home mode** — toggle + visual indicator
5. **Wallet** — balance, top-up screenshot upload, transaction history
6. **Profile** — vehicle, documents (with expiry warnings), settings
7. **Ride screen** — incoming request → accept → navigate → arrived → in-progress → complete

## Tech choices

- Expo SDK 52+
- React Native Maps (Mapbox via `@rnmapbox/maps`)
- Expo Camera + Expo ImageManipulator for compression
- Expo SecureStore for token storage
- Expo Notifications for push
- React Query for server state
- Zustand for local state
