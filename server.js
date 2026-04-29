// ============================================================
// Voice Ride App — Express + WebSocket Server
// ============================================================

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// HTTPS server for mobile (geolocation/mic require secure context)
let httpsServer = null;
const certDir = join(__dirname, 'cert');
if (existsSync(join(certDir, 'key.pem')) && existsSync(join(certDir, 'cert.pem'))) {
  httpsServer = createHttpsServer({
    key: readFileSync(join(certDir, 'key.pem')),
    cert: readFileSync(join(certDir, 'cert.pem')),
  }, app);
  console.log('[HTTPS] Certificates loaded from ./cert/');
}

// WebSocket on both HTTP and HTTPS
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
if (httpsServer) {
  httpsServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Multer for handling audio file uploads from client
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── In-memory state ──────────────────────────────────────────

let drivers = [];
let activeRide = null;
let riderWs = null;
let driverWs = null;

function initDrivers(pickupLat, pickupLon) {
  drivers = [
    { id: 1, name: 'Ravi Kumar',   lat: pickupLat + 0.008,  lon: pickupLon + 0.005, available: true },
    { id: 2, name: 'Suresh Nair',  lat: pickupLat - 0.012,  lon: pickupLon + 0.003, available: true },
    { id: 3, name: 'Anjali Singh', lat: pickupLat + 0.003,  lon: pickupLon - 0.007, available: true },
  ];
}

// ── Haversine distance (km) ──────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── REST endpoints ───────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/api/end-ride', (_req, res) => {
  if (activeRide && activeRide.driverId) {
    const driver = drivers.find((d) => d.id === activeRide.driverId);
    if (driver) driver.available = true;
  }
  activeRide = null;
  broadcast({ type: 'RIDE_ENDED' });
  res.json({ status: 'ride_ended' });
});

// Proxy endpoint for Mistral AI (keeps API key server-side)
app.post('/api/process-speech', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'your_mistral_api_key_here') {
    // Fallback: just clean up the transcript manually
    const cleaned = transcript.trim().replace(/^(go to|take me to|i want to go to|drive me to|navigate to)\s*/i, '');
    return res.json({ destination: cleaned || transcript.trim() });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content:
              'You are a ride booking assistant in India. Extract ONLY the destination location name from the user\'s speech. Fix common spelling mistakes for Indian places (e.g. "mangalor" → "Mangalore", "bangalor" → "Bangalore", "derlakate" → "Deralakatte"). Remove filler words like "go to", "take me to", "I want to go". Return ONLY the corrected place name. No punctuation, no quotes, no explanation.',
          },
          { role: 'user', content: transcript },
        ],
        max_tokens: 60,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();
    console.log('[Mistral] Response:', data.choices?.[0]?.message?.content);
    const destination = data.choices?.[0]?.message?.content?.trim() || transcript.trim();
    res.json({ destination });
  } catch (err) {
    console.error('[Mistral] Error:', err.message);
    // Fallback: clean up manually
    const cleaned = transcript.trim().replace(/^(go to|take me to|i want to go to|drive me to|navigate to)\s*/i, '');
    res.json({ destination: cleaned || transcript.trim() });
  }
});

// Proxy endpoint for Sarvam STT (proper multipart/form-data forwarding)
app.post('/api/sarvam-stt', upload.single('file'), async (req, res) => {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === 'your_sarvam_api_key_here') {
    return res.status(503).json({ error: 'Sarvam API key not configured' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    // Reconstruct FormData with the uploaded file buffer
    const formData = new FormData();
    const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    formData.append('file', audioBlob, req.file.originalname || 'audio.webm');
    formData.append('model', 'saaras:v3');
    formData.append('language_code', req.body.language_code || 'en-IN');

    console.log('[Sarvam STT] Sending audio:', req.file.size, 'bytes, mime:', req.file.mimetype);

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Sarvam STT] API error:', response.status, errText);
      return res.status(response.status).json({ error: 'Sarvam STT failed', detail: errText });
    }

    const data = await response.json();
    console.log('[Sarvam STT] Result:', data.transcript || data);
    res.json(data);
  } catch (err) {
    console.error('[Sarvam STT] Error:', err.message);
    res.status(500).json({ error: 'Sarvam STT failed' });
  }
});

// Proxy endpoint for Sarvam TTS (high-quality Indian English voice)
app.post('/api/sarvam-tts', async (req, res) => {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === 'your_sarvam_api_key_here') {
    return res.status(503).json({ error: 'Sarvam API key not configured' });
  }

  const { text, language } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.substring(0, 2400), // bulbul:v3 limit is 2500 chars
        target_language_code: language || 'en-IN',
        speaker: 'priya',
        model: 'bulbul:v3',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Sarvam TTS] API error:', response.status, errText);
      return res.status(response.status).json({ error: 'Sarvam TTS failed', detail: errText });
    }

    const data = await response.json();
    // data.audios[0] contains base64-encoded audio
    console.log('[Sarvam TTS] Generated audio for:', text.substring(0, 50) + '...');
    res.json(data);
  } catch (err) {
    console.error('[Sarvam TTS] Error:', err.message);
    res.status(500).json({ error: 'Sarvam TTS failed' });
  }
});

