# Splitense MVP

A full-stack expense tracking web app with:

- personal and shared expense tracking
- weekly and monthly automated reports
- email and WhatsApp notification simulation
- group invite codes and expense splitting
- responsive dashboard UI with offline local fallback

## Run locally

1. Install dependencies: `npm install`
2. Optional: copy `.env.example` to `.env` and fill SMTP values if you want real email delivery.
3. Start the server: `npm start`
4. Open `http://localhost:3000`

## Deploy on Render

This project is prepared for Render with the included [render.yaml](/c:/Users/kasni/OneDrive/Desktop/My%20First%20Project/render.yaml).

Render notes:

- The app uses a JSON file database.
- Render's normal filesystem is ephemeral, so persistence requires a mounted disk.
- The included blueprint config mounts a disk and points `DATA_DIR` to it.

Basic Render flow:

1. Push this project to GitHub.
2. In Render, create a new Blueprint deployment from that repository.
3. Render should detect `render.yaml` automatically.
4. Approve the `splitense` web service and persistent disk.
5. After deploy finishes, open the Render-generated public URL.

If you prefer manual setup instead of Blueprint:

- Environment:
  `DATA_DIR=/var/data/splitense`
- Build command:
  `npm install`
- Start command:
  `npm start`
- Health check path:
  `/api/health`
- Attach a persistent disk mounted at:
  `/var/data`

## Project structure

- `frontend/` static dashboard UI
- `backend/` Express server, API routes, reporting, and data services
- `backend/data/db.json` file-backed persistence for the MVP

## Notes

- Weekly and monthly reports are generated automatically on startup and then re-checked hourly.
- WhatsApp delivery is simulated by default, with clear placeholders where a provider can be integrated later.
- If the backend is unavailable, the frontend stores data in browser local storage and continues working in fallback mode.
