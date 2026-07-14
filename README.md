# Pixofix Cortex

Operations platform with Support Desk — ticket management, order tracking, team chat, email ingestion, and analytics.

## Deploy on Render (Backend + Frontend)

1. Go to https://render.com → Sign up with GitHub
2. Click **New +** → **Web Service**
3. Connect `github.com/px-rr/pixofix-cortex`
4. Configure:
   - **Name:** `pixofix-cortex`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Click **Create Web Service**
6. Once deployed, open the URL (e.g. `https://pixofix-cortex.onrender.com`)
7. **Login:** `1101` / `1101`, then set a new password

### Configure IMAP Email

After deployment, POST to `/api/imap-config` with your IMAP settings:

```json
{ "host": "imap.yourhost.com", "port": 993, "user": "support@pixofix.com", "pass": "yourpassword" }
```

Then use the **Fetch Emails** button in the Support Desk Dashboard.

## Deploy on Vercel (Frontend only)

1. Go to https://vercel.com → Import `px-rr/pixofix-cortex`
2. Set **Output Directory** to `public`
3. The frontend works standalone with localStorage
4. To connect the backend, set `BACKEND_URL` env var to your Render URL

## Local Development

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Tech Stack

- **Frontend:** Vanilla JS SPA (single HTML file)
- **Backend:** Node.js + Express + SQLite + IMAP
- **Deployment:** Render (recommended) or Vercel
