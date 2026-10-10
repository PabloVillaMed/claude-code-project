"""Protocolos de iluminacion de los chips que usan los ratones genericos.

Cada protocolo convierte unos ajustes (efecto, color, velocidad, brillo) en
la lista de "feature reports" de 8 bytes que hay que enviar. Generar los
paquetes no toca el hardware, asi que se puede probar y simular sin raton.

Fuentes del protocolo (ingenieria inversa publicada):
- Instant Microelectronics, firmware moderno (30fa:1440):
  https://github.com/NitronStudios/detox-open-mouse-drivers
- Instant A704/A704F (30fa:1701, 18f8:1286):
  https://github.com/AmberIsFrozen/Instant-A704F-Mouse-Utilities (SPECS.md)
- Holtek A070 (04d9:a070): OpenRGB, Controllers/HoltekController
- Sunplus SPCP19X (1bcf:08a0, Kalley K-GMOUSE6): https://github.com/jdev082/spmctrl
"""

import time
from dataclasses import dataclass

from . import sunplus

REPORT_ID = 0x07  # Instant y Holtek usan el reporte 7 de 8 bytes


@dataclass(frozen=True)
class Mode:
    key: str
    name: str
    code: int
    color: bool = False
    speed: bool = False
    brightness: bool = False


@dataclass
class Settings:
    mode: str
    color: tuple = (255, 0, 0)
    speed: int = 3
    brightness: int = 4


class Protocol:
    id = ""
    name = ""
    description = ""
    modes = ()
    off_mode = ""
    speed_range = (1, 1)
    brightness_range = (0, 0)
    report_id = REPORT_ID
    # Coleccion HID preferida: (interfaz, usage page). La deteccion por
    # descriptor tiene prioridad; esto es el respaldo.
    interface = 1
    usage_page = 0xFF00
    # True si el chip se configura leyendo y reescribiendo su memoria: no hay
    # una lista fija de paquetes y simular requiere el raton conectado.
    reads_memory = False

    def mode(self, key):
        for m in self.modes:
            if m.key == key:
                return m
        raise ValueError(f"El efecto '{key}' no existe en {self.name}. "
                         f"Opciones: {', '.join(m.key for m in self.modes)}")

    def default_settings(self):
        return Settings(mode=self.modes[0].key, speed=self.speed_range[1] // 2 or 1,
                        brightness=self.brightness_range[1])

    def packets(self, settings):
        raise NotImplementedError

    def apply(self, device, settings, delay=0.01):
        sent = []
        for packet in self.packets(settings):
            device.send_feature_report(packet)
            sent.append(packet)
            time.sleep(delay)
        return sent

    def _clamp(self, value, bounds):
        lo, hi = bounds
        return max(lo, min(hi, int(value)))


def _nibble(value):
    return (max(0, min(255, int(value))) * 15 + 127) // 255


class InstantProtocol(Protocol):
    """Firmware moderno de Instant: modo (0x13), color por zona (0x14) y fijado (0x18)."""

    id = "instant"
    name = "Instant Microelectronics"
    description = ("Chip de la mayoria de ratones 'USB GAMING MOUSE' baratos "
                   "(VID 30fa). 14 efectos, color de 4 bits por canal y 8 zonas.")
    speed_range = (1, 7)
    brightness_range = (0, 4)
    usage_page = 0xFF01
    zones = 8
    modes = (
        Mode("neon", "Neón (arcoíris fluido)", 6, speed=True, brightness=True),
        Mode("estatico", "Color fijo", 2, color=True, brightness=True),
        Mode("flujo-color", "Flujo de un color", 4, color=True, speed=True, brightness=True),
        Mode("respiracion", "Respiración multicolor", 1, speed=True, brightness=True),
        Mode("flujo", "Flujo multicolor", 3, speed=True, brightness=True),
        Mode("cometa", "Cometa", 5, speed=True, brightness=True),
        Mode("ambiente", "Luz ambiente", 7, speed=True, brightness=True),
        Mode("destellos", "Destellos", 8, speed=True, brightness=True),
        Mode("estrellas", "Estrellas", 9, speed=True, brightness=True),
        Mode("ondas", "Ondas", 10, speed=True, brightness=True),
        Mode("vaiven", "Vaivén entre lados", 11, speed=True, brightness=True),
        Mode("reactivo", "Reactivo al clic", 12, speed=True, brightness=True),
        Mode("dpi", "Respiración según DPI", 0, speed=True, brightness=True),
        Mode("apagado", "Apagado", 13),
    )
    off_mode = "apagado"
    _single_color_codes = (2, 4, 13)

    def packets(self, settings):
        mode = self.mode(settings.mode)
        speed = self._clamp(settings.speed, self.speed_range)
        brightness = self._clamp(settings.brightness, self.brightness_range)
        flag = 0x80 if mode.code in self._single_color_codes else 0xFF
        mode_packet = bytes([
            REPORT_ID, 0x13, flag,
            0x80 | ((mode.code & 0x07) << 4) | speed,
            0x1B,  # direccion de la animacion
            brightness,
            0x80 if mode.code >= 8 else 0x00,
            0x02,
        ])
        packets = []
        if mode.color:
            r, g, b = (_nibble(c) for c in settings.color)
            colors = [bytes([REPORT_ID, 0x14, (zone << 5) | g, (r << 4) | b, 0, 0, 0, 0])
                      for zone in range(self.zones)]
            # El software original repite los colores despues del modo:
            # el paquete de modo puede reiniciar la paleta.
            packets += colors + [mode_packet] + colors
        else:
            packets.append(mode_packet)
        # Fijar los registros (y guardarlos en el raton).
        packets.append(bytes([REPORT_ID, 0x18, 0x10, 0, 0, 0, 0, 0]))
        packets.append(bytes([REPORT_ID, 0x18, 0x00, 0, 0, 0, 0, 0]))
        return packets


