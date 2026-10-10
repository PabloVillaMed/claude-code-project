"""Chip Sunplus SPCP19X (1bcf:08a0, el del Kalley K-GMOUSE6): leer y escribir su memoria.

Este chip no tiene comandos de luces sueltos: guarda toda la configuracion
(luces, DPI, botones, macros) en una memoria que se lee y se reescribe entera,
como hacen sus programas oficiales. La app solo cambia los bytes de luces.

Fuentes:
- Protocolo de transporte: https://github.com/jdev082/spmctrl (app "M8 Mouse").
- Mapa de memoria y checksums: SDK oficial de Havit (SunplusIT_19x.dll, que abre
  1bcf:08a0) y capturas USB de otros ratones con este chip (OpenRGB #3513, #4078).

Transporte: feature report 4 de 8 bytes [04, comando, datos...]. Cada SET va
seguido de un GET con la respuesta; el ultimo byte vale 0xCC cuando esta lista
(0x00 mientras el chip la prepara).
"""

import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path

REPORT_ID = 0x04
PACKET = 8
CHUNK = 6  # bytes de memoria por paquete
DELAY = 0.015  # el chip tarda ~14 ms en responder (medido en capturas)
POLL_DELAY = 0.01
POLLS = 10
SETTLE = 0.3  # pausa tras escribir antes de releer
RETRY_PAUSE = 1.0

DONE = 0xCC
PENDING = 0x00

CMD_OPEN, CMD_CLOSE, CMD_IDENT = 0x01, 0x02, 0x03
CMD_READ_AT, CMD_READ, CMD_WRITE_AT, CMD_WRITE, CMD_END = 0x04, 0x05, 0x06, 0x07, 0x08


