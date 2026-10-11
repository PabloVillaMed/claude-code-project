"""Sustituto del modulo `hid` para probar sin raton conectado."""

import sys
import types

# Descriptores reales de un raton con chip Instant (30fa:1030), sacados de
# una captura USB publicada en el issue 2496 de OpenRGB.
INSTANT_IF0 = bytes.fromhex(
    "05010902a10185010901a1000509190129051500250195057501810295017503810105010930"
    "093116018026ff7f75109502810609381581257f750895018106c0c0")
INSTANT_IF1 = bytes.fromhex(
    "05010906a1018503050719e029e71500250195087501810295067508150026ff000507190029"
    "e78100c0050c0901a101850219002a9c021500269c02950175108100c00600ff0901a1018506"
    "150026ff00092f950275088102c00601ff0901a1018507150026ff00092095077508b102c005"
    "010980a1018508198129831500250175019503810295058101c0")


def instant_entries(vid=0x30FA, pid=0x1440, product="USB GAMING MOUSE"):
    """Como lo enumera hidapi en Linux: una entrada por coleccion, ruta por interfaz."""
    base = {"vendor_id": vid, "product_id": pid, "serial_number": "",
            "manufacturer_string": "INSTANT", "product_string": product,
            "release_number": 0x0100}
    tlcs = [(b"/dev/hidraw0", 0, 0x01, 0x02), (b"/dev/hidraw1", 1, 0x01, 0x06),
            (b"/dev/hidraw1", 1, 0x0C, 0x01), (b"/dev/hidraw1", 1, 0xFF00, 0x01),
            (b"/dev/hidraw1", 1, 0xFF01, 0x01), (b"/dev/hidraw1", 1, 0x01, 0x80)]
    return [dict(base, path=p, interface_number=i, usage_page=up, usage=u)
            for p, i, up, u in tlcs]


def kalley_entries():
    """El Kalley K-GMOUSE6 (1bcf:08a0) tal como lo enumero Windows en el diagnostico del usuario."""
    base = {"vendor_id": 0x1BCF, "product_id": 0x08A0, "serial_number": "",
            "manufacturer_string": "", "product_string": "(Dispositivos de sistema estándar)",
            "release_number": 0x0104, "interface_number": 0}
    cols = [(b"col01", 0x01, 0x02), (b"col03", 0x0C, 0x01), (b"col04", 0xFF00, 0x01),
            (b"col05", 0xFF01, 0x01), (b"col02", 0x01, 0x06)]
    return [dict(base, path=p, usage_page=up, usage=u) for p, up, u in cols]


# Descriptores reconstruidos por hidapi en Windows (diagnostico del usuario).
KALLEY_DESCRIPTORS = {
    b"col01": bytes.fromhex(
        "05 01 09 02 a1 01 09 01 a1 00 85 01 05 09 19 01 29 05 15 00 25 01 75 01 95 05 81 02"
        "75 03 95 01 81 03 05 01 09 30 09 31 16 01 80 26 ff 7f 75 10 95 02 81 06 09 38 15 80"
        "25 7f 75 08 95 01 81 06 c0 c0"),
    b"col03": bytes.fromhex("05 0c 09 01 a1 01 85 03 19 00 2a ff 02 15 00 26 ff 02 75 10 95 01 81 00 c0"),
    b"col04": bytes.fromhex("06 00 ff 09 01 a1 01 85 04 19 00 29 06 15 00 26 ff 00 75 08 95 07 b1 02 c0"),
    b"col05": bytes.fromhex("06 01 ff 09 01 a1 01 85 05 19 00 29 04 15 00 26 ff 00 75 08 95 05 81 02 c0"),
    b"col02": bytes.fromhex(
        "05 01 09 06 a1 01 85 02 05 07 19 e0 29 e7 15 00 25 01 75 01 95 08 81 02 19 00 29 ff"
        "15 00 26 ff 00 75 08 95 06 81 00 05 08 19 01 29 05 15 00 25 01 75 01 95 05 91 02 75"
        "03 95 01 91 03 c0"),
}
# Coleccion 3 del touchpad ELAN del mismo PC: tiene un feature report 7, pero de 2 bytes.
ELAN_TOUCHPAD_COL03 = bytes.fromhex(
    "05 0d 09 05 a1 01 09 22 a1 02 85 04 09 47 09 42 15 00 25 01 75 01 95 02 81 02 75 02 95 01"
    "81 03 09 51 15 00 25 0f 75 04 95 01 81 02 05 01 09 30 15 00 26 c0 0d 35 00 46 b8 01 55 0e"
    "65 13 75 10 95 01 81 02 09 31 15 00 26 f8 06 35 00 46 df 00 75 10 95 01 81 02 c0 05 0d 09"
    "56 15 00 27 ff ff 00 00 35 00 47 ff ff 00 00 55 0c 66 01 10 75 10 95 01 81 02 09 54 15 00"
    "25 7f 75 08 95 01 81 02 05 09 09 01 15 00 25 01 75 01 95 01 45 00 55 00 65 00 81 02 75 07"
    "95 01 81 03 09 c5 15 00 25 01 35 00 47 ff ff 00 00 55 0c 66 01 10 75 08 95 02 81 03 85 02"
    "05 0d 09 55 09 59 15 00 25 0f 75 04 95 02 b1 02 85 07 09 60 15 00 25 01 75 01 95 01 45 00"
    "55 00 65 00 b1 02 75 07 95 01 b1 03 85 06 06 00 ff 09 c5 15 00 26 ff 00 35 00 47 ff ff 00"
    "00 55 0c 66 01 10 75 08 96 00 01 b1 02 c0")


