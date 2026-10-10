import contextlib
import io
import unittest

from kalley_rgb import cli, descriptor, detect, diagnostics, hidio, protocols
from kalley_rgb.protocols import Settings

from tests import fakehid


class DescriptorTest(unittest.TestCase):
    def test_instant_config_interface(self):
        desc = descriptor.parse(fakehid.INSTANT_IF1)
        report = desc.feature(7)
        self.assertEqual((report.size, report.usage_page), (8, 0xFF01))
        self.assertEqual(desc.collections,
                         [(0x01, 0x06), (0x0C, 0x01), (0xFF00, 0x01), (0xFF01, 0x01), (0x01, 0x80)])
        inputs = {r.report_id: r.size for r in desc.reports if r.kind == "input"}
        self.assertEqual(inputs, {3: 8, 2: 3, 6: 3, 8: 2})

    def test_mouse_interface(self):
        desc = descriptor.parse(fakehid.INSTANT_IF0)
        self.assertEqual(desc.collections, [(0x01, 0x02)])
        self.assertIsNone(desc.feature(7))
        self.assertEqual([(r.report_id, r.kind, r.size) for r in desc.reports], [(1, "input", 7)])

    def test_truncated_descriptor_does_not_crash(self):
        descriptor.parse(fakehid.INSTANT_IF1[:-3])


def _device(vid, pid, collections):
    return hidio.Device(vid, pid, "", "Mouse", "", 0,
                        [hidio.Collection(*c) for c in collections])


class IdentifyTest(unittest.TestCase):
    if1 = descriptor.parse(fakehid.INSTANT_IF1)
    cols = [(b"a", 0, 1, 2), (b"b", 1, 0xFF01, 1)]

    def test_known_model(self):
        m = detect.identify(_device(0x30FA, 0x1440, self.cols))
        self.assertEqual((m.protocol.id, m.confidence), ("instant", "confirmado"))
        m = detect.identify(_device(0x04D9, 0xA070, self.cols))
        self.assertEqual((m.protocol.id, m.confidence), ("holtek-a070", "confirmado"))

    def test_instant_vendor_unknown_product(self):
        m = detect.identify(_device(0x30FA, 0x9999, self.cols))
        self.assertEqual((m.protocol.id, m.confidence), ("instant", "probable"))

    def test_unknown_vendor_with_config_report(self):
        m = detect.identify(_device(0x1234, 0x0001, self.cols), {b"b": (b"x", self.if1)})
        self.assertEqual((m.protocol.id, m.confidence), ("instant", "posible"))
        self.assertEqual(m.target_path(), b"b")

    def test_unknown_vendor_with_report_on_ff00_is_holtek_like(self):
        raw = fakehid.INSTANT_IF1.replace(bytes.fromhex("0601ff"), bytes.fromhex("0600ff"))
        m = detect.identify(_device(0x1234, 0x0001, self.cols), {b"b": (raw, descriptor.parse(raw))})
        self.assertEqual(m.protocol.id, "holtek-a070")

    def test_unknown_mouse(self):
        m = detect.identify(_device(0x1234, 0x0001, [(b"a", 0, 1, 2)]))
        self.assertIsNone(m.protocol)
        self.assertIsNone(m.target_path())

    def test_fallback_path_like_windows_collections(self):
        cols = [(b"col01", 0, 1, 2), (b"col02", 1, 1, 6), (b"col04", 1, 0xFF00, 1),
                (b"col05", 1, 0xFF01, 1)]
        m = detect.identify(_device(0x30FA, 0x1440, cols))
        self.assertEqual(m.target_path(), b"col05")
        self.assertEqual(m.target_path(protocols.get("holtek-a070")), b"col04")


class FakeDeviceTest(unittest.TestCase):
    def setUp(self):
        self.hid = fakehid.install(fakehid.FakeHid(
            fakehid.instant_entries(),
            {b"/dev/hidraw0": fakehid.INSTANT_IF0, b"/dev/hidraw1": fakehid.INSTANT_IF1},
            {(b"/dev/hidraw1", 7): bytes.fromhex("0700807d0802270a")}))

    def tearDown(self):
        fakehid.uninstall()

    def test_scan_groups_interfaces_and_targets_config_interface(self):
        matches = detect.scan()
        self.assertEqual(len(matches), 1)
        m = matches[0]
        self.assertEqual(m.device.ids, "30fa:1440")
        self.assertTrue(m.device.is_mouse)
        self.assertEqual(m.target_path(), b"/dev/hidraw1")

    def test_apply_sends_every_packet_to_config_interface(self):
        m = detect.scan()[0]
        settings = Settings("neon", speed=4, brightness=3)
        m.apply(settings)
        self.assertEqual(self.hid.sent,
                         [(b"/dev/hidraw1", p) for p in m.protocol.packets(settings)])

    def test_diagnostics_reads_but_never_writes(self):
        text = diagnostics.build_report()
        self.assertIn("30fa:1440", text)
        self.assertIn("GET_FEATURE 7: 07 00 80 7d 08 02 27 0a", text)
        self.assertIn("protocolo: instant [confirmado]", text)
        self.assertEqual(self.hid.sent, [])

    def test_cli_apply_and_off(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), _temp_config():
            self.assertEqual(cli.main(["aplicar", "estatico", "-c", "azul"]), 0)
            self.assertEqual(cli.main(["apagar"]), 0)
        sent = [p for _, p in self.hid.sent]
        self.assertIn(bytes.fromhex("0714000f00000000"), sent)  # zona 0, azul
        self.assertEqual(sent[-3], bytes.fromhex("071380d31b048002"))  # apagado
        self.assertIn("'Apagado'", out.getvalue())

    def test_cli_simulate_does_not_touch_device(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cli.main(["aplicar", "respiracion", "-p", "instant-a704", "-v", "6", "--simular"])
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue().split("\n")[0], "07 13 7f 15 00 00 00 00")
        self.assertEqual(self.hid.sent, [])

    def test_cli_restore(self):
        with contextlib.redirect_stdout(io.StringIO()), _temp_config():
            cli.main(["aplicar", "cometa", "-v", "7"])
            self.hid.sent.clear()
            self.assertEqual(cli.main(["restaurar"]), 0)
        self.assertEqual(self.hid.sent[0][1][3], 0x80 | (5 << 4) | 7)


@contextlib.contextmanager
def _temp_config():
    import tempfile
    from pathlib import Path
    from kalley_rgb import config
    old = config.PATH
    with tempfile.TemporaryDirectory() as tmp:
        config.PATH = Path(tmp) / "cfg.json"
        try:
            yield
        finally:
            config.PATH = old


if __name__ == "__main__":
    unittest.main()
