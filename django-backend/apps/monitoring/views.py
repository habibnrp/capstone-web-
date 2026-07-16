from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status as rf_status
from django.utils.dateparse import parse_date, parse_datetime
from django.utils import timezone
import logging
import json
import secrets
from datetime import timedelta
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from urllib import error as urllib_error
from urllib import request as urllib_request

from django.conf import settings
from django.core.mail import send_mail

from .models import SensorReading, MonitoringUser, SignupOTP, SystemSetting
from .serializers import (
    KAI_MAX_CM,
    KAI_MIN_CM,
    KRL_MAX_CM,
    KRL_MIN_CM,
    SensorReadingSerializer,
    MonitoringUserSerializer,
    SystemSettingSerializer,
)

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.hashers import make_password, check_password
from django.core import signing

logger = logging.getLogger(__name__)
try:
    import requests
except Exception:
    requests = None

DEFAULT_SENSOR_TOPICS = ["RAINSENSOR", "WATERLEVELSENSORKAI", "WATERLEVELSENSORKRL"]
SENSOR_REGISTRY_KEY = "sensor_registry"
SENSOR_ALERT_STATE_PREFIX = "sensor_alert_state:"
SENSOR_ALERT_GLOBAL_KEY = "sensor_alert_state:telegram_global"
SENSOR_ALERT_COOLDOWN_MINUTES = 1


def _build_display_name(email: str) -> str:
    local_part = (email.split('@', 1)[0] if email else '').strip()
    display_name = local_part.replace('.', ' ').replace('_', ' ').replace('-', ' ').strip().title()
    return display_name or email


def _generate_otp_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def _send_signup_otp(email: str, otp_code: str) -> None:
    subject = "Kode OTP Pendaftaran Flood Monitoring System"
    message = (
        f"Kode OTP Anda adalah {otp_code}.\n\n"
        "Kode ini berlaku selama 10 menit. Jika Anda tidak meminta pendaftaran, abaikan email ini."
    )
    send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)


def _read_json_setting(key, default_value):
    raw = SystemSetting.objects.filter(key=key).values_list('value', flat=True).first()
    if not raw:
        return default_value
    try:
        return json.loads(raw)
    except Exception as e:
        logger.debug('Failed parsing JSON setting %s', key, exc_info=e)
        return default_value


def _write_json_setting(key, value):
    SystemSetting.objects.update_or_create(key=key, defaults={'value': json.dumps(value)})


def _sensor_alert_key(topic: str) -> str:
    return f"{SENSOR_ALERT_STATE_PREFIX}{(topic or '').strip().upper()}"


def _get_sensor_alert_state(topic: str):
    return _read_json_setting(_sensor_alert_key(topic), {})


def _set_sensor_alert_state(topic: str, value):
    _write_json_setting(_sensor_alert_key(topic), value)


def _topic_alert_level(topic: str, value):
    normalized_topic = (topic or '').upper()
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return 'SAFE'

    if 'RAIN' in normalized_topic:
        if numeric_value >= 50:
            return 'CRITICAL'
        if numeric_value >= 25:
            return 'WARNING'
        return 'SAFE'

    if 'KAI' in normalized_topic:
        if numeric_value >= KAI_MAX_CM:
            return 'CRITICAL'
        if numeric_value >= (KAI_MAX_CM - 3):
            return 'WARNING'
        return 'SAFE'

    if 'KRL' in normalized_topic:
        if numeric_value >= KRL_MAX_CM:
            return 'CRITICAL'
        if numeric_value >= 3:
            return 'WARNING'
        return 'SAFE'

    return 'SAFE'


def _telegram_request(bot_token: str, chat_id: str, message: str):
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({'chat_id': chat_id, 'text': message}).encode('utf-8')

    if requests is not None:
        resp = requests.post(url, json={'chat_id': chat_id, 'text': message}, timeout=10)
        response_text = resp.text
        response_json = resp.json() if resp.status_code == 200 else None
        return resp.status_code, response_text, response_json

    req = urllib_request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib_request.urlopen(req, timeout=10) as resp:
        response_text = resp.read().decode('utf-8')
        response_json = json.loads(response_text) if response_text else {}
        return getattr(resp, 'status', 200), response_text, response_json


