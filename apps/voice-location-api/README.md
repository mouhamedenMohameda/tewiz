# Voice-to-Location API

Convert a voice recording into a precise GPS location.

Built for Mauritanian ride-hailing apps (and sellable to similar apps in West Africa). Designed as a standalone microservice — single endpoint, API-key auth, per-client monthly quota and usage logs.

```
audio (FR / Hassaniya AR / AR / EN)
   │
   ▼
[ OpenAI Whisper ]   ─► transcript
   │
   ▼
[ Claude Haiku 4.5 ]  ─► structured address query
   │
   ▼
[ Google Geocoding ]  ─► { lat, lng, formatted_address, precision }
```

## Setup

1. Copy `.env.example` → `.env` and fill in the three keys:
   - `OPENAI_API_KEY` — https://platform.openai.com/api-keys
   - `ANTHROPIC_API_KEY` — https://console.anthropic.com/settings/keys
   - `GOOGLE_MAPS_API_KEY` — enable "Geocoding API" in Google Cloud Console
2. Run the migration (from monorepo root):
   ```bash
   pnpm db:migrate
   ```
3. Install + run:
   ```bash
   pnpm install
   pnpm --filter @tewiz/voice-location-api dev
   ```
4. Mint your first API key:
   ```bash
   pnpm --filter @tewiz/voice-location-api create-key "Tewiz rider app" --quota 100000
   ```
   The plaintext key is printed once — give it to the client and store it.

## Endpoint

### `POST /v1/voice-to-location`

**Headers**

| Header        | Required | Value                         |
|---------------|----------|-------------------------------|
| `X-API-Key`   | yes      | The key minted with the CLI   |
| `Content-Type`| yes      | `multipart/form-data`         |

**Body** — multipart form with a single field:

| Field   | Type | Notes                                              |
|---------|------|----------------------------------------------------|
| `audio` | file | mp3 / m4a / wav / ogg / webm / flac, up to 10 MB   |

**Response — 200 (success)**

```json
{
  "ok": true,
  "transcript": {
    "text": "Je suis près du marché capitale à Nouakchott",
    "language": "french"
  },
  "extracted": {
    "query": "Marché Capitale, Nouakchott, Mauritania",
    "place_name": "Marché Capitale",
    "locality": "Nouakchott",
    "landmark": null,
    "confidence": "high",
    "ambiguity_note": null
  },
  "location": {
    "lat": 18.0858,
    "lng": -15.9785,
    "address": "Marché Capitale, Nouakchott, Mauritania",
    "place_id": "ChIJ...",
    "types": ["point_of_interest", "establishment"],
    "precision": "high",
    "viewport_diagonal_m": 142
  },
  "confidence": "high"
}
```

**Response — 200 (no geocode match)** — Whisper + Claude worked but Google could not place the address.

```json
{
  "ok": false,
  "reason": "no_geocode_match",
  "transcript": { "text": "...", "language": "arabic" },
  "extracted": { "...": "..." },
  "location": null
}
```

**Errors**

| Status | `error`                  | When                                       |
|--------|--------------------------|--------------------------------------------|
| 400    | `audio_required`         | No file uploaded                           |
| 401    | `missing_api_key`        | No `X-API-Key` header                      |
| 401    | `invalid_api_key`        | Key not found or deactivated               |
| 415    | `unsupported_audio_format` | Mime type not in the accepted list       |
| 422    | `empty_transcript`       | Whisper returned nothing usable            |
| 429    | `quota_exceeded`         | Monthly quota reached                      |
| 500    | `internal_error`         | Upstream provider failure                  |

## Client examples

### curl
```bash
curl -X POST https://your-host/v1/voice-to-location \
  -H "X-API-Key: vl_live_xxx" \
  -F "audio=@./recording.m4a"
```

### Fetch (React Native / web)
```ts
const form = new FormData();
form.append('audio', { uri, name: 'voice.m4a', type: 'audio/m4a' } as any);
const r = await fetch('https://your-host/v1/voice-to-location', {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY },
  body: form,
});
const data = await r.json();
```

## Pricing model (suggested)

Per request cost ≈
- Whisper (~10 s audio): $0.001
- Claude Haiku (input + output): ~$0.0005
- Google Geocoding: $0.005

Total ≈ **$0.007 / request**. A retail price of $0.02–$0.03 / request gives a healthy margin while staying cheaper than asking a user to type an address they cannot spell.

## Operational notes

- The API is stateless; scale it horizontally behind a load balancer.
- All keys are stored as SHA-256 hashes. Plaintext is never persisted.
- Usage is logged per request in `voiceloc_usage_logs` — query that table for billing.
- The geocoder is biased to Mauritania via `region=mr` and `bounds` (Nouakchott).
  Change `GEOCODE_REGION`, `GEOCODE_BOUNDS`, `GEOCODE_LANGUAGE` to retarget.
