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

from django.conf import settings
from django.core.mail import send_mail

from .models import SensorReading, MonitoringUser, SignupOTP, SystemSetting
from .serializers import (
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
    qs = SensorReading.objects.all().order_by('-timestamp')
    
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
    
    # Limit results
    limit = min(int(request.query_params.get('limit', 500)), 1000)
    qs = qs[:limit]
    
    return Response(SensorReadingSerializer(qs, many=True).data)


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

    if requests is None:
        return Response({'error': 'requests library not available on server'}, status=rf_status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        resp = requests.post(url, json={'chat_id': chat_id, 'text': message})
        if resp.status_code != 200:
            logger.debug('Telegram send failed: %s', resp.text)
            add_error_log(f"Telegram send failed: {resp.text}", severity='Medium')
            return Response({'error': 'failed to send telegram message', 'details': resp.text}, status=rf_status.HTTP_502_BAD_GATEWAY)
        add_activity_log('admin', 'Sent Telegram test message')
        return Response({'status': 'sent', 'result': resp.json()})
    except Exception as e:
        logger.exception('Failed to send telegram message')
        add_error_log(f"Telegram exception: {str(e)}", severity='High')
        return Response({'error': str(e)}, status=rf_status.HTTP_500_INTERNAL_SERVER_ERROR)
