# Tewiz Rider App

React Native (Expo) app for passengers booking rides.

## Scaffold later

```bash
cd apps
pnpm create expo-app rider-app --template blank-typescript
```

## Screens to build (priority order)

1. **Auth** — phone → OTP → optional full name
2. **Home / Map** — pickup + dropoff selection, fare estimate
3. **Ride type toggle** — Personne | Colis
4. **Booking for someone else** — toggle "C'est pour quelqu'un d'autre", enter name + phone
5. **Searching captain** — loading state with cancel
6. **Live ride** — captain location, ETA, contact captain, share trip link
7. **Mes chauffeurs** — favorite captains list
8. **Course récurrente** — set up a recurring schedule
9. **Course honnête** — post-ride trace + fare breakdown
10. **Wallet (later)** — used only for "course pour quelqu'un d'autre" pre-payment
11. **History + ratings**
12. **Profile + saved addresses**

## Tech choices

Same as captain-app.