def _send_telegram_message(bot_token: str, chat_id: str, message: str):
    status_code, response_text, response_json = _telegram_request(bot_token, chat_id, message)
    if status_code != 200:
        raise RuntimeError(response_text or 'telegram request failed')
    return response_json


def _send_sensor_alert(reading: SensorReading, status_label: str):
    if status_label not in ('WARNING', 'CRITICAL'):
        return False

    bot_token = SystemSetting.objects.filter(key='telegram_bot_token').values_list('value', flat=True).first()
    chat_id = SystemSetting.objects.filter(key='telegram_chat_id').values_list('value', flat=True).first()
    if not bot_token or not chat_id:
        logger.debug('Skipping sensor alert for %s: telegram not configured', reading.topic)
        return False

    global_state = _read_json_setting(SENSOR_ALERT_GLOBAL_KEY, {}) or {}
    global_last_sent_raw = global_state.get('sent_at')
    global_last_sent_at = parse_datetime(global_last_sent_raw) if global_last_sent_raw else None
    if global_last_sent_at and timezone.is_naive(global_last_sent_at):
        global_last_sent_at = timezone.make_aware(global_last_sent_at, timezone.get_current_timezone())

    if global_last_sent_at is not None:
        if timezone.now() - global_last_sent_at < timedelta(minutes=SENSOR_ALERT_COOLDOWN_MINUTES):
            logger.debug('Skipping sensor alert for %s: telegram global cooldown active', reading.topic)
            return False

    state = _get_sensor_alert_state(reading.topic) or {}
    previous_status = str(state.get('status') or '').upper()
    last_sent_raw = state.get('sent_at')
    last_sent_at = parse_datetime(last_sent_raw) if last_sent_raw else None
    if last_sent_at and timezone.is_naive(last_sent_at):
        last_sent_at = timezone.make_aware(last_sent_at, timezone.get_current_timezone())

    cooldown_active = False
    if last_sent_at is not None:
        cooldown_active = timezone.now() - last_sent_at < timedelta(minutes=SENSOR_ALERT_COOLDOWN_MINUTES)

    if previous_status == status_label and cooldown_active:
        return False

    message = (
        f"[Flood Monitor] Sensor alert {status_label}\n"
        f"Topic: {reading.topic}\n"
        f"Location: {reading.location}\n"
        f"Value: {reading.value}\n"
        f"Raw: {reading.raw}\n"
        f"Time: {timezone.localtime(reading.timestamp).strftime('%d-%m-%Y %H:%M')}"
    )

    _send_telegram_message(bot_token, chat_id, message)
    _set_sensor_alert_state(reading.topic, {
        'status': status_label,
        'sent_at': timezone.now().isoformat(),
    })
    _write_json_setting(SENSOR_ALERT_GLOBAL_KEY, {
        'topic': reading.topic,
        'status': status_label,
        'sent_at': timezone.now().isoformat(),
    })
    add_activity_log('system', f'Sent {status_label.lower()} sensor alert for {reading.topic}')
    return True


def _normalize_sensor_registry_item(item):
    if isinstance(item, str):
        topic = item.strip()
        if not topic:
            return None
        return {
            'topic': topic,
            'clientId': '',
            'username': '',
            'location': 'Manggarai',
            'enabled': True,
        }

    if not isinstance(item, dict):
        return None

    topic = str(item.get('topic') or item.get('topicName') or '').strip()
    if not topic:
        return None

    client_id = str(item.get('clientId') or item.get('client_id') or '').strip()
    username = str(item.get('username') or item.get('userName') or '').strip()
    location = str(item.get('location') or 'Manggarai').strip() or 'Manggarai'
    enabled_value = item.get('enabled', True)
    if isinstance(enabled_value, str):
        enabled_value = enabled_value.lower() not in ('false', '0', 'no')

    return {
        'topic': topic,
        'clientId': client_id,
        'username': username,
        'location': location,
        'enabled': bool(enabled_value),
    }


