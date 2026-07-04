FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY django-backend/requirements.txt /app/django-backend/requirements.txt
RUN pip install --no-cache-dir -r /app/django-backend/requirements.txt

COPY django-backend /app/django-backend
WORKDIR /app/django-backend

EXPOSE 8000

CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py seed_default_admin && daphne -b 0.0.0.0 -p 8000 config.asgi:application"]
