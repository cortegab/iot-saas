"""What may go into one MQTT topic segment (an actuator or metric key).

MQTT reserves `/` (level separator) and the `+`/`#` wildcards, and a NUL or
control character has no business in a topic. A name with any of them would
publish to the wrong topic, or make the broker client raise mid-loop, so they
are refused at every boundary that puts a name into a topic.
"""

import re

TOPIC_SEGMENT_PATTERN = r"^[^/+#\x00-\x1f\x7f]+$"
_SEGMENT = re.compile(TOPIC_SEGMENT_PATTERN)


def is_topic_segment(value: str) -> bool:
    return bool(_SEGMENT.match(value))
