"""MQTT bridge placeholder.

Later you can connect paho-mqtt here, persist readings to SensorReading,
and broadcast them to the websocket group.
"""

from dataclasses import dataclass


@dataclass
class MqttTopicMap:
    rain: str = "RAINSENSOR"
    water_level_kai: str = "WATERLEVELSENSORKAI"
    water_level_krl: str = "WATERLEVELSENSORKRL"


def get_default_topics() -> MqttTopicMap:
    return MqttTopicMap()
