"""Chip Sunplus SPCP19X (1bcf:08a0, el del Kalley K-GMOUSE6): leer y escribir su memoria.

Este chip no tiene comandos de luces sueltos: guarda toda la configuracion en
una memoria de 258 bytes que se descarga y se vuelve a subir entera. La app
solo cambia el byte de luces y su complemento; el resto se sube tal cual se leyo.

Protocolo tomado de https://github.com/jdev082/spmctrl (MIT), que replica la
app "M8 Mouse": feature report 4 de 8 bytes; cada SET va seguido, ~14 ms
despues, de un GET con la respuesta.
"""

import time
from pathlib import Path

REPORT_ID = 0x04
PACKET = 8
CHUNK = 6  # bytes de memoria por paquete
CHUNKS = 43
MEMORY_SIZE = CHUNK * CHUNKS
DELAY = 0.015  # spmctrl mide que el chip necesita 14-15 ms tras cada SET

DONE = 0xCC  # ultimo byte de una respuesta completa
END_OF_MEMORY = 0xEE

DPI_ADDR = 0x30  # nivel DPI activo (nibble bajo); complemento en 0x31
LED_ADDR = 0x32  # efecto (nibble bajo) y velocidad (nibble alto); complemento en 0x33
LED_MODES = range(1, 8)

BACKUP_PATH = Path.home() / ".kalley_rgb_memoria_original.bin"


class SunplusError(RuntimeError):
    pass


def speed_bits(speed):
    """Velocidad 1 (lenta) .. 8 (rapida) -> nibble alto 0xE0 .. 0x00."""
    return (8 - max(1, min(8, int(speed)))) << 5


def speed_from_bits(value):
    return 8 - ((value & 0xE0) >> 5)


def led_state(memory):
    """(efecto, velocidad) guardados, o SunplusError si la memoria no es la esperada."""
    validate(memory)
    value = memory[LED_ADDR]
    return value & 0x0F, speed_from_bits(value)


def validate(memory):
    """Comprueba que la memoria tiene la forma conocida antes de tocarla."""
    if len(memory) != MEMORY_SIZE:
        raise SunplusError(f"El ratón entregó {len(memory)} bytes de memoria en lugar de "
                           f"{MEMORY_SIZE}; no se modifica nada.")
    led, led_check = memory[LED_ADDR], memory[LED_ADDR + 1]
    dpi, dpi_check = memory[DPI_ADDR], memory[DPI_ADDR + 1]
    if led ^ led_check != 0xFF or (led & 0x0F) not in LED_MODES:
        raise SunplusError(f"El byte de luces no tiene el formato esperado "
                           f"({led:02x}/{led_check:02x}); no se modifica nada.")
    if (dpi ^ dpi_check) & 0x0F != 0x0F:
        raise SunplusError(f"El byte de DPI no tiene el formato esperado "
                           f"({dpi:02x}/{dpi_check:02x}); no se modifica nada.")


def with_led(memory, mode, speed):
    value = (mode & 0x0F) | speed_bits(speed)
    updated = bytearray(memory)
    updated[LED_ADDR] = value
    updated[LED_ADDR + 1] = value ^ 0xFF
    return bytes(updated)


def save_backup_once(memory):
    """Guarda la primera memoria leida (la de fabrica) y nunca la sobrescribe."""
    try:
        if not BACKUP_PATH.exists():
            BACKUP_PATH.write_bytes(bytes(memory))
    except OSError:
        pass


def load_backup():
    try:
        data = BACKUP_PATH.read_bytes()
    except OSError:
        raise SunplusError(f"No hay copia de seguridad en {BACKUP_PATH}.") from None
    validate(data)
    return data


class SunplusLink:
    """Conversacion con el chip sobre un dispositivo HID ya abierto."""

    def __init__(self, device, delay=None, sleep=time.sleep):
        self.device = device
        self.delay = DELAY if delay is None else delay
        self.sleep = sleep
        self.sent = []

    def _get(self):
        data = bytes(self.device.get_feature_report(REPORT_ID, PACKET))
        if len(data) != PACKET or data[0] != REPORT_ID:
            raise SunplusError(f"Respuesta inesperada del ratón: {data.hex(' ') or '(vacía)'}")
        return data

    def _xfer(self, *payload):
        packet = bytes([REPORT_ID, *payload]).ljust(PACKET, b"\0")
        self.device.send_feature_report(packet)
        self.sent.append(packet)
        self.sleep(self.delay)
        return self._get()

    def _handshake(self):
        self._xfer(0x01)
        self._xfer(0x03)

    def _hangup(self):
        for command in (0x08, 0x02):
            if self._xfer(command)[-1] != DONE:
                self._get()  # spmctrl: a veces la respuesta llega en un segundo GET

    def _hangup_quietly(self):
        try:
            self._hangup()
        except Exception:
            pass

    def _session(self, body):
        self._handshake()
        try:
            result = body()
        except Exception:
            self._hangup_quietly()
            raise
        self._hangup()
        return result

    def read_memory(self):
        def body():
            self._xfer(0x04, 0x36, 0x00, 0x02)
            self._xfer(0x05)
            self._xfer(0x04, 0x00, 0x00, 0xFF)
            memory = bytearray()
            for _ in range(CHUNKS):
                reply = self._xfer(0x05)
                if reply[-1] == END_OF_MEMORY:
                    break
                memory += reply[1:1 + CHUNK]
            return bytes(memory)
        return self._session(body)

    def write_memory(self, memory):
        if len(memory) != MEMORY_SIZE:
            raise SunplusError("Tamaño de memoria inválido; no se escribe nada.")

        def body():
            self._xfer(0x06, 0x00, 0x00, 0xFF)
            for i in range(CHUNKS):
                chunk = bytes(memory[i * CHUNK:(i + 1) * CHUNK])
                reply = self._xfer(0x07, *chunk)
                if reply[1:1 + CHUNK] != chunk:
                    raise SunplusError(f"El ratón no confirmó el bloque {i + 1} de {CHUNKS} "
                                       f"(envió {reply.hex(' ')}).")
        self._session(body)


def apply_led(device, mode, speed, link=None):
    """Lee la memoria, cambia solo las luces, escribe y comprueba. Devuelve la memoria final."""
    link = link or SunplusLink(device)
    original = link.read_memory()
    validate(original)
    save_backup_once(original)
    updated = with_led(original, mode, speed)
    if updated == original:
        return original
    try:
        link.write_memory(updated)
        written = link.read_memory()
    except SunplusError:
        _restore(link, original)
        raise
    if written != updated:
        _restore(link, original)
        raise SunplusError("El ratón no guardó los cambios como se esperaba; "
                           "se volvió a escribir su configuración anterior.")
    return written


def _restore(link, original):
    try:
        link.write_memory(original)
    except Exception:
        pass
