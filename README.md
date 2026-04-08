# Splitense MVP

A full-stack expense tracking web app with:

- personal and shared expense tracking
- weekly and monthly automated reports
- in-app AI assistant for expense questions
- email and WhatsApp delivery with real provider support plus simulation fallback
- group invite codes and expense splitting
- responsive dashboard UI with offline local fallback

## Run locally

1. Install dependencies: `npm install`
2. Optional: copy `.env.example` to `.env` and fill provider values for AI, email, and WhatsApp delivery.
3. Start the server: `npm start`
4. Open `http://localhost:3000`

## AI assistant

Splitense now includes an authenticated AI assistant tab that can answer questions about the signed-in user's expense data.

- Session memory is stored per user and browser session.
- Common questions such as category totals, last month spend, and balance questions are answered deterministically.
- If `OPENAI_API_KEY` is configured, more open-ended questions are answered through the OpenAI Responses API using only the user's summarized expense data.
- If `OPENAI_API_KEY` is missing, the app still provides fast fallback answers for the supported expense intents.

## Email delivery

Email reports support two modes:

- Gmail OAuth2 using `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN`
- Standard SMTP using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`

Reports are sent as formatted HTML with a category breakdown and a plain-text fallback. Delivery is retried automatically on transient failures and logged in the app.

## WhatsApp delivery

WhatsApp reports are sent through Twilio when these variables are configured:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

Optional:

- `TWILIO_STATUS_CALLBACK_URL`

If Twilio is not configured, Splitense keeps the notification flow working with a clearly marked simulated delivery entry.

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
- Twilio delivery status callbacks can be pointed at `/api/notifications/webhooks/twilio`.
- If the backend is unavailable, the frontend stores data in browser local storage and continues working in fallback mode.