@dataclass(frozen=True)
class Variant:
    """Version de firmware, segun las respuestas a los comandos 01 y 03."""

    name: str
    hello: int  # byte 1 de la respuesta a 01
    ident: bytes  # bytes 1..3 de la respuesta a 03
    size: int  # bytes de configuracion que se leen y escriben

    @property
    def chunks(self):
        return -(-self.size // CHUNK)

    @property
    def length(self):
        return (self.size & 0xFF, self.size >> 8)


VARIANTS = (
    Variant("256 B", 0xA6, bytes([0xAA, 0x0E, 0xFD]), 0x0FF),  # T60, Redgear A-15
    Variant("2 KB", 0xA4, bytes([0xAA, 0x1E, 0xFD]), 0x800),  # Rampage, Havit
)

# Mapa de memoria (SDK Havit 19X, confirmado con capturas de otros modelos).
LEVELS_ADDR = 0x02  # numero de niveles DPI activos (2..7)
BRIGHTNESS_ADDR, BRIGHTNESS_FULL = 0x03, 0x08  # bit 3: 1 = 100 %, 0 = 50 %
COLORS_ADDR, MAX_LEVELS = 0x1A, 7  # RGB de cada nivel DPI, usado por el efecto 1
DPI_ADDR = 0x30  # nivel DPI activo (0..6); complemento en 0x31
LED_ADDR = 0x32  # bits 0-2 efecto, bit 3 LED apagado, bits 5-7 velocidad; complemento en 0x33
LED_OFF_BIT = 0x08
# (inicio, posicion): checksum de memory[inicio:posicion] guardado en memory[posicion]
CHECKSUMS = ((0x00, 0x2F), (0x40, 0x76))

BACKUP_PATH = Path.home() / ".kalley_rgb_memoria_original.bin"


class SunplusError(RuntimeError):
    pass


class WriteInterrupted(SunplusError):
    """La escritura empezo (comando 06) y no termino: no hay que enviar el cierre."""


# ---- formato de la memoria --------------------------------------------------

def checksum(memory, start, end):
    return (sum(memory[start:end]) & 0xFF) ^ 0x5A


def speed_bits(speed):
    """Velocidad 1 (lenta) .. 8 (rapida) -> bits 5-7: 0xE0 .. 0x00."""
    return (8 - max(1, min(8, int(speed)))) << 5


def validate(memory, variant):
    """Comprueba que la memoria tiene la disposicion conocida antes de tocarla."""
    if len(memory) != variant.chunks * CHUNK:
        raise SunplusError(f"El ratón entregó {len(memory)} bytes en lugar de "
                           f"{variant.chunks * CHUNK}; no se modifica nada.")
    problems = []
    for start, pos in CHECKSUMS:
        if memory[pos] != checksum(memory, start, pos):
            problems.append(f"checksum en 0x{pos:02x}")
    for addr in (DPI_ADDR, LED_ADDR):
        if memory[addr] ^ memory[addr + 1] != 0xFF:
            problems.append(f"complemento en 0x{addr:02x}")
    if not 1 <= memory[LED_ADDR] & 0x07 <= 7:
        problems.append("efecto de luces")
    if memory[DPI_ADDR] > 6 or not 2 <= memory[LEVELS_ADDR] <= MAX_LEVELS:
        problems.append("niveles DPI")
    if problems:
        raise SunplusError("La memoria del ratón no tiene el formato conocido "
                           f"({', '.join(problems)}); no se modifica nada.")


def describe(memory):
    """Estado de las luces guardado en la memoria (para el diagnostico)."""
    led = memory[LED_ADDR]
    levels = memory[LEVELS_ADDR]
    colors = [memory[COLORS_ADDR + 3 * i:COLORS_ADDR + 3 * i + 3].hex()
              for i in range(min(levels, MAX_LEVELS))]
    return (f"efecto {led & 0x07}, velocidad {8 - (led >> 5)}, "
            f"{'apagado' if led & LED_OFF_BIT else 'encendido'}, "
            f"brillo {'100' if memory[BRIGHTNESS_ADDR] & BRIGHTNESS_FULL else '50'} %, "
            f"{levels} niveles DPI, colores DPI {' '.join(colors)}")


def edit(memory, mode, speed, brightness=None, color=None):
    """Nueva memoria con las luces cambiadas; el resto queda igual.

    brightness: 1 = 50 %, 2 = 100 %, None = sin cambios.
    color: (r, g, b) para todos los niveles DPI activos (lo usa el efecto 1).
    """
    updated = bytearray(memory)
    led = (memory[LED_ADDR] & 0x10) | (mode & 0x07) | speed_bits(speed)  # bit 3 = 0: encendido
    updated[LED_ADDR], updated[LED_ADDR + 1] = led, led ^ 0xFF
    if brightness is not None:
        if brightness >= 2:
            updated[BRIGHTNESS_ADDR] |= BRIGHTNESS_FULL
        else:
            updated[BRIGHTNESS_ADDR] &= ~BRIGHTNESS_FULL & 0xFF
    if color is not None:
        for i in range(min(memory[LEVELS_ADDR], MAX_LEVELS)):
            addr = COLORS_ADDR + 3 * i
            updated[addr:addr + 3] = bytes(c & 0xFF for c in color)
    start, pos = CHECKSUMS[0]
    updated[pos] = checksum(updated, start, pos)
    return bytes(updated)


def same_config(a, b, variant):
    return a[:variant.size] == b[:variant.size]


# ---- copia de seguridad --------------------------------------------------------

def save_backup_once(memory):
    """Guarda la primera memoria leida (la de fabrica) y nunca la sobrescribe."""
    if BACKUP_PATH.exists():
        return
    try:
        with open(BACKUP_PATH, "wb") as fh:
            fh.write(bytes(memory))
            fh.flush()
            os.fsync(fh.fileno())
        if BACKUP_PATH.read_bytes() != bytes(memory):
            raise OSError("la copia no coincide")
    except OSError as exc:
        raise SunplusError(f"No se pudo guardar la copia de seguridad en {BACKUP_PATH} "
                           f"({exc}); no se modifica nada.") from exc


def load_backup(variant):
    try:
        data = BACKUP_PATH.read_bytes()
    except OSError:
        raise SunplusError(f"No hay copia de seguridad en {BACKUP_PATH}.") from None
    validate(data, variant)
    return data


def backup_digest():
    try:
        return hashlib.sha256(BACKUP_PATH.read_bytes()).hexdigest()[:16]
    except OSError:
        return None


# ---- transporte -----------------------------------------------------------------

class SunplusLink:
    """Conversacion con el chip sobre un dispositivo HID ya abierto (coleccion del reporte 4)."""

    def __init__(self, device, delay=None, sleep=time.sleep):
        self.device = device
        self.delay = DELAY if delay is None else delay
        self.sleep = sleep
        self.sent = []
        self.handshake = None  # respuestas a 01 y 03 de la ultima sesion

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
        reply = self._get()
        for _ in range(POLLS):  # respuesta aun sin preparar: volver a pedirla, sin repetir el SET
            if reply[-1] != PENDING:
                break
            self.sleep(POLL_DELAY)
            reply = self._get()
        return reply

    def _open(self):
        hello = self._xfer(CMD_OPEN)
        ident = self._xfer(CMD_IDENT)
        self.handshake = (hello, ident)
        for variant in VARIANTS:
            if hello[1] == variant.hello and ident[1:4] == variant.ident:
                return variant
        return None

    def _close(self):
        self._xfer(CMD_END)
        self._xfer(CMD_CLOSE)

    def _close_quietly(self):
        try:
            self._close()
        except Exception:
            pass

    def read(self):
        """Lee la memoria completa. Devuelve (variante, bytes)."""
        try:
            variant = self._open()
            if variant is None:
                hello, ident = self.handshake
                raise SunplusError("El ratón respondió con una versión de firmware desconocida "
                                   f"({hello.hex(' ')} / {ident.hex(' ')}); solo lectura.")
            if self._xfer(CMD_READ_AT, 0, 0, *variant.length)[-1] != DONE:
                raise SunplusError("El ratón no aceptó la lectura de su memoria.")
            memory = bytearray()
            for i in range(variant.chunks):
                reply = self._xfer(CMD_READ)
                if reply[-1] != DONE:
                    raise SunplusError(f"Lectura interrumpida en el bloque {i + 1} de "
                                       f"{variant.chunks} ({reply.hex(' ')}).")
                memory += reply[1:1 + CHUNK]
        except Exception:
            self._close_quietly()  # nada se escribio: cerrar es seguro
            raise
        self._close()
        return variant, bytes(memory)

    def write(self, variant, memory):
        """Escribe la memoria completa. Ante un fallo tras empezar no envia el cierre."""
        if len(memory) != variant.chunks * CHUNK:
            raise SunplusError("Tamaño de memoria inválido; no se escribe nada.")
        try:
            if self._open() != variant:
                raise SunplusError("El ratón cambió de versión entre la lectura y la escritura.")
        except Exception:
            self._close_quietly()
            raise
        try:
            if self._xfer(CMD_WRITE_AT, 0, 0, *variant.length)[-1] != DONE:
                raise WriteInterrupted("El ratón no aceptó empezar la escritura.")
            for i in range(variant.chunks):
                chunk = bytes(memory[i * CHUNK:(i + 1) * CHUNK])
                reply = self._xfer(CMD_WRITE, *chunk)
                if reply[-1] != DONE or reply[1:1 + CHUNK] != chunk:
                    raise WriteInterrupted(f"El ratón no confirmó el bloque {i + 1} de "
                                           f"{variant.chunks} ({reply.hex(' ')}).")
        except WriteInterrupted:
            raise
        except (OSError, SunplusError) as exc:
            raise WriteInterrupted(f"Escritura interrumpida: {exc}") from exc
        self._close()


# ---- operaciones completas ------------------------------------------------------------

def read_validated(link):
    """Lee dos veces (deben coincidir) y valida. Devuelve (variante, memoria)."""
    variant, first = link.read()
    again, second = link.read()
    if again != variant or first != second:
        raise SunplusError("Dos lecturas seguidas de la memoria no coinciden; no se modifica nada.")
    validate(first, variant)
    return variant, first


def apply_settings(device, mode, speed, brightness=None, color=None, link=None):
    """Lee, valida, guarda copia, cambia solo las luces, escribe y verifica. Devuelve la memoria final."""
    link = link or SunplusLink(device)
    variant, original = read_validated(link)
    save_backup_once(original)
    updated = edit(original, mode, speed, brightness, color)
    if same_config(updated, original, variant):
        return original
    write_verified(link, variant, updated, fallback=original)
    return updated


def write_verified(link, variant, image, fallback=None):
    """Escribe `image` con reintentos y comprueba releyendo; si falla, intenta volver a `fallback`."""
    error = _write_with_retries(link, variant, image)
    if error is None:
        link.sleep(SETTLE)
        try:
            _, written = link.read()
        except SunplusError as exc:
            raise SunplusError(f"Se escribió la memoria, pero no se pudo comprobar: {exc}") from exc
        if same_config(written, image, variant):
            return
        error = SunplusError("El ratón no guardó los cambios como se esperaba.")
    if fallback is None:
        raise SunplusError(f"{error} No desconectes el ratón y vuelve a intentarlo.")
    if _write_with_retries(link, variant, fallback) is None:
        link.sleep(SETTLE)
        _, written = link.read()
        if same_config(written, fallback, variant):
            raise SunplusError(f"{error} Se volvió a escribir la configuración anterior.")
    raise SunplusError(f"{error} Tampoco se pudo volver a la configuración anterior: no "
                       "desconectes el ratón y ejecuta 'restaurar-memoria'.")


def _write_with_retries(link, variant, image, attempts=2):
    error = None
    for attempt in range(attempts):
        try:
            link.write(variant, image)
            return None
        except WriteInterrupted as exc:
            error = exc
            link.sleep(RETRY_PAUSE)
    return error


def restore_backup(device, link=None):
    """Reescribe la memoria original guardada antes del primer cambio."""
    link = link or SunplusLink(device)
    variant, current = link.read()
    backup = load_backup(variant)
    if same_config(backup, current, variant):
        return
    write_verified(link, variant, backup)
