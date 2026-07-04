from rest_framework import serializers
from django.utils import timezone

from .models import SensorReading
from .models import MonitoringUser, SystemSetting


class SensorReadingSerializer(serializers.ModelSerializer):
    # keep machine-readable ISO timestamp for filtering/graphs
    timestamp = serializers.DateTimeField()
    # human-friendly display timestamp
    timestamp_display = serializers.SerializerMethodField()

    class Meta:
        model = SensorReading
        fields = ["id", "topic", "location", "value", "raw", "timestamp", "timestamp_display"]

    def get_timestamp_display(self, obj):
        ts = timezone.localtime(obj.timestamp)
        try:
            return ts.strftime("%d-%m-%Y %H:%M")
        except Exception:
            return str(ts)


class MonitoringUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = MonitoringUser
        fields = ["id", "email", "name", "role", "created_at"]


class SystemSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSetting
        fields = ["id", "key", "value"]
