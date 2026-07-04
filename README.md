
  # Flood Monitoring System UI

  This is a code bundle for Flood Monitoring System UI. The original project is available at https://www.figma.com/design/e0QpFeqApnb3oHH693Owcx/Flood-Monitoring-System-UI.

  ## Local Development

  Run the frontend with:

  ```bash
  npm i
  npm run dev
  ```

  Run the backend separately from `django-backend/`.

  ## Docker Deployment

  Use Docker Compose for a repeatable deployment on another PC:

  ```bash
  docker compose up --build
  ```

  After it starts:
  - Frontend: `http://localhost:8080`
  - Backend API: `http://localhost:8000`

  The Docker stack uses PostgreSQL, the Django backend, and an Nginx-served frontend.

  The default admin account is seeded automatically on startup:
  - Email: `admin@kai.id`
  - Password: `Admin1234!`


