# Django Backend Scaffold

This folder contains a clean Django backend structure for the capstone web app.

## Purpose
- Subscribe to MQTT topics from the IoT devices
- Expose REST APIs for the frontend
- Push realtime updates over WebSocket
- Keep the frontend connection simple through one backend layer

## Main endpoints planned
- `GET /api/monitoring/realtime/`
- `GET /api/monitoring/historical/`
- `GET /api/monitoring/topics/`
- `WS /ws/monitoring/`

## Folder layout
```
django-backend/
├── manage.py
├── requirements.txt
├── .env.example
├── config/
│   ├── __init__.py
│   ├── asgi.py
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── apps/
│   └── monitoring/
│       ├── __init__.py
│       ├── admin.py
│       ├── apps.py
│       ├── consumers.py
│       ├── models.py
│       ├── routing.py
│       ├── serializers.py
│       ├── services/
│       │   ├── __init__.py
│       │   └── mqtt_client.py
│       ├── tests.py
│       ├── urls.py
│       └── views.py
└── common/
    ├── __init__.py
    └── utils.py
```

## Connection notes
- Frontend dev server origin: `http://localhost:5173` or `http://localhost:5174`
- Django API origin: `http://localhost:8000`
- MQTT broker: `mqtt://broker.emqx.io:1883`

## Suggested frontend env
Set this in the frontend `.env` file later:
```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws/monitoring/
```
