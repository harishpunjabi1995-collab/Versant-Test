# Versant English Placement Test Simulator

A desktop-only, fullscreen Versant English Placement Test simulator with strict timing, one-way flow, and microphone recording.

## Features
- Fixed A → I section order with enforced timers
- Chrome + microphone + noise checks before start
- Fullscreen enforced and desktop-only UI
- Auto-recording for speaking sections with auto-stop
- Auto-save after every question
- Auto-advance on timeout
- Server-authoritative timers and response storage

## Tech Stack
- Node.js + Express backend
- Static HTML/CSS/JS frontend

## Setup
```bash
npm install
npm start
```

Open `http://localhost:3000` in Chrome.

## Notes
- Responses are stored in `data/responses.json` and audio files in `uploads/`.
- Speech playback uses the browser SpeechSynthesis API for dummy prompts.
- This is practice-only and does not provide scoring.
