from apps.monitoring.models import SensorReading
from django.db.models import Count

total = SensorReading.objects.count()
print("Total: {}".format(total))

topics = SensorReading.objects.values("topic").annotate(count=Count("id")).order_by("topic")
for t in topics:
    print("  {}: {}".format(t["topic"], t["count"]))
