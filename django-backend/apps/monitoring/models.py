from django.db import models


class SensorReading(models.Model):
    topic = models.CharField(max_length=64)
    location = models.CharField(max_length=128, default="Manggarai")
    value = models.CharField(max_length=255)
    raw = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.topic} @ {self.location}"


class MonitoringUser(models.Model):
    ROLE_USER = "user"
    ROLE_ADMIN = "admin"
    ROLE_CHOICES = [
        (ROLE_USER, "User"),
        (ROLE_ADMIN, "Admin"),
    ]

    email = models.CharField(max_length=254, unique=True)
    name = models.CharField(max_length=150)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=20, default=ROLE_USER, choices=ROLE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} <{self.email}>"


class SignupOTP(models.Model):
    email = models.CharField(max_length=254, unique=True)
    password_hash = models.CharField(max_length=255)
    otp_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"OTP pending for {self.email}"


class SystemSetting(models.Model):
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField(blank=True, default='')

    def __str__(self):
        return f"{self.key}={self.value}"