def elan_entries():
    base = {"vendor_id": 0x04F3, "product_id": 0x30ED, "serial_number": "9999",
            "manufacturer_string": "Microsoft", "product_string": "HIDI2C Device",
            "release_number": 1, "interface_number": -1}
    cols = [(b"elan1", 0x01, 0x02), (b"elan3", 0x0D, 0x05)]
    return [dict(base, path=p, usage_page=up, usage=u) for p, up, u in cols]


# Imagen real de 258 bytes de un Redgear A-15 (1bcf:08a0, variante de 256 B), reconstruida de
# la captura USB del issue 4078 de OpenRGB. Checksums 0x2F/0x76/0xFA validos; los 3 ultimos
# bytes son relleno fuera de la longitud pedida (0xFF).
REDGEAR_MEMORY = bytes.fromhex(
    "45 f8 06 30 ff 00 00 04 05 09 07 06 07 01 04 03 00 02 05 06 ff 00 7f ff ff ff ff ff ff ff 00 ff"
    "00 00 ff ff 00 00 e1 e1 1a 09 fa 05 ff ff ff 58 01 fe 02 fd 00 ff ff ff ff ff ff ff fe ff ff ff"
    "01 01 00 01 04 00 01 02 00 02 08 07 03 00 cd 05 00 00 03 00 b5 03 00 b6 06 00 f0 01 01 00 01 04"
    "00 01 02 00 02 00 0b 02 00 14 05 00 00 05 00 00 0f 00 00 06 00 f0 c9 ff fe ff ff ff ff ff fe 99"
    "0e 05 01 0e 05 19 0e 05 31 0e 05 49 0e 05 61 0e 05 79 0e 05 91 0e 05 a9 0e 05 c1 0e 05 d9 ff ff"
    "ff ff ff ff ff ff ff ff fe ff ff ff ff ff fd ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff"
    "00 ff 00 ff ff ff fe ff ff ff ff ff fd ff ff ff ff 00 00 00 ff 00 00 00 ff ff ff 00 ff 00 ff 00"
    "ff ff ff 80 00 ff 00 80 00 ff 80 ff ff ff ff ff 0a fd ff a1 fe 03 21 fe 06 fc 93 ff fd ff ff fc"
    "93 ff")


def memory_2k():
    """Variante de 2 KB (342 bloques): misma cabecera y el resto (macros) a cero."""
    return REDGEAR_MEMORY[:0xFF] + bytes(342 * 6 - 0xFF)


