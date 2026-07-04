import json

from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import SensorReading
from .serializers import SensorReadingSerializer


class MonitoringConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = "monitoring"
        self.room_group_name = f"monitoring_{self.room_name}"

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()
        await self.send(text_data=json.dumps({
            "type": "subscription_confirmed",
            "message": "Connected to monitoring stream"
        }))

    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data=None, bytes_data=None):
        if text_data:
            try:
                data = json.loads(text_data)
                if data.get('type') == 'subscribe':
                    # Client subscribed, send confirmation
                    await self.send(text_data=json.dumps({
                        "type": "subscription_confirmed",
                        "message": "Ready for real-time updates"
                    }))
            except json.JSONDecodeError:
                pass

    # Handler for group message
    async def mqtt_update(self, event):
        """Broadcast MQTT update to WebSocket"""
        await self.send(text_data=json.dumps({
            "type": "mqtt_update",
            "data": event["data"]
        }))

    async def sensor_reading_update(self, event):
        """Broadcast sensor reading update"""
        await self.send(text_data=json.dumps({
            "type": "sensor_data",
            "data": event["data"]
        }))
