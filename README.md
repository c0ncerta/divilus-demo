# Divilus Demo

Demo interactiva estilo Discord hecha con Next.js, Zustand y Tailwind.

Este repo esta preparado para enseñar producto rapido, sin friccion y sin bloqueo por login.

## Estado actual de esta demo

- El modo demo esta forzado por codigo en [src/lib/env.ts](src/lib/env.ts) (`isDemoMode = true`).
- Entra directo a la app sin autenticacion.
- Los datos que ves son locales (usuarios, servidores, mensajes y amigos ficticios).
- El backend puede existir en paralelo, pero esta demo no depende de el para navegar.

## Que incluye para enseñar

- Lista de servidores con canales de texto y voz.
- Chat con mensajes de ejemplo.
- Vista de amigos con contactos ficticios y DMs precargados.
- Sidebar derecho (miembros/detalles), ajustes y varias interacciones de UI.
- Layout responsive para desktop y movil.

## Stack real del proyecto

- Frontend: Next.js (App Router), React 18, Tailwind CSS.
- Estado: Zustand con persistencia local.
- Tiempo real local: `BroadcastChannel`.
- Backend opcional: Express + Socket.IO + Prisma + PostgreSQL (`server/`).

## Estructura rapida

- `src/`: app frontend (componentes, store, providers, hooks).
- `src/lib/demo-data.ts`: fixtures de la demo (incluye amigos ficticios y DMs).
- `src/lib/env.ts`: modo demo/backend.
- `server/`: API y sockets para entorno real.
- `public/`: assets estaticos (logos, iconos, video, etc).

## Requisitos

- Node.js 20+ recomendado.
- npm 10+ recomendado.

## Arranque local (demo)

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Comandos utiles

```bash
# Frontend
npm run dev
npm run build
npm run start
npm run typecheck
npm run a11y

# Frontend + server en paralelo (solo si quieres levantar todo)
npm run dev:all
```

## Backend (opcional, modo real)

Si quieres levantar API/sockets para pruebas reales:

```bash
npm install --prefix server
npm run dev:server
```

Comandos directos dentro de `server/`:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Variables de entorno

### Frontend (`.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_REAL_APP_URL=https://diavlo-cord.vercel.app
GIPHY_API_KEY=
IMAGE_GENERATION_PROVIDER=auto
WAVESPEED_API_KEY=
WAVESPEED_API_BASE_URL=https://api.wavespeed.ai/api/v3
WAVESPEED_SD35_ENDPOINT=stability-ai/stable-diffusion-3.5-large
WAN22_WORKFLOW_ENDPOINT=wavespeed-ai/wan-2.2/i2v-720p-ultra-fast
CIVITAI_API_TOKEN=
CIVITAI_IMAGE_MODEL_URL=https://civitai.com/models/277058/epicrealism-xl
CIVITAI_ORCHESTRATION_URL=https://orchestration.civitai.com
```

### Backend (`server/.env`)

```env
PORT=3001
JWT_SECRET=tu-secreto
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CORS_ORIGIN=http://localhost:3000
```

## Deploy backend en Render (si lo usas)

En el servicio de `server/`:

- Build Command: `npm ci --include=dev && npm run build`
- Start Command: `npm run start:render`

Variables minimas:

```env
DATABASE_URL=postgresql://.../?sslmode=require
DIRECT_URL=postgresql://.../?sslmode=require
JWT_SECRET=...
CORS_ORIGIN=https://tu-frontend
```

## Smoke test rapido de la demo

1. Abrir `/` y comprobar que entra sin login.
2. Ir a la vista de amigos y verificar que aparecen contactos ficticios.
3. Abrir un DM de ejemplo y comprobar mensajes cargados.
4. Cambiar entre servidores/canales y abrir Ajustes.
5. Verificar que no rompe sin backend levantado.

## Nota importante para el equipo

Esta rama esta orientada a demo publica. Si se quiere volver a flujo completo con login + backend como fuente principal, hay que rehacer el gating de auth en frontend y dejar de forzar `isDemoMode` en `src/lib/env.ts`.