class FakeSunplusChip:
    """Imita el chip Sunplus como en las capturas: cada SET prepara la respuesta del GET.

    Modelo pesimista: los 07 escriben al momento en la RAM (una lectura en la misma sesion
    ve lo escrito, como en la captura del Rampage), el 01 NO descarta una escritura a medias
    y el 08 guarda en la flash lo que haya en la RAM. Asi cualquier 08 enviado con una
    escritura incompleta queda registrado en partial_commits.

    pending: cuantos GET devuelven "aun no lista" (byte 7 = 0x00, datos viejos) tras cada SET.
    echo_errors: cuantas escrituras de bloque fallan (eco alterado), contando desde echo_error_at.
    bad_open_after_echo_error: tras un eco fallido, cuantos saludos 01 contestan mal.
    ignore_writes: el chip contesta bien pero el 08 no guarda nada.
    """

    IDLE = bytes.fromhex("04 00 00 00 37 00 01 00")  # lo que devolvio el Kalley en reposo

    def __init__(self, variant="256", memory=None, pending=0, echo_error_at=None,
                 echo_errors=1, ignore_writes=False, change_after_reads=None, hello=None,
                 bad_open_after_echo_error=0, fail_close=0):
        self.size, default_hello, self.ident = ((0xFF, 0xA6, 0x0E) if variant == "256"
                                                else (0x800, 0xA4, 0x1E))
        self.hello = default_hello if hello is None else hello
        if memory is None:
            memory = REDGEAR_MEMORY if variant == "256" else memory_2k()
        self.memory = bytearray(memory)  # flash: lo que sobrevive a desconectar
        self.ram = bytearray(memory)
        self.pending = pending
        self.echo_error_at = echo_error_at
        self.echo_errors = echo_errors
        self.ignore_writes = ignore_writes
        self.change_after_reads = change_after_reads
        self.bad_opens = 0
        self.bad_open_after_echo_error = bad_open_after_echo_error
        self.fail_close = fail_close  # cierres de escritura (08) cuya respuesta falla
        self.fail_next_get = False
        self.reads_done = 0
        self.reply = self.IDLE
        self.pending_left = 0
        self.read_pos = None
        self.write_pos = None
        self.write_len = None
        self.written = 0
        self.commits = 0
        self.partial_commits = 0
        self.log = []

    def get(self):
        if self.pending_left:
            self.pending_left -= 1
            return self.IDLE
        if self.fail_next_get:
            self.fail_next_get = False
            raise OSError("read error")
        return self.reply

    def _reply(self, *data):
        self.reply = bytes([0x04, *data]).ljust(7, b"\0") + b"\xcc"

    def replug(self):
        """Desconectar y conectar: se pierde la RAM y lo que estuviera a medias."""
        self.ram[:] = self.memory
        self.write_len = self.read_pos = None

    def send(self, data):
        cmd = data[1]
        self.log.append(cmd)
        self.pending_left = self.pending
        if cmd == 0x01:
            if self.bad_opens:
                self.bad_opens -= 1
                self.reply = bytes([0x04, 0x07, 0, 0, 0, 0, 0, 0xCC])  # eco viejo, no el saludo
            else:
                self._reply(self.hello, 0, 0, 0, 0x93, 0)
        elif cmd == 0x03:
            self._reply(0xAA, self.ident, 0xFD, 0, 0x93, 0)
        elif cmd == 0x04:
            self.read_pos = data[2] | data[3] << 8
            self._reply()
        elif cmd == 0x05 and self.read_pos is not None:
            chunk = bytes(self.ram[self.read_pos:self.read_pos + 6])
            chunk += bytes.fromhex("fc 93 ff fc 93 ff")[:6 - len(chunk)]
            self.read_pos += 6
            if self.read_pos >= len(self.ram):
                self.reads_done += 1
                if self.change_after_reads == self.reads_done:
                    for mem in (self.memory, self.ram):  # alguien pulso el boton DPI
                        mem[0x30], mem[0x31] = 0x02, 0xFD
            self.reply = b"\x04" + chunk + b"\xcc"
        elif cmd == 0x06:
            self.write_pos = data[2] | data[3] << 8
            self.write_len = data[4] | data[5] << 8
            self.written = 0
            self._reply(0xAA, self.ident, 0xFD, 0, 0x93, 0)
        elif cmd == 0x07 and self.write_len is not None:
            chunk = bytearray(data[2:8])
            block = self.written // 6
            pos = self.write_pos + self.written
            self.ram[pos:pos + 6] = chunk[:max(0, min(6, len(self.ram) - pos))]
            self.written += 6
            if (self.echo_error_at is not None and self.echo_errors > 0
                    and block == self.echo_error_at):
                self.echo_errors -= 1
                self.bad_opens = self.bad_open_after_echo_error
                chunk[0] ^= 0xFF
            self.reply = b"\x04" + bytes(chunk) + b"\xcc"
        elif cmd == 0x08:
            if self.write_len is not None and self.fail_close:
                self.fail_close -= 1
                self.fail_next_get = True
            if self.write_len is not None:
                if self.written < self.write_len:
                    self.partial_commits += 1
                if self.ignore_writes:
                    self.ram[:] = self.memory
                else:
                    self.commits += 1
            if not self.ignore_writes:
                self.memory[:] = self.ram
            self.write_len = self.read_pos = None
            self.reply = bytes.fromhex("04 fd 00 00 fc 93 ff cc")
            self.pending_left = max(self.pending_left, 1)  # como el Redgear: primero sin terminar
        elif cmd == 0x02:
            self.reply = bytes.fromhex("04 fb 00 00 fc 93 39 cc")


class FakeHid(types.ModuleType):
    def __init__(self, entries, descriptors, feature_replies=None, chips=None):
        super().__init__("hid")
        self.entries = entries
        self.descriptors = descriptors
        self.feature_replies = feature_replies or {}
        self.chips = chips or {}  # ruta -> objeto con send(data) y reply (p. ej. FakeSunplusChip)
        self.sent = []  # (ruta, bytes)
        self.version_str = "fake"
        fake = self

        class device:
            def open_path(self, path):
                if path not in fake.descriptors and path not in {e["path"] for e in fake.entries}:
                    raise OSError("no existe")
                self.path = path

            def get_report_descriptor(self, max_length=4096):
                return list(fake.descriptors.get(self.path, b""))

            def send_feature_report(self, data):
                fake.sent.append((self.path, bytes(data)))
                if self.path in fake.chips:
                    fake.chips[self.path].send(bytes(data))
                return len(data)

            def get_feature_report(self, report_id, length):
                if self.path in fake.chips:
                    return list(fake.chips[self.path].get()[:length])
                return list(fake.feature_replies.get((self.path, report_id), bytes([report_id])))

            def close(self):
                pass

        self.device = device

    def enumerate(self, vid=0, pid=0):
        return [dict(e) for e in self.entries]


def install(fake):
    sys.modules["hid"] = fake
    return fake


def uninstall():
    sys.modules.pop("hid", None)
