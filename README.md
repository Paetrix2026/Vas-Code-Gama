# Voice Ride App — AI Voice-Based Ride Booking System

A production-ready, mobile-first web application for visually impaired users to book rides using voice commands.

## Features

- **Full voice flow**: Tap → Detect location → Speak destination → Confirm → Book ride
- **Web Speech API** for speech recognition (STT) + speech synthesis (TTS)
- **Sarvam AI fallback** for STT in noisy environments
- **Mistral AI** for cleaning/extracting destination from speech
- **Leaflet + OpenStreetMap** for real-time map with dark theme
- **WebSocket** real-time communication between rider and driver
- **Wallet simulation** with ₹500 default balance
- **Haptic feedback** on key interactions
- **ARIA live regions** and high-contrast UI for accessibility
- **Offline detection** with cached location fallback

## Architecture

```
/public
  rider.html          ← Rider interface (voice-first)
  driver.html         ← Driver dashboard (accept/reject)
  /css
    rider.css         ← Dark tactile aesthetic
    driver.css        ← Clean dark card UI
  /js
    voice.js          ← STT + TTS abstraction
    map.js            ← Leaflet map module
    socket.js         ← WebSocket client
    wallet.js         ← Balance simulation
    rider.js          ← Voice flow orchestrator
    driver.js         ← Driver dashboard logic
server.js             ← Express + WebSocket server
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
- `MISTRAL_API_KEY` — Get from [Mistral AI](https://console.mistral.ai/)
- `SARVAM_API_KEY` — Get from [Sarvam AI](https://www.sarvam.ai/)

> **Note**: The app works without API keys! It falls back to raw speech transcript (no AI cleaning) and Web Speech API only (no Sarvam fallback).

### 3. Start the server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### 4. Open in browser

- **Rider**: [http://localhost:3000/rider.html](http://localhost:3000/rider.html)
- **Driver**: [http://localhost:3000/driver.html](http://localhost:3000/driver.html)

## Demo Flow

1. Open **rider.html** on your phone (or desktop with mic)
2. Allow location access when prompted
3. **Tap anywhere** on the screen
4. The app speaks your current location and asks for a destination
5. **Say your destination** (e.g., "Mangalore Airport")
6. The app confirms and asks you to say YES or NO
7. Say **YES** to confirm
8. Open **driver.html** in another tab
9. Click **ACCEPT** on the ride request card
10. The rider receives voice confirmation with fare and driver info
11. Watch the driver marker move toward your location on the map

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Express |
| Real-time | WebSocket (ws) |
| Maps | Leaflet + OpenStreetMap |
| STT | Web Speech API + Sarvam AI |
| TTS | SpeechSynthesis API |
| AI | Mistral AI (mistral-small) |
| Geocoding | Nominatim (OSM) |
| Styling | Custom CSS (Syne + IBM Plex Mono) |

## Accessibility

- All status text uses `aria-live="assertive"`
- Critical voice output spoken **twice** with 500ms pause
- Haptic feedback on tap, confirmation, and driver acceptance
- Minimum 24px body text, 48px headings
- WCAG AAA color contrast (7:1+)
- Full offline detection with cached location
