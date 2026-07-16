from rest_framework import serializers
from django.utils import timezone

from .models import SensorReading
from .models import MonitoringUser, SystemSetting

ADC_MAX = 4095
KRL_MIN_CM = 0
KRL_MAX_CM = 5
KAI_MIN_CM = 8
KAI_MAX_CM = 15
RAIN_MIN_CM = 0
RAIN_MAX_CM = 50


def _setting_float(key: str, default: float) -> float:
    raw_value = SystemSetting.objects.filter(key=key).values_list('value', flat=True).first()
    try:
        return float(raw_value) if raw_value not in (None, '') else default
    except (TypeError, ValueError):
        return default


def _topic_scale(topic: str):
    normalized_topic = (topic or '').upper()
    if 'KRL' in normalized_topic:
        return KRL_MIN_CM, _setting_float('threshold_krl', KRL_MAX_CM), False
    if 'KAI' in normalized_topic:
        return KAI_MIN_CM, _setting_float('threshold_kai', KAI_MAX_CM), False
    if 'RAIN' in normalized_topic:
        return RAIN_MIN_CM, _setting_float('threshold_rain', RAIN_MAX_CM), True
    return None, None, False


def _convert_sensor_value(topic: str, raw_value, fallback_value):
    try:
        numeric_value = float(raw_value)
    except (TypeError, ValueError):
        try:
            return float(fallback_value)
        except (TypeError, ValueError):
            return fallback_value

    min_value, max_value, invert = _topic_scale(topic)
    if min_value is None or max_value is None:
        return numeric_value

    clamped = min(max(numeric_value, 0), ADC_MAX)
    ratio = clamped / ADC_MAX
    effective_ratio = 1 - ratio if invert else ratio
    converted = min_value + (effective_ratio * (max_value - min_value))
    return round(converted, 2)


class SensorReadingSerializer(serializers.ModelSerializer):
    # keep machine-readable ISO timestamp for filtering/graphs
    timestamp = serializers.DateTimeField()
    # human-friendly display timestamp
    timestamp_display = serializers.SerializerMethodField()
    value = serializers.SerializerMethodField()

    class Meta:
        model = SensorReading
        fields = ["id", "topic", "location", "value", "raw", "timestamp", "timestamp_display"]

    def get_value(self, obj):
        return _convert_sensor_value(obj.topic, obj.raw, obj.value)

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
