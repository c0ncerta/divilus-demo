# DiavloCord

DiavloCord is a high-fidelity Discord-style app built with Next.js, Tailwind CSS, and Zustand.

It supports:
- Local/demo mode (frontend-only with local persistence and multi-tab sync)
- Backend mode (Express + Socket.IO + Prisma + PostgreSQL for auth and realtime DM requests)

## Public Demo Mode (No Login, No DB)

This repository includes a demo switch for portfolio/public previews.

- Demo mode flag: `NEXT_PUBLIC_DEMO=1`
- Effect:
  - Uses mock `authProvider`/`dataProvider`
  - Skips login with a fixed `Demo User`
  - Runs without database or backend services
  - Disables external API integrations (GIF/media generation endpoints)
  - Shows a small banner: `Modo Demo (datos simulados)`

## Tech Stack

- Frontend: Next.js (App Router), React, Tailwind CSS
- State: Zustand (persisted in `localStorage`)
- Realtime (local): `BroadcastChannel` event bus
- Realtime (backend): Socket.IO
- Backend: Express, Prisma, PostgreSQL, JWT

## Project Structure

- `src/`: frontend app, components, store, services
- `server/`: backend API + sockets + Prisma schema
- `public/`: static assets

## Quick Start

1. Install dependencies:

```powershell
npm install
npm install --prefix server
```

2. Run frontend only:

```powershell
npm run dev
```

3. Run frontend + backend:

```powershell
npm run dev:all
```

## Run Demo Locally

1. Create `.env.local` in project root (frontend):

```env
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=
NEXT_PUBLIC_REAL_APP_URL=https://diavlo-cord.vercel.app
```

2. Start frontend only:

```powershell
npm run dev
```

3. Open `http://localhost:3000`

- You should enter directly as `Demo User`.
- No login modal.
- No backend/database required.
- Demo fixtures are local (`src/lib/demo-data.ts`) and use local assets (`/logo.png`, `/icons/*`), so no external avatar/icon service is required.

## Demo Smoke Test (No Backend)

With `NEXT_PUBLIC_DEMO=1` and no backend running:

1. Open `/` and verify:
   - Session starts as `Demo User`
   - Demo banner is visible: `Modo Demo (datos simulados)`
2. Navigate core screens:
   - Server list and channel list load
   - Messages render in `announcements`, `general`, `tickets`
   - Settings modal opens
3. Verify protected/dangerous actions are blocked in demo:
   - Delete message
   - Create/delete server or channel
   - Invite/admin role changes
   - Kick/ban/timeout moderation actions
4. Verify links in banner:
   - `Ver demo (sin login)` points to current demo root
   - `App real` opens `NEXT_PUBLIC_REAL_APP_URL`
5. Verify external integrations are disabled:
   - GIF search returns empty state in demo
   - Media generation API returns `disabled_in_demo_mode`

## Environment Variables

