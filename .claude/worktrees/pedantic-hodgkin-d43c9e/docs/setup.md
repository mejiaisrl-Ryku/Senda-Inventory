# Senda Inventory — Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ (local) or a Railway Postgres plugin
- npm or yarn

---

## 1. Clone & install

```bash
git clone <repo-url>
cd senda-inventory

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

---

## 2. Configure environment variables

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env — set DATABASE_URL to your local Postgres connection string
```

### Frontend

```bash
cd frontend
cp .env.example .env
# REACT_APP_API_URL defaults to http://localhost:4000/api
```

---

## 3. Database setup

```bash
cd backend

# Apply migrations and generate Prisma client
npm run db:migrate

# (Optional) Seed with Dopamina & La Milagrosa sample data
npm run db:seed
```

---

## 4. Run locally

```bash
# Terminal 1 — backend (port 4000)
cd backend && npm run dev

# Terminal 2 — frontend (port 3000)
cd frontend && npm start
```

Open http://localhost:3000

---

## 5. Deploy

### Backend → Railway

1. Create a new Railway project and add a **PostgreSQL** plugin.
2. Connect your GitHub repo and set the **root directory** to `backend`.
3. Railway auto-injects `DATABASE_URL`. Add any other vars from `.env.example`.
4. Build command: `npm run build`  
   Start command: `npm start`

### Frontend → Vercel

1. Import the repo on Vercel and set the **root directory** to `frontend`.
2. Add env var: `REACT_APP_API_URL=https://<your-railway-url>/api`
3. Build command: `npm run build`  
   Output directory: `build`

---

## Useful commands

| Command | Description |
|---|---|
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed initial client data |
