"""Recuerda los ultimos ajustes para volver a aplicarlos (ventana o 'restaurar')."""

import json
from pathlib import Path

from .protocols import Settings

PATH = Path.home() / ".kalley_rgb.json"

COLOR_NAMES = {
    "rojo": (255, 0, 0), "verde": (0, 255, 0), "azul": (0, 0, 255),
    "blanco": (255, 255, 255), "amarillo": (255, 255, 0), "cian": (0, 255, 255),
    "morado": (160, 0, 255), "rosa": (255, 0, 160), "naranja": (255, 100, 0),
}


def parse_color(text):
    text = text.strip().lower()
    if text in COLOR_NAMES:
        return COLOR_NAMES[text]
    value = text.lstrip("#")
    if len(value) == 6:
        try:
            return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            pass
    raise ValueError(f"Color no válido '{text}'. Usa RRGGBB (ej. ff0000) "
                     f"o un nombre: {', '.join(COLOR_NAMES)}")


def color_hex(rgb):
    return "#%02x%02x%02x" % tuple(rgb)


def load():
    """Devuelve (vid_pid, protocolo, Settings) o None."""
    try:
        data = json.loads(PATH.read_text(encoding="utf-8"))
        settings = Settings(mode=data["mode"], color=tuple(data["color"]),
                            speed=int(data["speed"]), brightness=int(data["brightness"]))
        return data.get("device"), data.get("protocol"), settings
    except (OSError, ValueError, KeyError, TypeError):
        return None


def save(device_ids, protocol_id, settings):
    data = {"device": device_ids, "protocol": protocol_id, "mode": settings.mode,
            "color": list(settings.color), "speed": settings.speed,
            "brightness": settings.brightness}
    try:
        PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError:
        pass  # recordar es una comodidad, no debe impedir aplicar