Frontend (`.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_DEMO=0
NEXT_PUBLIC_REAL_APP_URL=https://diavlo-cord.vercel.app
GIPHY_API_KEY=
IMAGE_GENERATION_PROVIDER=auto
WAVESPEED_API_KEY=
WAVESPEED_API_BASE_URL=https://api.wavespeed.ai/api/v3
WAVESPEED_SD35_ENDPOINT=stability-ai/stable-diffusion-3.5-large
WAN22_WORKFLOW_ENDPOINT=wavespeed-ai/wan-2.2/i2v-720p-ultra-fast
# Optional per quality:
# WAN22_WORKFLOW_ENDPOINT_LOW=
# WAN22_WORKFLOW_ENDPOINT_STANDARD=
# WAN22_WORKFLOW_ENDPOINT_ULTRA=
CIVITAI_API_TOKEN=
CIVITAI_IMAGE_MODEL_URL=https://civitai.com/models/277058/epicrealism-xl
CIVITAI_ORCHESTRATION_URL=https://orchestration.civitai.com
```

### Demo env minimum

```env
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=
```

Backend (`server/.env`):

```env
PORT=3001
JWT_SECRET=your-secret
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CORS_ORIGIN=http://localhost:3000
```

## Accessibility (WCAG 2.2 AA - Essential)

### Automated checks

```bash
npm run a11y
```

- Runs `eslint-plugin-jsx-a11y` rules (`npm run lint:a11y`) and TypeScript checks.
- Current status:
  - No blocking a11y errors in lint
  - Existing warnings remain in legacy sections (`MessageItem`, `ChannelSidebar`, `ChatView`) and are tracked for incremental cleanup

### Manual checklist (keyboard + screen reader)

1. Keyboard-only navigation:
   - `Tab` and `Shift+Tab` traverse all interactive elements in visible order.
   - Focus ring is always visible on controls.
   - `Enter`/`Space` activate focused buttons and links.
2. Skip link:
   - On first `Tab`, `Saltar al contenido` appears and moves focus to `#main-content`.
3. Modal behavior:
   - Opening a modal moves focus inside it.
   - `Esc` closes modal (except guarded flows with unsaved changes).
   - Focus stays trapped inside modal while open.
   - Closing modal restores focus to the trigger element.
   - Background scroll is blocked while modal is open.
4. Screen reader announcements:
   - Channel change announces current channel.
   - New incoming messages announce `Nuevo mensaje de {usuario}`.
   - Message send success/failure announces politely/assertively.
   - Reconnect/disconnect state changes are announced.
5. Forms and validation:
   - Inputs/textareas/selects have associated labels.
   - Validation/status text is linked with `aria-describedby` or `aria-live` where needed.
   - Disabled/loading states are semantically reflected.
6. Motion preferences:
   - With `prefers-reduced-motion: reduce`, heavy motion is disabled/reduced.

Render deployment (server):

- Build Command:
```bash
npm ci --include=dev && npm run build
```
- Start Command:
```bash
npm run start:render
```
- Required env vars on Render:
```env
DATABASE_URL=postgresql://...-pooler.../?sslmode=require
DIRECT_URL=postgresql://... (same host without -pooler) .../?sslmode=require
JWT_SECRET=...
CORS_ORIGIN=https://your-frontend-domain
```

## Keep Render Warm (Optional)

To reduce cold starts, this repo includes a GitHub Actions workflow:
- `.github/workflows/keep-render-warm.yml`
- Runs every 7 minutes and pings backend `/health`

Default URL:
- `https://diavlocord.onrender.com/health`

If your backend URL changes, set this GitHub secret:
- `RENDER_HEALTHCHECK_URL=https://your-backend.onrender.com/health`

## Backend Setup

From `server/`:

```powershell
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Notes

- If `NEXT_PUBLIC_API_URL` is not set, the app runs in local/demo mode.
- If `NEXT_PUBLIC_DEMO=1`, providers are forced to mock mode and login is skipped.
- Session data and app state are persisted in browser storage.

## Deploy Demo (Vercel)

1. Push `DiavloCord-demo` to its own repository/branch.
2. Create a new Vercel project from that repo.
3. Set environment variables in Vercel project settings:

```env
NEXT_PUBLIC_DEMO=1
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=
NEXT_PUBLIC_REAL_APP_URL=https://diavlo-cord.vercel.app
```

4. Deploy.

Result:
- Public URL opens directly in demo mode.
- Uses only mock fixtures (no DB, no server required).

## FFmpeg Media Fix (Login Video)

If login intro video compatibility/size is an issue, encode web-friendly outputs with FFmpeg:

```powershell
npm run media:check:ffmpeg
npm run media:encode:login
```

Optional source file:
- Put your master file at `public/login_video_source.mp4`
- The script outputs:
  - `public/login_video.mp4` (H.264 + `faststart`)
  - `public/login_video.webm` (VP9)
# divilus-demo