def _read_sensor_registry_entries():
    raw = SystemSetting.objects.filter(key=SENSOR_REGISTRY_KEY).values_list('value', flat=True).first()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                entries = []
                seen = set()
                for item in data:
                    entry = _normalize_sensor_registry_item(item)
                    if not entry:
                        continue
                    topic = entry['topic']
                    if topic in seen:
                        continue
                    seen.add(topic)
                    entries.append(entry)
                if entries:
                    return entries
        except Exception as e:
            logger.debug('Failed parsing sensor registry', exc_info=e)
    return [
        {
            'topic': topic,
            'clientId': '',
            'username': '',
            'location': 'Manggarai',
            'enabled': True,
        }
        for topic in DEFAULT_SENSOR_TOPICS
    ]


def _read_sensor_registry():
    return [entry['topic'] for entry in _read_sensor_registry_entries()]


def _save_sensor_registry(entries):
    cleaned = []
    seen = set()
    for item in entries or []:
        entry = _normalize_sensor_registry_item(item)
        if not entry:
            continue
        topic = entry['topic']
        if topic in seen:
            continue
        seen.add(topic)
        cleaned.append(entry)
    SystemSetting.objects.update_or_create(key=SENSOR_REGISTRY_KEY, defaults={'value': json.dumps(cleaned)})
    return cleaned


def _register_sensor_topic(topic, client_id='', username='', location='', enabled=True):
    entries = _read_sensor_registry_entries()
    updated = []
    found = False
    for entry in entries:
        if entry['topic'] == topic:
            found = True
            if client_id:
                entry['clientId'] = client_id
            if username:
                entry['username'] = username
            if location:
                entry['location'] = location
            entry['enabled'] = bool(enabled)
        updated.append(entry)
    if not found:
        updated.append({
            'topic': topic,
            'clientId': client_id,
            'username': username,
            'location': location or 'Manggarai',
            'enabled': bool(enabled),
        })
    return _save_sensor_registry(updated)


def add_activity_log(user_name, action):
    entries = _read_json_setting('logs_activity', [])
    entries.insert(0, {
        'id': int(timezone.now().timestamp() * 1000),
        'user': user_name or 'system',
        'action': action,
        'timestamp': timezone.localtime(timezone.now()).strftime('%d-%m-%Y %H:%M'),
    })
    _write_json_setting('logs_activity', entries[:200])


def add_error_log(error_message, severity='Low'):
    entries = _read_json_setting('logs_errors', [])
    entries.insert(0, {
        'id': int(timezone.now().timestamp() * 1000),
        'error': error_message,
        'severity': severity,
        'timestamp': timezone.localtime(timezone.now()).strftime('%d-%m-%Y %H:%M'),
    })
    _write_json_setting('logs_errors', entries[:200])


@api_view(["POST"])
def ingest(request):
    """Receive MQTT sensor reading from Node.js server and save to database"""
    try:
        data = request.data
        
        # Validate required fields
        required = ['topic', 'value', 'location', 'raw', 'timestamp']
        if not all(field in data for field in required):
            return Response(
                {"error": "Missing required fields", "required": required},
                status=rf_status.HTTP_400_BAD_REQUEST
            )
        
        # parse incoming timestamp if provided
        ts = None
        if data.get('timestamp'):
            try:
                ts = parse_datetime(data.get('timestamp'))
            except Exception as e:
                logger.debug('Failed to parse incoming timestamp: %s', data.get('timestamp'), exc_info=e)
                ts = None
        if ts is None:
            ts = timezone.now()
        # ensure tz-aware
        if timezone.is_naive(ts):
            ts = timezone.make_aware(ts, timezone.get_current_timezone())

        # Create sensor reading
        reading = SensorReading.objects.create(
            topic=data['topic'],
            value=data['value'],
            location=data['location'],
            raw=data['raw'],
            timestamp=ts
        )

        try:
            alert_status = _topic_alert_level(reading.topic, reading.value)
            _send_sensor_alert(reading, alert_status)
        except Exception as alert_error:
            logger.exception('Failed to send sensor alert')
            add_error_log(f"Sensor alert failed for {reading.topic}: {str(alert_error)}", severity='High')

        # broadcast realtime update to websocket subscribers
        channel_layer = get_channel_layer()
        if channel_layer:
            payload = SensorReadingSerializer(reading).data
            async_to_sync(channel_layer.group_send)(
                "monitoring_monitoring",
                {
                    "type": "mqtt_update",
                    "data": payload,
                },
            )

        return Response({"status": "success", "id": reading.id}, status=rf_status.HTTP_201_CREATED)
    except Exception as e:
            return Response(
                {"error": str(e)},
                status=rf_status.HTTP_400_BAD_REQUEST
            )


