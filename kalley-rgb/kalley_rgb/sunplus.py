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
    tag: str  # para el nombre de la copia de seguridad
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
    Variant("256 B", "256", 0xA6, bytes([0xAA, 0x0E, 0xFD]), 0x0FF),  # T60, Redgear A-15
    Variant("2 KB", "2k", 0xA4, bytes([0xAA, 0x1E, 0xFD]), 0x800),  # Rampage, Havit
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
# Bytes que la app puede cambiar: brillo, colores DPI, checksum 0x2F y luces.
EDITABLE = {BRIGHTNESS_ADDR, *range(COLORS_ADDR, 0x30), LED_ADDR, LED_ADDR + 1}

BACKUP_DIR = Path.home() / ".kalley_rgb"
RECOVERY_HINT = ("No desconectes el ratón y pulsa 'Restaurar original' en la ventana "
                 "(o ejecuta: KalleyRGB.exe restaurar-memoria).")
PENDING_HINT = ("La última escritura en el ratón quedó a medias. Para no guardarla así, la app "
                "no lo lee hasta que pulses 'Restaurar original'.")


class SunplusError(RuntimeError):
    pass


class WriteInterrupted(SunplusError):
    """La escritura empezo (comando 06) y no termino: no hay que enviar el cierre (08)."""


class CloseUncertain(SunplusError):
    """Todos los bloques se confirmaron pero el cierre fallo: la relectura decide."""


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


def edit(memory, mode, speed=None, brightness=None, color=None):
    """Nueva memoria con las luces cambiadas; el resto queda igual.

    speed: 1..8, None = sin cambios. brightness: 1 = 50 %, 2 = 100 %, None = sin cambios.
    color: (r, g, b) para todos los niveles DPI activos (lo usa el efecto 1).
    """
    if not 1 <= mode <= 7:
        raise SunplusError(f"Efecto {mode} fuera de rango (1-7).")
    updated = bytearray(memory)
    speed_part = memory[LED_ADDR] & 0xE0 if speed is None else speed_bits(speed)
    led = (memory[LED_ADDR] & 0x10) | mode | speed_part  # bit 3 = 0: encendido
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


def _only_dpi_level_changed(a, b, variant):
    """El usuario pulso el boton DPI: solo cambian 0x30/0x31 y siguen siendo complementos."""
    changed = {i for i in range(variant.size) if a[i] != b[i]}
    return changed <= {DPI_ADDR, DPI_ADDR + 1} and b[DPI_ADDR] ^ b[DPI_ADDR + 1] == 0xFF


# ---- copia de seguridad --------------------------------------------------------

def backup_path(variant):
    return BACKUP_DIR / f"memoria-original-1bcf-08a0-{variant.tag}.bin"


def journal_path():
    """Existe mientras hay una escritura empezada (06) y sin cerrar (08), aunque la app se cierre."""
    return BACKUP_DIR / "escritura-en-curso"


def write_left_pending():
    return journal_path().exists()


def _set_journal(pending):
    try:
        if pending:
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            journal_path().write_text("1")
        else:
            journal_path().unlink(missing_ok=True)
    except OSError:
        pass


def _valid_backup(variant):
    try:
        data = backup_path(variant).read_bytes()
        validate(data, variant)
        return data
    except (OSError, SunplusError):
        return None


def save_backup_once(memory, variant):
    """Guarda la primera memoria leida y no la sustituye mientras siga siendo valida."""
    if _valid_backup(variant) is not None:
        return
    path = backup_path(variant)
    tmp = path.with_suffix(".tmp")
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        with open(tmp, "wb") as fh:
            fh.write(bytes(memory))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)  # atomico: nunca queda una copia a medias
        if path.read_bytes() != bytes(memory):
            raise OSError("la copia guardada no coincide")
    except OSError as exc:
        raise SunplusError(f"No se pudo guardar la copia de seguridad en {path} "
                           f"({exc}); no se modifica nada.") from exc


def load_backup(variant):
    data = _valid_backup(variant)
    if data is None:
        raise SunplusError(f"No hay una copia de seguridad válida en {backup_path(variant)}.")
    return data


