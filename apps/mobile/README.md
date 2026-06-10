# Tewiz Mobile App

React Native (Expo) app for Tewiz — single app for **riders** and **captains**.

Every user signs up as a rider. A rider can submit a captain application
("Devenir chauffeur"); once approved, the user gets a second profile and
can toggle between **rider mode** (request rides) and **captain mode**
(accept rides) at any time.

## Run

```bash
# from repo root
pnpm install
pnpm --filter @tewiz/mobile start

# point the app at a non-default API
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000 pnpm --filter @tewiz/mobile start
```

The API URL defaults to `http://localhost:3000` (works for the iOS simulator
and Expo web). For a physical device on the same Wi-Fi, set
`EXPO_PUBLIC_API_URL` to your LAN IP.

## Flow

1. **Auth** — phone entry → OTP code. New users get `role: 'rider'`.
2. **Rider home** — request a ride, history, favorites, "Devenir chauffeur" CTA.
3. **Become captain (KYC)** — opt-in flow: personal info → vehicle → 14
   document photos → submit. Admin approves/rejects per document. On
   approval, the user's role flips to `captain` and the mode toggle appears.
4. **Captain mode** — online toggle (`/captain/state/online|offline`),
   wallet balance, going-home mode, current ride, heatmap.
5. **Wallet** (captain mode) — balance, top-up screenshot upload, history.
6. **Ride** (captain mode) — accept → arrived → start (4-digit code) → complete.

## Tech

- Expo SDK 52 + Expo Router (typed routes)
- AsyncStorage for token + activeMode persistence, Zustand for auth state
- axios with auto-refresh interceptor
- expo-location for GPS, expo-image-picker for KYC photos
- react-native-maps for the map view
