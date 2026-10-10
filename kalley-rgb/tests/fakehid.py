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


def sunplus_memory():
    """Memoria de 258 bytes con el formato que documenta spmctrl."""
    memory = bytearray((i * 7 + 3) & 0xFF for i in range(258))
    memory[0x06:0x0C] = bytes([0x03, 0x05, 0x08, 0x0B, 0x0B, 0x0B])  # 1000/1600/3200/6400
    memory[0x30], memory[0x31] = 0x01, 0xFE  # nivel DPI 2
    memory[0x32], memory[0x33] = 0x83, 0x7C  # arcoiris, velocidad 4
    return memory


class FakeSunplusChip:
    """Imita el chip Sunplus segun el protocolo de spmctrl: cada SET prepara la respuesta del GET."""

    def __init__(self, memory=None, echo_error_at=None, ignore_writes=False):
        self.memory = bytearray(sunplus_memory() if memory is None else memory)
        self.reply = bytes.fromhex("0400000037000100")  # lo que devolvio el raton en reposo
        self.echo_error_at = echo_error_at
        self.ignore_writes = ignore_writes
        self.reading = False
        self.read_pos = 0
        self.staged = None
        self.commits = 0
        self.log = []

    def _set_reply(self, *data):
        self.reply = bytes([0x04, *data]).ljust(7, b"\0") + b"\xcc"

    def send(self, data):
        cmd = data[1]
        self.log.append(cmd)
        if cmd == 0x01:
            self._set_reply(0xA6)
        elif cmd == 0x03:
            self._set_reply(0xAA, 0x0E, 0xFD)
        elif cmd == 0x04 and data[2] == 0x36:
            self.reading = False
            self._set_reply(0xAA, 0x0E, 0xFD)
        elif cmd == 0x04:
            self.reading, self.read_pos = True, 0
            self._set_reply(0xFF, 0xFF)
        elif cmd == 0x05 and self.reading:
            if self.read_pos >= len(self.memory):
                self.reply = bytes([0x04, 0, 0, 0, 0, 0, 0, 0xEE])
            else:
                self.reply = bytes([0x04]) + bytes(self.memory[self.read_pos:self.read_pos + 6]) + b"\xcc"
                self.read_pos += 6
        elif cmd == 0x05:
            self._set_reply(0xFF, 0xFF)
        elif cmd == 0x06:
            self.staged = bytearray()
            self._set_reply(0xAA, 0x0E, 0xFD)
        elif cmd == 0x07:
            chunk = bytearray(data[2:8])
            self.staged += chunk
            if self.echo_error_at is not None and len(self.staged) // 6 - 1 == self.echo_error_at:
                chunk[0] ^= 0xFF
            self.reply = bytes([0x04]) + bytes(chunk) + b"\xcc"
        elif cmd == 0x08:
            if self.staged is not None and len(self.staged) == len(self.memory) and not self.ignore_writes:
                self.memory[:] = self.staged
                self.commits += 1
            self.staged = None
            self.reading = False
            self.reply = bytes.fromhex("04 fd ff ff 00 00 00 cc")
        elif cmd == 0x02:
            self.reply = bytes.fromhex("04 fc 00 00 01 00 00 cc")


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
                    return list(fake.chips[self.path].reply[:length])
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