def backup_info():
    """Copias existentes, para el diagnostico: [(variante, ruta, sha256 corto)]."""
    found = []
    for variant in VARIANTS:
        data = _valid_backup(variant)
        if data is not None:
            found.append((variant.name, backup_path(variant),
                          hashlib.sha256(data).hexdigest()[:16]))
    return found


# ---- transporte -----------------------------------------------------------------

class SunplusLink:
    """Conversacion con el chip sobre un dispositivo HID ya abierto (coleccion del reporte 4).

    Regla de seguridad: desde que se envia el 06 (empezar escritura) hasta que se envia
    el 08, `write_pending` es True y no se envia ningun cierre: un 08 con la escritura a
    medias podria guardarla. La unica salida es otra escritura completa.
    """

    def __init__(self, device, delay=None, sleep=time.sleep):
        self.device = device
        self.delay = DELAY if delay is None else delay
        self.sleep = sleep
        self.sent = []
        self.handshake = None  # respuestas a 01 y 03 de la ultima sesion
        self.write_pending = False
        self.writes_started = 0

    def _send(self, *payload):
        packet = bytes([REPORT_ID, *payload]).ljust(PACKET, b"\0")
        try:
            self.device.send_feature_report(packet)
        except OSError as exc:
            raise SunplusError(f"Se perdió la comunicación con el ratón ({exc}).") from exc
        self.sent.append(packet)

    def _get(self):
        try:
            data = bytes(self.device.get_feature_report(REPORT_ID, PACKET))
        except OSError as exc:
            raise SunplusError(f"Se perdió la comunicación con el ratón ({exc}).") from exc
        if len(data) != PACKET or data[0] != REPORT_ID:
            raise SunplusError(f"Respuesta inesperada del ratón: {data.hex(' ') or '(vacía)'}")
        return data

    def _reply(self):
        self.sleep(self.delay)
        reply = self._get()
        for _ in range(POLLS):  # respuesta aun sin preparar: volver a pedirla, sin repetir el SET
            if reply[-1] != PENDING:
                break
            self.sleep(POLL_DELAY)
            reply = self._get()
        return reply

    def _xfer(self, *payload):
        self._send(*payload)
        return self._reply()

    def _open(self):
        hello = self._xfer(CMD_OPEN)
        ident = self._xfer(CMD_IDENT)
        self.handshake = (hello, ident)
        if hello[-1] != DONE or ident[-1] != DONE:
            return None
        for variant in VARIANTS:
            if hello[1] == variant.hello and ident[1:4] == variant.ident:
                return variant
        return None

    def _close(self):
        self._send(CMD_END)
        if self.write_pending:  # el 08 ya salio: lo escrito queda completo
            self.write_pending = False
            _set_journal(False)
        self._reply()
        self._xfer(CMD_CLOSE)

    def _close_quietly(self):
        if self.write_pending:
            return  # nunca cerrar una escritura a medias
        try:
            self._close()
        except Exception:
            pass

    def read(self):
        """Lee la memoria completa. Devuelve (variante, bytes)."""
        if self.write_pending or write_left_pending():
            raise SunplusError(PENDING_HINT)
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

    def identify(self):
        """Solo el saludo (sin cierre): la variante, o None si no se reconoce."""
        return self._open()

    def write(self, variant, memory):
        """Escribe la memoria completa.

        WriteInterrupted: empezo y no termino (sin cierre). CloseUncertain: todos los bloques
        confirmados pero el cierre fallo. SunplusError: no se llego a empezar.
        """
        if len(memory) != variant.chunks * CHUNK:
            raise SunplusError("Tamaño de memoria inválido; no se escribe nada.")
        # En el camino de escritura nunca se cierra con 08 antes de escribir: si hubiera
        # una escritura anterior a medias (de esta u otra ejecucion), se guardaria.
        try:
            current = self._open()
            if current != variant:
                raise SunplusError("El ratón no respondió al saludo como antes.")
        except SunplusError as exc:
            if self.write_pending:
                raise WriteInterrupted(f"Escritura interrumpida: {exc}") from exc
            raise
        self.write_pending = True
        self.writes_started += 1
        _set_journal(True)
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
        except SunplusError as exc:
            raise WriteInterrupted(f"Escritura interrumpida: {exc}") from exc
        try:
            self._close()
        except SunplusError as exc:
            if self.write_pending:  # ni siquiera salio el 08
                raise WriteInterrupted(f"Escritura interrumpida al cerrar: {exc}") from exc
            raise CloseUncertain(f"El cierre de la escritura falló: {exc}") from exc


