# Real-Time Feedback Messenger

A basic student-friendly web app where users can submit support/feedback messages.

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js, Express.js
- External API: Intercom API (called from backend only)
- Local storage: JSON file (`data/feedback.json`)

## Project Structure

```
REALTIME-FEEDBACK-MESSENGER/
  data/
    feedback.json
  public/
    index.html
    feedback.html
    admin.html
    style.css
    script.js
  routes/
    feedbackRoutes.js
  services/
    intercomService.js
  .env
  .gitignore
  package.json
  server.js
  README.md
```

## Features

1. Home page (`index.html`)
   - Welcome text
   - Button to open feedback form

2. Feedback page (`feedback.html`)
   - Name, email, message fields
   - Sends data to backend using Fetch API

3. Backend API
   - `POST /api/feedback`: stores feedback locally and attempts to send to Intercom
   - `GET /api/feedback`: returns all stored feedback records

4. Admin page (`admin.html`)
   - Loads feedback records from backend
   - Displays records in a simple table
  - Loads live Intercom conversations
  - Lets admin send real-time replies from dashboard

## Environment Variables

Create/update `.env`:

```
PORT=3000
INTERCOM_ACCESS_TOKEN=your_intercom_access_token_here
INTERCOM_BASE_URL=https://api.intercom.io
INTERCOM_APP_ID=your_intercom_app_id_here
INTERCOM_MESSENGER_API_BASE=https://api-iam.intercom.io
```

## Intercom Integration Setup

1. In Intercom, create a Private App and generate an access token.
2. Copy that token into `.env` as `INTERCOM_ACCESS_TOKEN`.
3. Keep `INTERCOM_BASE_URL=https://api.intercom.io` unless your Intercom docs require a different base URL.
4. Restart the server after any `.env` change.

How integration works:

- Backend endpoint `POST /api/feedback` always stores the feedback in `data/feedback.json` first.
- After local save, backend tries to:
  - search/create the Intercom contact by email
  - create an Intercom conversation with the feedback message
- If Intercom is not configured, the message remains local with status `saved-locally-only`.
- If Intercom request fails, status becomes `intercom-failed`.
- If successful, status becomes `sent-to-intercom`.

Optional status check endpoint:

- `GET /api/feedback/intercom-status`
- Returns whether Intercom token appears configured.

Intercom Messenger widget:

- `INTERCOM_APP_ID` is required to show live Intercom chat in the website.
- `INTERCOM_MESSENGER_API_BASE` defaults to `https://api-iam.intercom.io`.
- For EU or AU workspaces, use Intercom region-specific API base if required by your account.

Messenger config endpoint:

- `GET /api/feedback/messenger-config`
- Returns safe public widget settings (`appId`, `apiBase`, `enabled`).

Admin Intercom live endpoints:

- `GET /api/feedback/intercom/conversations?perPage=12`
- `POST /api/feedback/intercom/conversations/:conversationId/reply`

## Setup Instructions

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open browser:

```text
http://localhost:3000
```

## Notes

- If `INTERCOM_ACCESS_TOKEN` is missing, feedback is still saved locally in `data/feedback.json`.
- Intercom API is only called by the backend (not by frontend).
- This project is intentionally simple for a school submission.

## Troubleshooting Intercom

- If you still see `intercom-failed`, check that your Intercom token is real and has permissions for contacts and conversations.
- Placeholder token text like `your_intercom_access_token_here` is treated as not configured.
- Check your terminal logs for Intercom response details.
