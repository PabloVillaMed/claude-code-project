import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from kalley_rgb import cli, config, detect, diagnostics, protocols, sunplus
from kalley_rgb.protocols import Settings

from tests import fakehid


class FakeDevice:
    """Dispositivo HID abierto que habla con un FakeSunplusChip."""

    def __init__(self, chip):
        self.chip = chip
        self.sent = []

    def send_feature_report(self, data):
        self.sent.append(bytes(data))
        self.chip.send(bytes(data))
        return len(data)

    def get_feature_report(self, report_id, length):
        return list(self.chip.reply[:length])


def link(chip):
    return sunplus.SunplusLink(FakeDevice(chip), sleep=lambda s: None)


@contextlib.contextmanager
def temp_home():
    old_backup, old_config = sunplus.BACKUP_PATH, config.PATH
    with tempfile.TemporaryDirectory() as tmp:
        sunplus.BACKUP_PATH = Path(tmp) / "respaldo.bin"
        config.PATH = Path(tmp) / "cfg.json"
        try:
            yield Path(tmp)
        finally:
            sunplus.BACKUP_PATH, config.PATH = old_backup, old_config


class MemoryFormatTest(unittest.TestCase):
    def test_speed_encoding_matches_spmctrl(self):
        # spmctrl: velocidad 1 -> 0xE0 ... 8 -> 0x00
        self.assertEqual([sunplus.speed_bits(s) for s in range(1, 9)],
                         [0xE0, 0xC0, 0xA0, 0x80, 0x60, 0x40, 0x20, 0x00])
        self.assertEqual([sunplus.speed_from_bits(sunplus.speed_bits(s)) for s in range(1, 9)],
                         list(range(1, 9)))

    def test_with_led_changes_only_led_byte_and_complement(self):
        memory = bytes(fakehid.sunplus_memory())
        updated = sunplus.with_led(memory, 7, 2)
        diff = [i for i in range(len(memory)) if memory[i] != updated[i]]
        self.assertEqual(diff, [0x32, 0x33])
        self.assertEqual((updated[0x32], updated[0x33]), (0xC7, 0x38))
        self.assertEqual(sunplus.led_state(updated), (7, 2))

    def test_validate_rejects_unknown_formats(self):
        good = fakehid.sunplus_memory()
        sunplus.validate(bytes(good))
        cases = {"corto": bytes(good[:200])}
        bad = bytearray(good); bad[0x33] ^= 0x01; cases["complemento luces"] = bytes(bad)
        bad = bytearray(good); bad[0x32], bad[0x33] = 0x09, 0xF6; cases["efecto 9"] = bytes(bad)
        bad = bytearray(good); bad[0x31] = 0x00; cases["complemento DPI"] = bytes(bad)
        for name, memory in cases.items():
            with self.subTest(name), self.assertRaises(sunplus.SunplusError):
                sunplus.validate(memory)


class LinkTest(unittest.TestCase):
    def test_read_memory_follows_spmctrl_sequence(self):
        chip = fakehid.FakeSunplusChip()
        lk = link(chip)
        self.assertEqual(lk.read_memory(), bytes(chip.memory))
        commands = [p[1] for p in lk.sent]
        self.assertEqual(commands[:5], [0x01, 0x03, 0x04, 0x05, 0x04])
        self.assertEqual(lk.sent[2].hex(" "), "04 04 36 00 02 00 00 00")
        self.assertEqual(lk.sent[4].hex(" "), "04 04 00 00 ff 00 00 00")
        self.assertEqual(commands[5:5 + 43], [0x05] * 43)
        self.assertEqual(commands[-2:], [0x08, 0x02])
        self.assertTrue(all(len(p) == 8 and p[0] == 0x04 for p in lk.sent))

    def test_read_stops_at_end_marker(self):
        chip = fakehid.FakeSunplusChip(memory=fakehid.sunplus_memory()[:120])
        self.assertEqual(len(link(chip).read_memory()), 120)

    def test_write_memory_uploads_and_chip_commits(self):
        chip = fakehid.FakeSunplusChip()
        new = sunplus.with_led(bytes(chip.memory), 5, 6)
        lk = link(chip)
        lk.write_memory(new)
        self.assertEqual(bytes(chip.memory), new)
        uploads = [p for p in lk.sent if p[1] == 0x07]
        self.assertEqual(len(uploads), 43)
        self.assertEqual(uploads[0][2:], new[:6])

    def test_echo_mismatch_aborts_and_hangs_up(self):
        chip = fakehid.FakeSunplusChip(echo_error_at=10)
        lk = link(chip)
        with self.assertRaises(sunplus.SunplusError):
            lk.write_memory(sunplus.with_led(bytes(chip.memory), 7, 1))
        self.assertEqual([p[1] for p in lk.sent[-2:]], [0x08, 0x02])
        self.assertEqual(chip.commits, 0)

    def test_bad_reply_raises(self):
        class Broken(FakeDevice):
            def get_feature_report(self, report_id, length):
                return [0x04, 0x00]
        with self.assertRaises(sunplus.SunplusError):
            sunplus.SunplusLink(Broken(fakehid.FakeSunplusChip()), sleep=lambda s: None).read_memory()