@api_view(["GET"])
def realtime(request):
    """Get latest sensor reading for each topic"""
    latest = {}
    for topic in _read_sensor_registry():
        reading = SensorReading.objects.filter(topic=topic).order_by('-timestamp').first()
        latest[topic] = SensorReadingSerializer(reading).data if reading else None
    return Response({"latest": latest})


@api_view(["GET"])
def historical(request):
    """Get historical sensor readings with optional filtering"""
    qs = SensorReading.objects.all().order_by('timestamp')
    granularity = (request.query_params.get('granularity') or 'minute').strip().lower()
    
    # Filter by date range
    date_from = request.query_params.get('dateFrom')
    date_to = request.query_params.get('dateTo')
    
    if date_from:
        from_date = parse_date(date_from)
        if from_date:
            qs = qs.filter(timestamp__date__gte=from_date)
    
    if date_to:
        to_date = parse_date(date_to)
        if to_date:
            qs = qs.filter(timestamp__date__lte=to_date)
    
    # Filter by location
    location = request.query_params.get('location')
    if location and location != 'all':
        qs = qs.filter(location=location)
    
    # Filter by topic
    topic = request.query_params.get('topic')
    if topic:
        qs = qs.filter(topic=topic)
    
    # Collapse repeated readings into one row per minute by default.
    if granularity == 'raw':
        limit = min(int(request.query_params.get('limit', 500)), 1000)
        return Response(SensorReadingSerializer(qs.order_by('-timestamp')[:limit], many=True).data)

    grouped = {}
    for reading in qs:
        bucket_timestamp = reading.timestamp.replace(second=0, microsecond=0)
        bucket_key = (reading.topic, reading.location, bucket_timestamp)
        current = grouped.get(bucket_key)
        if current is None or reading.timestamp >= current.timestamp:
            grouped[bucket_key] = reading

    aggregated = sorted(grouped.values(), key=lambda item: item.timestamp, reverse=True)
    limit = min(int(request.query_params.get('limit', 500)), 1000)
    return Response(SensorReadingSerializer(aggregated[:limit], many=True).data)


@api_view(["GET"])
def topics(request):
    """Get available topics and metadata"""
    entries = _read_sensor_registry_entries()
    return Response(
        {
            "topics": [entry['topic'] for entry in entries],
            "sensors": entries,
            "location": SystemSetting.objects.filter(key='default_sensor_location').values_list('value', flat=True).first() or "Manggarai",
        }
    )


