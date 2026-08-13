
# Flood Monitoring System

Capstone flood monitoring system with a split backend architecture:

- Frontend (React + Vite, served by Nginx in Docker)
- Django backend for authentication, admin, and persistence
- Node.js MQTT bridge for realtime data + WebSocket broadcast
- PostgreSQL for persistent data storage

## Runtime Architecture

- Frontend: `http://localhost:8080`
- Django API (auth/admin): `http://localhost:8000`
- MQTT bridge API + WebSocket (realtime): `http://localhost:3000`

## Team Installation via Docker

### 1) Clone repository

```bash
git clone https://github.com/habibnrp/capstone-web-.git
cd capstone-web-
```

### 2) Start all services

```bash
docker compose up --build
```

Compose will start these services:

- `db` (PostgreSQL)
- `backend` (Django on port 8000)
- `mqtt-bridge` (Node on port 3000)
- `frontend` (Nginx static app on port 8080)

### 3) Login credentials

Default admin user is seeded on backend startup:

- Email: `admin@kai.id`
- Password: `Admin1234!`

## Local Development (without Docker)

Use separate terminals:

1. Frontend
```bash
npm install
npm run dev
```

2. Django backend
```bash
cd django-backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_default_admin
daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

3. MQTT bridge
```bash
cd server
npm install
npm start
```