class ApplyTest(unittest.TestCase):
    def setUp(self):
        self._home = temp_home()
        self.home = self._home.__enter__()

    def tearDown(self):
        self._home.__exit__(None, None, None)

    def test_apply_changes_led_verifies_and_keeps_everything_else(self):
        chip = fakehid.FakeSunplusChip()
        before = bytes(chip.memory)
        sunplus.apply_led(None, 4, 8, link(chip))
        self.assertEqual(sunplus.led_state(bytes(chip.memory)), (4, 8))
        changed = [i for i in range(len(before)) if before[i] != chip.memory[i]]
        self.assertEqual(changed, [0x32, 0x33])
        self.assertEqual(chip.commits, 1)
        # leer, escribir y releer para verificar
        self.assertEqual(chip.log.count(0x06), 1)
        self.assertEqual(chip.log.count(0x04), 4)

    def test_backup_is_the_first_memory_and_never_overwritten(self):
        chip = fakehid.FakeSunplusChip()
        original = bytes(chip.memory)
        sunplus.apply_led(None, 4, 8, link(chip))
        sunplus.apply_led(None, 7, 1, link(chip))
        self.assertEqual(sunplus.BACKUP_PATH.read_bytes(), original)
        self.assertEqual(sunplus.load_backup(), original)

    def test_same_settings_do_not_write(self):
        chip = fakehid.FakeSunplusChip()
        sunplus.apply_led(None, 3, 4, link(chip))  # ya es arcoiris, velocidad 4
        self.assertNotIn(0x06, chip.log)

    def test_unknown_memory_is_never_written(self):
        memory = fakehid.sunplus_memory()
        memory[0x33] = 0x00
        chip = fakehid.FakeSunplusChip(memory=memory)
        with self.assertRaises(sunplus.SunplusError):
            sunplus.apply_led(None, 4, 8, link(chip))
        self.assertNotIn(0x06, chip.log)
        self.assertNotIn(0x07, chip.log)

    def test_short_memory_is_never_written(self):
        chip = fakehid.FakeSunplusChip(memory=fakehid.sunplus_memory()[:120])
        with self.assertRaises(sunplus.SunplusError):
            sunplus.apply_led(None, 4, 8, link(chip))
        self.assertNotIn(0x06, chip.log)

    def test_failed_verification_restores_original(self):
        chip = fakehid.FakeSunplusChip(ignore_writes=True)
        with self.assertRaises(sunplus.SunplusError):
            sunplus.apply_led(None, 4, 8, link(chip))
        self.assertEqual(chip.log.count(0x06), 2)  # el cambio y la restauracion

    def test_echo_error_restores_original(self):
        chip = fakehid.FakeSunplusChip(echo_error_at=3)
        original = bytes(chip.memory)
        with self.assertRaises(sunplus.SunplusError):
            sunplus.apply_led(None, 4, 8, link(chip))
        chip.echo_error_at = None
        self.assertEqual(bytes(chip.memory), original)


