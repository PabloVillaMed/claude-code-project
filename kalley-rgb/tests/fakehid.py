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


class FakeHid(types.ModuleType):
    def __init__(self, entries, descriptors, feature_replies=None):
        super().__init__("hid")
        self.entries = entries
        self.descriptors = descriptors
        self.feature_replies = feature_replies or {}
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
                return len(data)

            def get_feature_report(self, report_id, length):
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
