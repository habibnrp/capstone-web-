import os, django, json
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import sys
sys.path.append('.')
django.setup()
from django.test import Client
from apps.monitoring.models import MonitoringUser

c = Client()
email='autotest_user@kai.id'
name='Auto Test'
password='Aut0TestPass!'
# Ensure clean state
MonitoringUser.objects.filter(email=email).delete()
resp = c.post('/api/monitoring/signup/', data=json.dumps({'name':name,'email':email,'password':password}), content_type='application/json')
print('STATUS', resp.status_code)
try:
    print('BODY', resp.json())
except Exception:
    print('BODY_RAW', resp.content.decode())
print('COUNT', MonitoringUser.objects.filter(email=email).count())
# cleanup
MonitoringUser.objects.filter(email=email).delete()