@api_view(["GET", "POST"])
def admin_users(request):
    # require auth
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        current_user = MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    if request.method == 'GET':
        users = MonitoringUser.objects.all().order_by('-created_at')
        return Response(MonitoringUserSerializer(users, many=True).data)
    # POST - create
    data = request.data
    email = data.get('email')
    name = data.get('name')
    password = data.get('password')
    if not email or not name or not password:
        return Response({"error": "email, name, password required"}, status=rf_status.HTTP_400_BAD_REQUEST)
    if MonitoringUser.objects.filter(email__iexact=email).exists():
        return Response({"error": "email exists"}, status=rf_status.HTTP_400_BAD_REQUEST)
    try:
        validate_password(password)
    except ValidationError as ve:
        return Response({"error": list(ve.messages)}, status=rf_status.HTTP_400_BAD_REQUEST)
    user = MonitoringUser.objects.create(email=email.lower(), name=name, password_hash=make_password(password))
    add_activity_log(current_user.name, f"Created user {user.email}")
    return Response(MonitoringUserSerializer(user).data, status=rf_status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
def admin_user_detail(request, user_id):
    try:
        user = MonitoringUser.objects.get(id=user_id)
    except MonitoringUser.DoesNotExist:
        return Response({"error": "not found"}, status=rf_status.HTTP_404_NOT_FOUND)
    # auth
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    if request.method == 'GET':
        return Response(MonitoringUserSerializer(user).data)
    if request.method == 'PUT':
        data = request.data
        user.name = data.get('name', user.name)
        role = data.get('role')
        if role in dict(MonitoringUser.ROLE_CHOICES):
            user.role = role
        email = data.get('email')
        if email and email.lower() != user.email:
            if MonitoringUser.objects.filter(email__iexact=email).exclude(id=user.id).exists():
                return Response({"error": "email exists"}, status=rf_status.HTTP_400_BAD_REQUEST)
            user.email = email.lower()
        if 'password' in data and data.get('password'):
            try:
                validate_password(data.get('password'))
            except ValidationError as ve:
                return Response({"error": list(ve.messages)}, status=rf_status.HTTP_400_BAD_REQUEST)
            user.password_hash = make_password(data.get('password'))
        user.save()
        add_activity_log('admin', f"Updated user {user.email}")
        return Response(MonitoringUserSerializer(user).data)
    if request.method == 'DELETE':
        add_activity_log('admin', f"Deleted user {user.email}")
        user.delete()
        return Response({"status": "deleted"})


@api_view(["GET", "POST"])
def admin_settings(request):
    # auth
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    if request.method == 'GET':
        items = SystemSetting.objects.all()
        return Response(SystemSettingSerializer(items, many=True).data)
    # POST to upsert
    data = request.data
    key = data.get('key')
    value = data.get('value')
    if not key:
        return Response({"error": "key required"}, status=rf_status.HTTP_400_BAD_REQUEST)
    item, created = SystemSetting.objects.update_or_create(key=key, defaults={'value': value or ''})
    add_activity_log('admin', f"Updated setting {key}")
    return Response(SystemSettingSerializer(item).data)


@api_view(["GET"])
def admin_sensors(request):
    # auth
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    # Return one row per expected sensor topic (no duplicates from historical readings).
    sensor_entries = _read_sensor_registry_entries()
    sensors = []
    for sensor_entry in sensor_entries:
        topic = sensor_entry['topic']
        last = SensorReading.objects.filter(topic=topic).order_by('-timestamp').first()
        status = 'Online' if last and sensor_entry.get('enabled', True) and (timezone.now() - last.timestamp).total_seconds() < 3600 else 'Offline'
        calibration_key = f"sensor_last_calibration_{topic}"
        location_key = f"sensor_location_{topic}"
        client_key = f"sensor_client_id_{topic}"
        username_key = f"sensor_username_{topic}"
        last_calibration = SystemSetting.objects.filter(key=calibration_key).values_list('value', flat=True).first()
        configured_location = SystemSetting.objects.filter(key=location_key).values_list('value', flat=True).first()
        configured_client_id = SystemSetting.objects.filter(key=client_key).values_list('value', flat=True).first()
        configured_username = SystemSetting.objects.filter(key=username_key).values_list('value', flat=True).first()
        enabled = sensor_entry.get('enabled', True)
        if not enabled:
            status = 'Disabled'
        sensors.append({
            'topic': topic,
            'location': configured_location or (last.location if last else 'Manggarai'),
            'clientId': configured_client_id or sensor_entry.get('clientId', ''),
            'username': configured_username or sensor_entry.get('username', ''),
            'status': status,
            'lastCalibration': last_calibration,
            'enabled': enabled,
        })
    return Response(sensors)


@api_view(["POST"])
def admin_sensor_calibrate(request):
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed for admin_sensor_calibrate', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    topic = (request.data or {}).get('topic')
    if not topic:
        return Response({'error': 'topic required'}, status=rf_status.HTTP_400_BAD_REQUEST)

    now_str = timezone.localtime(timezone.now()).strftime('%d-%m-%Y %H:%M')
    setting_key = f"sensor_last_calibration_{topic}"
    setting, _ = SystemSetting.objects.update_or_create(key=setting_key, defaults={'value': now_str})
    add_activity_log('admin', f"Calibrated sensor {topic}")
    return Response({'status': 'ok', 'topic': topic, 'lastCalibration': setting.value})


@api_view(["POST"])
def admin_sensor_configure(request):
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed for admin_sensor_configure', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    data = request.data or {}
    topic = data.get('topic')
    if not topic:
        return Response({'error': 'topic required'}, status=rf_status.HTTP_400_BAD_REQUEST)

    topic = str(topic).strip()
    if not topic:
        return Response({'error': 'topic required'}, status=rf_status.HTTP_400_BAD_REQUEST)

    enabled = data.get('enabled', True)
    location = (data.get('location') or '').strip()
    client_id = (data.get('clientId') or data.get('client_id') or '').strip()
    username = (data.get('username') or data.get('userName') or '').strip()
    if isinstance(enabled, str):
        enabled = enabled.lower() not in ('false', '0', 'no')
    _register_sensor_topic(topic, client_id=client_id, username=username, location=location, enabled=enabled)
    enabled_key = f"sensor_enabled_{topic}"
    client_key = f"sensor_client_id_{topic}"
    username_key = f"sensor_username_{topic}"
    SystemSetting.objects.update_or_create(key=enabled_key, defaults={'value': 'true' if enabled else 'false'})
    if client_id:
        SystemSetting.objects.update_or_create(key=client_key, defaults={'value': client_id})
    if username:
        SystemSetting.objects.update_or_create(key=username_key, defaults={'value': username})
    if location:
        location_key = f"sensor_location_{topic}"
        SystemSetting.objects.update_or_create(key=location_key, defaults={'value': location})
    add_activity_log('admin', f"Configured sensor {topic} (enabled={enabled}, location={location or 'unchanged'})")
    return Response({'status': 'ok', 'topic': topic, 'enabled': enabled, 'location': location, 'clientId': client_id, 'username': username})


@api_view(["GET", "POST"])
def admin_logs(request):
    # auth
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed for admin_logs', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    if request.method == 'GET':
        result = {
            'activity': _read_json_setting('logs_activity', []),
            'errors': _read_json_setting('logs_errors', []),
        }
        return Response(result)

    action = (request.data or {}).get('action')
    log_type = (request.data or {}).get('type', 'all')
    if action != 'clear':
        return Response({'error': 'unsupported action'}, status=rf_status.HTTP_400_BAD_REQUEST)

    if log_type in ('all', 'activity'):
        _write_json_setting('logs_activity', [])
    if log_type in ('all', 'errors'):
        _write_json_setting('logs_errors', [])
    return Response({'status': 'ok', 'cleared': log_type})


@csrf_exempt
@api_view(["POST"])
def signup(request):
    """Start signup by sending an OTP to the user's email."""
    try:
        data = request.data
        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return Response({"error": "email and password are required"}, status=rf_status.HTTP_400_BAD_REQUEST)

        if not email.lower().endswith('@kai.id'):
            return Response({"error": "Email must end with @kai.id"}, status=rf_status.HTTP_400_BAD_REQUEST)

        if MonitoringUser.objects.filter(email__iexact=email).exists():
            return Response({"error": "A user with that email already exists"}, status=rf_status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(password)
        except ValidationError as ve:
            return Response({"error": list(ve.messages)}, status=rf_status.HTTP_400_BAD_REQUEST)

        otp_code = _generate_otp_code()
        SignupOTP.objects.update_or_create(
            email=email.lower(),
            defaults={
                'password_hash': make_password(password),
                'otp_hash': make_password(otp_code),
                'expires_at': timezone.now() + timedelta(minutes=10),
            },
        )

        try:
            _send_signup_otp(email.lower(), otp_code)
        except Exception as exc:
            logger.debug('Failed sending signup OTP', exc_info=exc)
            return Response({"error": "Failed to send OTP email"}, status=rf_status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"status": "otp_sent", "message": "OTP sent to email", "expires_in_minutes": 10}, status=rf_status.HTTP_200_OK)
    except Exception as e:
        return Response({"error": str(e)}, status=rf_status.HTTP_400_BAD_REQUEST)


@csrf_exempt
@api_view(["POST"])
def signup_verify_otp(request):
    try:
        data = request.data
        email = data.get('email', '').strip().lower()
        otp = data.get('otp', '').strip()

        if not email or not otp:
            return Response({"error": "email and otp are required"}, status=rf_status.HTTP_400_BAD_REQUEST)

        try:
            pending = SignupOTP.objects.get(email__iexact=email)
        except SignupOTP.DoesNotExist:
            return Response({"error": "OTP not found or expired"}, status=rf_status.HTTP_400_BAD_REQUEST)

        if pending.expires_at < timezone.now():
            pending.delete()
            return Response({"error": "OTP expired"}, status=rf_status.HTTP_400_BAD_REQUEST)

        if not check_password(otp, pending.otp_hash):
            return Response({"error": "Invalid OTP"}, status=rf_status.HTTP_400_BAD_REQUEST)

        if MonitoringUser.objects.filter(email__iexact=email).exists():
            pending.delete()
            return Response({"error": "A user with that email already exists"}, status=rf_status.HTTP_400_BAD_REQUEST)

        user = MonitoringUser.objects.create(
            email=email,
            name=_build_display_name(email),
            password_hash=pending.password_hash,
        )
        pending.delete()
        return Response({"status": "success", "id": user.id}, status=rf_status.HTTP_201_CREATED)
    except Exception as e:
        return Response({"error": str(e)}, status=rf_status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
def login_view(request):
    """Authenticate MonitoringUser and return a signed token"""
    data = request.data
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    if not email or not password:
        return Response({"error": "email and password required"}, status=rf_status.HTTP_400_BAD_REQUEST)
    try:
        user = MonitoringUser.objects.get(email__iexact=email)
    except MonitoringUser.DoesNotExist:
        return Response({"error": "invalid credentials"}, status=rf_status.HTTP_400_BAD_REQUEST)
    if not check_password(password, user.password_hash):
        return Response({"error": "invalid credentials"}, status=rf_status.HTTP_400_BAD_REQUEST)

    # create a signed token with user id
    token = signing.dumps({'user_id': user.id}, salt='monitoring-auth')
    return Response({"token": token, "user": MonitoringUserSerializer(user).data})


@api_view(["POST"])
def admin_test_telegram(request):
    # auth
    auth_hdr = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth_hdr.startswith('Bearer '):
        return Response({'error': 'authentication required'}, status=rf_status.HTTP_401_UNAUTHORIZED)
    token = auth_hdr.split(' ', 1)[1]
    try:
        payload = signing.loads(token, salt='monitoring-auth')
        MonitoringUser.objects.get(id=payload.get('user_id'))
    except Exception as e:
        logger.debug('Token validation failed for admin_test_telegram', exc_info=e)
        return Response({'error': 'invalid token'}, status=rf_status.HTTP_401_UNAUTHORIZED)

    # Determine bot token and chat id: prefer request body, fallback to SystemSetting
    data = request.data or {}
    bot_token = data.get('bot_token')
    chat_id = data.get('chat_id')
    if not bot_token:
        try:
            bot_token = SystemSetting.objects.get(key='telegram_bot_token').value
        except Exception:
            bot_token = None
    if not chat_id:
        try:
            chat_id = SystemSetting.objects.get(key='telegram_chat_id').value
        except Exception:
            chat_id = None

    if not bot_token or not chat_id:
        return Response({'error': 'telegram_bot_token and telegram_chat_id must be configured'}, status=rf_status.HTTP_400_BAD_REQUEST)

    message = data.get('message') or 'Test alert from Flood Monitoring System'

    try:
        result = _send_telegram_message(bot_token, chat_id, message)
        add_activity_log('admin', 'Sent Telegram test message')
        return Response({'status': 'sent', 'result': result})
    except Exception as e:
        request_exception = requests.RequestException if requests is not None else tuple()
        if isinstance(e, request_exception) or isinstance(e, urllib_error.URLError) or isinstance(e, RuntimeError):
            logger.exception('Telegram request failed')
            add_error_log(f"Telegram request failed: {str(e)}", severity='High')
            return Response({'error': 'failed to send telegram message', 'details': str(e)}, status=rf_status.HTTP_502_BAD_GATEWAY)
        logger.exception('Failed to send telegram message')
        add_error_log(f"Telegram exception: {str(e)}", severity='High')
        return Response({'error': str(e)}, status=rf_status.HTTP_500_INTERNAL_SERVER_ERROR)
