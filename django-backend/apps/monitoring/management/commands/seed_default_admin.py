import os

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand

from apps.monitoring.models import MonitoringUser


class Command(BaseCommand):
    help = "Create or update the default admin account for fresh deployments"

    def handle(self, *args, **options):
        email = os.environ.get("ADMIN_SEED_EMAIL", "admin@kai.id").strip().lower()
        password = os.environ.get("ADMIN_SEED_PASSWORD", "Admin1234!")
        name = os.environ.get("ADMIN_SEED_NAME", "Admin").strip() or "Admin"

        if not email or not password:
            raise ValueError("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set")

        user, created = MonitoringUser.objects.update_or_create(
            email=email,
            defaults={
                "name": name,
                "password_hash": make_password(password),
                "role": MonitoringUser.ROLE_ADMIN,
            },
        )

        action = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{action} admin account: {user.email}"))