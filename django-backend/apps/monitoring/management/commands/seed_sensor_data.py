from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
import random
from apps.monitoring.models import SensorReading


class Command(BaseCommand):
    help = "Generate sample sensor data for testing"

    def add_arguments(self, parser):
        parser.add_argument(
            '--count',
            type=int,
            default=50,
            help='Number of sample data points to generate per topic'
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear existing data before generating'
        )

    def handle(self, *args, **options):
        count = options['count']
        
        if options['clear']:
            SensorReading.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("✓ Cleared existing data"))

        topics = [
            {"topic": "RAINSENSOR", "location": "Manggarai", "min": 0, "max": 15},
            {"topic": "WATERLEVELSENSORKAI", "location": "Manggarai", "min": 8, "max": 15},
            {"topic": "WATERLEVELSENSORKRL", "location": "Manggarai", "min": 1, "max": 5},
        ]

        now = timezone.now()
        readings = []

        for topic_info in topics:
            for i in range(count):
                # Spread data over the last 7 days
                timestamp = now - timedelta(days=random.randint(0, 6), hours=random.randint(0, 23), minutes=random.randint(0, 59))
                value = random.uniform(topic_info["min"], topic_info["max"])
                
                readings.append(SensorReading(
                    topic=topic_info["topic"],
                    location=topic_info["location"],
                    value=f"{value:.2f}",
                    raw=f"raw_{topic_info['topic']}_{i}",
                    timestamp=timestamp
                ))

        # Bulk create
        SensorReading.objects.bulk_create(readings)
        self.stdout.write(self.style.SUCCESS(f"✓ Generated {len(readings)} sample sensor readings"))
        
        # Show summary
        summary = {}
        for topic_info in topics:
            count = SensorReading.objects.filter(topic=topic_info["topic"]).count()
            summary[topic_info["topic"]] = count
        
        self.stdout.write(self.style.SUCCESS("Summary:"))
        for topic, cnt in summary.items():
            self.stdout.write(f"  {topic}: {cnt} readings")