// ── WebSocket handling ───────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected. Total:', wss.clients.size);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    console.log('[WS] Received:', msg.type);

    switch (msg.type) {
      case 'REGISTER_RIDER':
        riderWs = ws;
        break;

      case 'REGISTER_DRIVER':
        driverWs = ws;
        // If there's a pending ride, send it to the newly connected driver
        if (activeRide && activeRide.status === 'waiting') {
          ws.send(JSON.stringify({
            type: 'RIDE_REQUEST',
            pickup: activeRide.pickup,
            destination: activeRide.destination,
            distance_km: activeRide.distance_km,
            fare: activeRide.fare,
          }));
        }
        break;

      case 'FIND_DRIVER': {
        const { pickup, destination, distance_km } = msg;
        initDrivers(pickup.lat, pickup.lon);

        // Calculate fare
        const fare = Math.round(30 + distance_km * 12);

        // Find nearest available driver within 2km
        const available = drivers
          .filter((d) => d.available)
          .map((d) => ({
            ...d,
            dist: haversine(pickup.lat, pickup.lon, d.lat, d.lon),
          }))
          .filter((d) => d.dist <= 2)
          .sort((a, b) => a.dist - b.dist);

        if (available.length === 0) {
          ws.send(JSON.stringify({ type: 'NO_DRIVER_AVAILABLE' }));
          return;
        }

        const nearest = available[0];

        activeRide = {
          pickup,
          destination,
          distance_km,
          fare,
          driverId: nearest.id,
          driverName: nearest.name,
          driverLat: nearest.lat,
          driverLon: nearest.lon,
          status: 'waiting',
        };

        // Broadcast ride request to driver page(s)
        broadcast({
          type: 'RIDE_REQUEST',
          pickup,
          destination,
          distance_km,
          fare,
          driverName: nearest.name,
        });

        // Also tell rider we found a driver and are waiting for acceptance
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify({
            type: 'DRIVER_FOUND',
            driverName: nearest.name,
            driverLocation: { lat: nearest.lat, lon: nearest.lon },
            estimatedMinutes: Math.max(2, Math.round(nearest.dist / 0.5)),
            fare,
          }));
        }
        break;
      }

      case 'DRIVER_ACCEPTED': {
        if (!activeRide) return;
        activeRide.status = 'accepted';
        const driver = drivers.find((d) => d.id === activeRide.driverId);
        if (driver) driver.available = false;

        // Notify rider
        if (riderWs && riderWs.readyState === WebSocket.OPEN) {
          riderWs.send(JSON.stringify({
            type: 'DRIVER_ACCEPTED',
            driverName: activeRide.driverName,
            driverLocation: { lat: activeRide.driverLat, lon: activeRide.driverLon },
            fare: activeRide.fare,
            estimatedMinutes: Math.max(2, Math.round(
              haversine(activeRide.driverLat, activeRide.driverLon, activeRide.pickup.lat, activeRide.pickup.lon) / 0.5
            )),
          }));
        }

        // Start simulating driver movement toward pickup
        simulateDriverMovement();
        break;
      }

      case 'DRIVER_REJECTED': {
        if (!activeRide) return;
        // Try next available driver
        const currentDriverId = activeRide.driverId;
        const pickup = activeRide.pickup;

        const nextAvailable = drivers
          .filter((d) => d.available && d.id !== currentDriverId)
          .map((d) => ({
            ...d,
            dist: haversine(pickup.lat, pickup.lon, d.lat, d.lon),
          }))
          .filter((d) => d.dist <= 2)
          .sort((a, b) => a.dist - b.dist);

        if (nextAvailable.length === 0) {
          activeRide = null;
          broadcast({ type: 'NO_DRIVER_AVAILABLE' });
          return;
        }

        const next = nextAvailable[0];
        activeRide.driverId = next.id;
        activeRide.driverName = next.name;
        activeRide.driverLat = next.lat;
        activeRide.driverLon = next.lon;

        broadcast({
          type: 'RIDE_REQUEST',
          pickup: activeRide.pickup,
          destination: activeRide.destination,
          distance_km: activeRide.distance_km,
          fare: activeRide.fare,
          driverName: next.name,
        });
        break;
      }

      case 'END_RIDE': {
        if (activeRide && activeRide.driverId) {
          const driver = drivers.find((d) => d.id === activeRide.driverId);
          if (driver) driver.available = true;
        }
        activeRide = null;
        broadcast({ type: 'RIDE_ENDED' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws === riderWs) riderWs = null;
    if (ws === driverWs) driverWs = null;
    console.log('[WS] Client disconnected. Total:', wss.clients.size);
  });
});

// ── Driver movement simulation ───────────────────────────────

function simulateDriverMovement() {
  if (!activeRide || activeRide.status !== 'accepted') return;

  const steps = 10;
  let step = 0;
  const startLat = activeRide.driverLat;
  const startLon = activeRide.driverLon;
  const endLat = activeRide.pickup.lat;
  const endLon = activeRide.pickup.lon;

  const interval = setInterval(() => {
    step++;
    if (step > steps || !activeRide) {
      clearInterval(interval);
      if (activeRide) {
        activeRide.status = 'arrived';
        broadcast({
          type: 'DRIVER_ARRIVED',
          driverName: activeRide.driverName,
        });
      }
      return;
    }

    const progress = step / steps;
    const lat = startLat + (endLat - startLat) * progress;
    const lon = startLon + (endLon - startLon) * progress;

    broadcast({
      type: 'DRIVER_MOVING',
      driverLocation: { lat, lon },
      estimatedMinutes: Math.max(1, Math.round((1 - progress) * 8)),
    });
  }, 3000);
}

// ── Start server ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = 3443;

server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  Voice Ride App — Server Running               ║`);
  console.log(`  ║  HTTP:   http://localhost:${PORT}                   ║`);
  console.log(`  ║  Rider:  http://localhost:${PORT}/rider.html         ║`);
  console.log(`  ║  Driver: http://localhost:${PORT}/driver.html        ║`);
  console.log(`  ╚══════════════════════════════════════════════╝`);
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║  HTTPS (for mobile):                         ║`);
    console.log(`  ║  https://localhost:${HTTPS_PORT}                   ║`);
    console.log(`  ║  📱 Scan QR → https://<your-ip>:${HTTPS_PORT}       ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
  });
}