# ---- operaciones completas ------------------------------------------------------------

def read_validated(link):
    """Lee dos veces (deben coincidir) y valida. Devuelve (variante, memoria)."""
    variant, first = link.read()
    again, second = link.read()
    if again != variant or first != second:
        raise SunplusError("Dos lecturas seguidas de la memoria no coinciden (¿se pulsó un "
                           "botón del ratón?); no se modifica nada. Vuelve a intentarlo.")
    validate(first, variant)
    return variant, first


def apply_settings(device, mode, speed=None, brightness=None, color=None, link=None):
    """Lee, valida, guarda copia, cambia solo las luces, escribe y verifica. Devuelve la memoria final."""
    link = link or SunplusLink(device)
    variant, original = read_validated(link)
    save_backup_once(original, variant)
    updated = edit(original, mode, speed, brightness, color)
    validate(updated, variant)
    changed = {i for i in range(variant.size) if updated[i] != original[i]}
    if not changed <= EDITABLE:
        raise SunplusError("Error interno: la edición tocaría bytes que no son de luces; "
                           "no se modifica nada.")
    if not changed:
        return original
    write_verified(link, variant, updated, fallback=original)
    return updated


def write_verified(link, variant, image, fallback=None):
    """Escribe `image` con reintentos y comprueba releyendo; si falla, intenta volver a `fallback`."""
    error = _try_write(link, variant, image)
    if error is None:
        error = _verify(link, variant, image)
        if error is None:
            return
    if link.writes_started == 0:
        raise SunplusError(f"{error} No se modificó nada.")
    if fallback is None:
        raise SunplusError(f"{error} {RECOVERY_HINT}")
    if _try_write(link, variant, fallback) is None and _verify(link, variant, fallback) is None:
        raise SunplusError(f"{error} Se volvió a escribir la configuración anterior.")
    raise SunplusError(f"{error} Tampoco se pudo volver a la configuración anterior. {RECOVERY_HINT}")


def _try_write(link, variant, image, attempts=2):
    """None si la imagen se escribio entera (o el cierre quedo en duda); si no, el error."""
    error = None
    for _ in range(attempts):
        try:
            link.write(variant, image)
            return None
        except CloseUncertain:
            return None  # todos los bloques confirmados: la relectura decide
        except WriteInterrupted as exc:
            error = exc
        except SunplusError as exc:
            if link.writes_started == 0:
                return exc  # no se llego a escribir nada
            error = exc
        link.sleep(RETRY_PAUSE)
    return error


def _verify(link, variant, image):
    """None si el raton tiene `image` guardada; si no, el error."""
    link.sleep(SETTLE)
    try:
        _, written = link.read()
    except SunplusError as exc:
        return SunplusError(f"No se pudo comprobar lo escrito: {exc}")
    if same_config(written, image, variant) or _only_dpi_level_changed(image, written, variant):
        return None
    return SunplusError("El ratón no guardó los cambios como se esperaba.")


def restore_backup(device, link=None):
    """Reescribe la memoria original guardada antes del primer cambio.

    No empieza leyendo: una sesion de lectura termina con 08, que guardaria una escritura
    anterior a medias. Saluda, escribe la copia entera y despues comprueba.
    """
    if not backup_info():
        raise SunplusError(f"No hay copia de seguridad en {BACKUP_DIR}: la app todavía no "
                           "ha modificado este ratón.")
    link = link or SunplusLink(device)
    variant = link.identify()
    if variant is None:
        raise SunplusError("El ratón no respondió al saludo como un chip Sunplus conocido.")
    write_verified(link, variant, load_backup(variant))