class KalleyEndToEndTest(unittest.TestCase):
    """Con los descriptores reales del Kalley, el touchpad y el receptor del usuario."""

    def setUp(self):
        self._home = temp_home()
        self._home.__enter__()
        self.chip = fakehid.FakeSunplusChip()
        descriptors = dict(fakehid.KALLEY_DESCRIPTORS)
        descriptors[b"elan3"] = fakehid.ELAN_TOUCHPAD_COL03
        self.hid = fakehid.install(fakehid.FakeHid(
            fakehid.elan_entries() + fakehid.kalley_entries(), descriptors,
            chips={b"col04": self.chip}))
        sunplus.DELAY, self._delay = 0, sunplus.DELAY

    def tearDown(self):
        sunplus.DELAY = self._delay
        fakehid.uninstall()
        self._home.__exit__(None, None, None)

    def test_kalley_is_detected_first_and_targets_col04(self):
        matches = detect.scan()
        kalley = matches[0]
        self.assertEqual((kalley.device.ids, kalley.protocol.id, kalley.confidence),
                         ("1bcf:08a0", "sunplus", "confirmado"))
        self.assertEqual(kalley.target_path(), b"col04")
        elan = next(m for m in matches if m.device.vid == 0x04F3)
        self.assertIsNone(elan.protocol)  # su reporte 7 es de 2 bytes, no de configuracion

    def test_target_without_descriptors_falls_back_to_col04(self):
        kalley = next(m for m in detect.scan(read_descriptors=False) if m.device.vid == 0x1BCF)
        self.assertEqual(kalley.target_path(), b"col04")

    def test_unknown_sunplus_pid_with_report_4_is_probable(self):
        device = detect.scan()[0].device
        device.pid = 0x1234
        m = detect.identify(device, {b"col04": (b"x", __import__("kalley_rgb").descriptor.parse(
            fakehid.KALLEY_DESCRIPTORS[b"col04"]))})
        self.assertEqual((m.protocol.id, m.confidence), ("sunplus", "probable"))

    def test_apply_through_match(self):
        kalley = detect.scan()[0]
        kalley.apply(Settings("apagado", speed=3))
        self.assertEqual(sunplus.led_state(bytes(self.chip.memory))[0], 7)
        self.assertTrue(all(path == b"col04" for path, _ in self.hid.sent))

    def test_cli_simulate_shows_diff_without_writing(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main(["aplicar", "vals", "-v", "8", "--simular"]), 0)
        self.assertEqual(out.getvalue().split(), ["0x32:", "83", "->", "05", "0x33:", "7c", "->", "fa"])
        self.assertNotIn(0x06, self.chip.log)

    def test_cli_apply_off_and_restore_memory(self):
        original = bytes(self.chip.memory)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["aplicar", "flujo", "-v", "2"]), 0)
            self.assertEqual(sunplus.led_state(bytes(self.chip.memory)), (4, 2))
            self.assertEqual(cli.main(["apagar"]), 0)
            self.assertEqual(sunplus.led_state(bytes(self.chip.memory))[0], 7)
            self.assertEqual(cli.main(["restaurar-memoria"]), 0)
        self.assertEqual(bytes(self.chip.memory), original)

    def test_diagnostics_dumps_memory_without_writing(self):
        text = diagnostics.build_report()
        self.assertIn("protocolo: sunplus [confirmado]", text)
        self.assertIn("luces: efecto 3, velocidad 4", text)
        self.assertIn("30: 01 fe 83 7c", text)
        self.assertNotIn(0x06, self.chip.log)
        self.assertNotIn(0x07, self.chip.log)


class ProtocolTest(unittest.TestCase):
    def test_sunplus_protocol_modes(self):
        proto = protocols.get("sunplus")
        self.assertEqual(sorted(m.code for m in proto.modes), list(range(1, 8)))
        self.assertEqual(proto.mode(proto.off_mode).code, 7)
        with self.assertRaises(NotImplementedError):
            proto.packets(proto.default_settings())


if __name__ == "__main__":
    unittest.main()