class InstantA704Protocol(Protocol):
    """Chip Instant A704/A704F: colores fijos, solo velocidad, estatico y apagado."""

    id = "instant-a704"
    name = "Instant A704 / A704F"
    description = ("Version antigua del chip Instant. Recorre colores fijos; "
                   "permite cambiar la velocidad, dejarlo estático o apagarlo.")
    speed_range = (1, 6)
    usage_page = 0xFF01
    modes = (
        Mode("respiracion", "Respiración multicolor", 0x10, speed=True),
        Mode("estatico", "Estático", 0x16),
        Mode("apagado", "Apagado", 0x17),
    )
    off_mode = "apagado"

    def packets(self, settings):
        mode = self.mode(settings.mode)
        code = mode.code
        if mode.speed:
            # 0x10 = ciclo de 6 s (lento) ... 0x15 = ciclo de 1 s (rapido)
            code += self._clamp(settings.speed, self.speed_range) - 1
        return [bytes([REPORT_ID, 0x13, 0x7F, code, 0, 0, 0, 0])]


class HoltekA070Protocol(Protocol):
    """Chip Holtek A070: un solo color RGB de 8 bits, fijo o respirando."""

    id = "holtek-a070"
    name = "Holtek A070"
    description = ("Chip Holtek (VID 04d9). Un color RGB completo, fijo o en "
                   "respiración con 3 velocidades. El color se pierde al desconectar.")
    speed_range = (1, 3)
    usage_page = 0xFF00
    modes = (
        Mode("estatico", "Color fijo", 0x01, color=True),
        Mode("respiracion", "Respiración", 0x02, color=True, speed=True),
        Mode("apagado", "Apagado", 0x01),
    )
    off_mode = "apagado"

    def packets(self, settings):
        mode = self.mode(settings.mode)
        code = mode.code
        if mode.speed:
            code += self._clamp(settings.speed, self.speed_range) - 1
        r, g, b = (0, 0, 0) if mode.key == self.off_mode else settings.color
        return [
            bytes([REPORT_ID, 0x0B, 0x01, code, 0, 0, 0, 0]),
            bytes([REPORT_ID, 0x0A, 0x00, r & 0xFF, g & 0xFF, b & 0xFF, 0, 0]),
        ]


class SunplusProtocol(Protocol):
    """Chip Sunplus SPCP19X: efectos, velocidad, brillo y color guardados en la memoria del raton."""

    id = "sunplus"
    name = "Sunplus SPCP19X"
    description = ("Chip del Kalley K-GMOUSE6 (VID 1bcf). 6 efectos y color fijo, 8 velocidades "
                   "y brillo 50/100 %. Lee la memoria del ratón, cambia solo las luces y la "
                   "vuelve a escribir (tarda unos segundos).")
    report_id = sunplus.REPORT_ID
    interface = 0
    usage_page = 0xFF00
    speed_range = (1, 8)
    brightness_range = (1, 2)  # 1 = 50 %, 2 = 100 %
    reads_memory = True
    modes = (
        Mode("arcoiris", "Arcoíris", 3, speed=True, brightness=True),
        Mode("multicolor", "Multicolor", 2, speed=True, brightness=True),
        Mode("flujo", "Flujo", 4, speed=True, brightness=True),
        Mode("vals", "Vals", 5, speed=True, brightness=True),
        Mode("estaciones", "Cuatro estaciones", 6, speed=True, brightness=True),
        # El chip no tiene color fijo propio: es el efecto 1 (color del nivel DPI)
        # con el mismo color en todos los niveles.
        Mode("estatico", "Color fijo", 1, color=True, speed=True, brightness=True),
        Mode("dpi", "Color según DPI", 1, speed=True, brightness=True),
        Mode("apagado", "Apagado", 7),
    )
    off_mode = "apagado"

    def packets(self, settings):
        raise NotImplementedError("Este chip se configura a partir de su memoria; "
                                  "usa preview() con el ratón conectado.")

    def _edit_args(self, settings):
        mode = self.mode(settings.mode)
        return (mode.code, settings.speed,
                settings.brightness if mode.brightness else None,
                tuple(settings.color) if mode.color else None)

    def apply(self, device, settings, delay=None):
        link = sunplus.SunplusLink(device)
        sunplus.apply_settings(device, *self._edit_args(settings), link=link)
        return link.sent

    def preview(self, device, settings):
        """Bytes que cambiaria apply(), sin escribir nada: [(direccion, antes, despues)]."""
        variant, memory = sunplus.SunplusLink(device).read()
        sunplus.validate(memory, variant)
        updated = sunplus.edit(memory, *self._edit_args(settings))
        return [(i, a, b) for i, (a, b) in enumerate(zip(memory[:variant.size],
                                                         updated[:variant.size])) if a != b]


PROTOCOLS = {p.id: p for p in (SunplusProtocol(), InstantProtocol(), InstantA704Protocol(),
                               HoltekA070Protocol())}


def get(protocol_id):
    try:
        return PROTOCOLS[protocol_id]
    except KeyError:
        raise ValueError(f"Protocolo desconocido '{protocol_id}'. "
                         f"Opciones: {', '.join(PROTOCOLS)}") from None
