import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from kalley_rgb import cli, config, descriptor, detect, diagnostics, protocols, sunplus
from kalley_rgb.protocols import Settings

from tests import fakehid

V256, V2K = sunplus.VARIANTS


class FakeDevice:
    """Dispositivo HID abierto que habla con un FakeSunplusChip."""

    def __init__(self, chip):
        self.chip = chip

    def send_feature_report(self, data):
        self.chip.send(bytes(data))
        return len(data)

    def get_feature_report(self, report_id, length):
        return list(self.chip.get()[:length])


def link(chip):
    return sunplus.SunplusLink(FakeDevice(chip), sleep=lambda s: None)


@contextlib.contextmanager
def temp_home():
    old = sunplus.BACKUP_PATH, config.PATH, sunplus.DELAY, sunplus.SETTLE, sunplus.RETRY_PAUSE
    with tempfile.TemporaryDirectory() as tmp:
        sunplus.BACKUP_PATH = Path(tmp) / "respaldo.bin"
        config.PATH = Path(tmp) / "cfg.json"
        sunplus.DELAY = sunplus.SETTLE = sunplus.RETRY_PAUSE = 0
        try:
            yield Path(tmp)
        finally:
            (sunplus.BACKUP_PATH, config.PATH, sunplus.DELAY, sunplus.SETTLE,
             sunplus.RETRY_PAUSE) = old


def diff(a, b, size=0xFF):
    return [i for i in range(size) if a[i] != b[i]]


class MemoryFormatTest(unittest.TestCase):
    memory = fakehid.REDGEAR_MEMORY

    def test_real_images_have_valid_checksums(self):
        sunplus.validate(self.memory, V256)
        sunplus.validate(fakehid.memory_2k(), V2K)
        self.assertEqual(self.memory[0x2F], sunplus.checksum(self.memory, 0x00, 0x2F))
        self.assertEqual(self.memory[0x76], sunplus.checksum(self.memory, 0x40, 0x76))

    def test_speed_encoding(self):
        # velocidad 1 -> 0xE0 ... 8 -> 0x00 (spmctrl, SDK Havit y capturas)
        self.assertEqual([sunplus.speed_bits(s) for s in range(1, 9)],
                         [0xE0, 0xC0, 0xA0, 0x80, 0x60, 0x40, 0x20, 0x00])

    def test_effect_only_touches_led_byte_and_complement(self):
        updated = sunplus.edit(self.memory, 5, 3)
        self.assertEqual(diff(self.memory, updated), [0x32, 0x33])
        self.assertEqual((updated[0x32], updated[0x33]), (0xA5, 0x5A))
        sunplus.validate(updated, V256)

    def test_edit_turns_led_on_and_keeps_unknown_bit_4(self):
        memory = bytearray(self.memory)
        memory[0x32], memory[0x33] = 0x1C, 0xE3  # flujo, LED apagado (bit 3), bit 4 puesto
        updated = sunplus.edit(bytes(memory), 3, 8)
        self.assertEqual(updated[0x32], 0x13)
        self.assertEqual(updated[0x33], 0xEC)

    def test_brightness_and_color_recompute_checksum(self):
        updated = sunplus.edit(self.memory, 1, 4, brightness=2, color=(1, 2, 3))
        sunplus.validate(updated, V256)
        changed = diff(self.memory, updated)
        self.assertIn(0x03, changed)  # brillo al 100 %
        self.assertIn(0x2F, changed)  # checksum recalculado
        self.assertTrue(updated[0x03] & 0x08)
        levels = self.memory[0x02]
        colors = updated[0x1A:0x1A + 3 * levels]
        self.assertEqual(colors, bytes([1, 2, 3]) * levels)
        self.assertEqual(updated[0x1A + 3 * levels:0x2F], self.memory[0x1A + 3 * levels:0x2F])
        self.assertTrue(set(changed) <= {0x03, 0x2F, 0x32, 0x33} | set(range(0x1A, 0x2F)))
        self.assertEqual(sunplus.edit(updated, 1, 4, brightness=1)[0x03] & 0x08, 0)

    def test_validate_rejects_unknown_layouts(self):
        def broken(addr, value):
            memory = bytearray(self.memory)
            memory[addr] = value
            return bytes(memory)
        cases = {
            "corto": self.memory[:200],
            "checksum 0x2F": broken(0x2F, self.memory[0x2F] ^ 1),
            "checksum 0x76": broken(0x76, self.memory[0x76] ^ 1),
            "complemento luces": broken(0x33, self.memory[0x33] ^ 1),
            "complemento DPI": broken(0x31, 0x00),
        }
        memory = bytearray(self.memory)
        memory[0x32], memory[0x33] = 0x00, 0xFF
        cases["efecto 0"] = bytes(memory)
        for name, memory in cases.items():
            with self.subTest(name), self.assertRaises(sunplus.SunplusError):
                sunplus.validate(memory, V256)

    def test_describe(self):
        self.assertEqual(sunplus.describe(self.memory),
                         "efecto 2, velocidad 8, encendido, brillo 50 %, 6 niveles DPI, "
                         "colores DPI ffffff ff00ff 0000ff ff0000 e1e11a 09fa05")


class LinkTest(unittest.TestCase):
    def test_read_256_follows_captured_sequence(self):
        chip = fakehid.FakeSunplusChip()
        variant, memory = link(chip).read()
        self.assertEqual((variant, memory), (V256, fakehid.REDGEAR_MEMORY))
        self.assertEqual(chip.log, [0x01, 0x03, 0x04] + [0x05] * 43 + [0x08, 0x02])

    def test_read_2k_variant(self):
        chip = fakehid.FakeSunplusChip("2k")
        variant, memory = link(chip).read()
        self.assertEqual(variant, V2K)
        self.assertEqual(len(memory), 342 * 6)
        self.assertEqual(chip.log.count(0x05), 342)

    def test_slow_replies_are_polled_without_repeating_the_set(self):
        chip = fakehid.FakeSunplusChip(pending=3)
        variant, memory = link(chip).read()
        self.assertEqual(memory, fakehid.REDGEAR_MEMORY)
        self.assertEqual(chip.log.count(0x05), 43)

    def test_unknown_firmware_is_closed_and_never_read(self):
        chip = fakehid.FakeSunplusChip(hello=0xB0)
        with self.assertRaises(sunplus.SunplusError):
            link(chip).read()
        self.assertEqual(chip.log, [0x01, 0x03, 0x08, 0x02])

    def test_write_follows_captured_sequence(self):
        chip = fakehid.FakeSunplusChip()
        new = sunplus.edit(fakehid.REDGEAR_MEMORY, 4, 2)
        link(chip).write(V256, new)
        self.assertEqual(chip.log, [0x01, 0x03, 0x06] + [0x07] * 43 + [0x08, 0x02])
        self.assertEqual(bytes(chip.memory), new)

    def test_interrupted_write_never_sends_close(self):
        chip = fakehid.FakeSunplusChip(echo_error_at=10)
        with self.assertRaises(sunplus.WriteInterrupted):
            link(chip).write(V256, sunplus.edit(fakehid.REDGEAR_MEMORY, 4, 2))
        self.assertEqual(chip.log[-1], 0x07)
        self.assertNotIn(0x08, chip.log)
        self.assertEqual((chip.commits, chip.partial_commits), (0, 0))

    def test_bad_reply_raises(self):
        class Broken(FakeDevice):
            def get_feature_report(self, report_id, length):
                return [0x04, 0x00]
        with self.assertRaises(sunplus.SunplusError):
            sunplus.SunplusLink(Broken(fakehid.FakeSunplusChip()), sleep=lambda s: None).read()


class ApplyTest(unittest.TestCase):
    def setUp(self):
        self._home = temp_home()
        self._home.__enter__()

    def tearDown(self):
        self._home.__exit__(None, None, None)

    def test_apply_reads_twice_writes_once_and_verifies(self):
        chip = fakehid.FakeSunplusChip()
        sunplus.apply_settings(None, 4, 8, link=link(chip))
        self.assertEqual(diff(fakehid.REDGEAR_MEMORY, chip.memory), [0x32, 0x33])
        self.assertEqual(chip.memory[0x32] & 0x07, 4)
        self.assertEqual(chip.log.count(0x06), 1)
        self.assertEqual(chip.log.count(0x04), 3)  # 2 lecturas antes y 1 de verificacion
        self.assertEqual(chip.partial_commits, 0)

    def test_backup_is_first_image_and_never_overwritten(self):
        chip = fakehid.FakeSunplusChip()
        sunplus.apply_settings(None, 4, 8, link=link(chip))
        sunplus.apply_settings(None, 7, 1, link=link(chip))
        self.assertEqual(sunplus.BACKUP_PATH.read_bytes(), fakehid.REDGEAR_MEMORY)
        self.assertEqual(sunplus.load_backup(V256), fakehid.REDGEAR_MEMORY)

    def test_same_settings_do_not_write(self):
        chip = fakehid.FakeSunplusChip()
        sunplus.apply_settings(None, 2, 8, link=link(chip))  # ya es multicolor, velocidad 8
        self.assertNotIn(0x06, chip.log)

    def test_unknown_layout_is_never_written(self):
        memory = bytearray(fakehid.REDGEAR_MEMORY)
        memory[0x2F] ^= 0xFF
        chip = fakehid.FakeSunplusChip(memory=memory)
        with self.assertRaises(sunplus.SunplusError):
            sunplus.apply_settings(None, 4, 8, link=link(chip))
        self.assertNotIn(0x06, chip.log)
        self.assertFalse(sunplus.BACKUP_PATH.exists())

    def test_reads_that_differ_are_never_written(self):
        chip = fakehid.FakeSunplusChip(change_after_reads=1)
        with self.assertRaises(sunplus.SunplusError):
            sunplus.apply_settings(None, 4, 8, link=link(chip))
        self.assertNotIn(0x06, chip.log)

    def test_transient_echo_error_is_retried_from_handshake(self):
        chip = fakehid.FakeSunplusChip(echo_error_at=20, echo_errors=1)
        sunplus.apply_settings(None, 6, 5, link=link(chip))
        self.assertEqual(chip.memory[0x32] & 0x07, 6)
        self.assertEqual(chip.log.count(0x06), 2)
        self.assertEqual(chip.partial_commits, 0)

    def test_persistent_echo_errors_never_commit_a_partial_write(self):
        chip = fakehid.FakeSunplusChip(echo_error_at=5, echo_errors=99)
        with self.assertRaisesRegex(sunplus.SunplusError, "restaurar-memoria"):
            sunplus.apply_settings(None, 6, 5, link=link(chip))
        self.assertEqual(chip.partial_commits, 0)
        self.assertEqual(bytes(chip.memory), fakehid.REDGEAR_MEMORY)

    def test_failed_verification_rewrites_previous_config(self):
        chip = fakehid.FakeSunplusChip(ignore_writes=True)
        with self.assertRaisesRegex(sunplus.SunplusError, "configuración anterior"):
            sunplus.apply_settings(None, 6, 5, link=link(chip))
        self.assertEqual(chip.log.count(0x06), 2)  # el cambio y la vuelta atras

    def test_2k_variant_apply(self):
        chip = fakehid.FakeSunplusChip("2k")
        sunplus.apply_settings(None, 1, 2, brightness=2, color=(9, 8, 7), link=link(chip))
        sunplus.validate(bytes(chip.memory), V2K)
        self.assertEqual(chip.memory[0x1A:0x1D], bytes([9, 8, 7]))
        self.assertEqual(chip.log.count(0x07), 342)

    def test_restore_backup(self):
        chip = fakehid.FakeSunplusChip()
        sunplus.apply_settings(None, 1, 2, brightness=2, color=(9, 8, 7), link=link(chip))
        sunplus.restore_backup(None, link=link(chip))
        self.assertEqual(bytes(chip.memory), fakehid.REDGEAR_MEMORY)


class KalleyEndToEndTest(unittest.TestCase):
    """Con los descriptores reales del Kalley y del touchpad del usuario, y un chip simulado."""

    def setUp(self):
        self._home = temp_home()
        self._home.__enter__()
        self.chip = fakehid.FakeSunplusChip()
        descriptors = dict(fakehid.KALLEY_DESCRIPTORS)
        descriptors[b"elan3"] = fakehid.ELAN_TOUCHPAD_COL03
        self.hid = fakehid.install(fakehid.FakeHid(
            fakehid.elan_entries() + fakehid.kalley_entries(), descriptors,
            chips={b"col04": self.chip}))

    def tearDown(self):
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
        col04 = descriptor.parse(fakehid.KALLEY_DESCRIPTORS[b"col04"])
        m = detect.identify(device, {b"col04": (b"x", col04)})
        self.assertEqual((m.protocol.id, m.confidence), ("sunplus", "probable"))

    def test_apply_through_match_only_talks_to_col04(self):
        detect.scan()[0].apply(Settings("apagado", speed=3))
        self.assertEqual(self.chip.memory[0x32] & 0x07, 7)
        self.assertTrue(all(path == b"col04" for path, _ in self.hid.sent))

    def test_cli_simulate_shows_diff_without_writing(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main(["aplicar", "vals", "-v", "8", "-b", "1", "--simular"]), 0)
        self.assertEqual(out.getvalue().split(), ["0x32:", "02", "->", "05", "0x33:", "fd", "->", "fa"])
        self.assertNotIn(0x06, self.chip.log)

    def test_cli_static_color_apply_off_and_restore_memory(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["aplicar", "estatico", "-c", "00ff00"]), 0)
            sunplus.validate(bytes(self.chip.memory), V256)
            self.assertEqual(self.chip.memory[0x32] & 0x07, 1)
            self.assertEqual(self.chip.memory[0x1A:0x1D], bytes([0, 255, 0]))
            self.assertEqual(cli.main(["apagar"]), 0)
            self.assertEqual(self.chip.memory[0x32] & 0x07, 7)
            self.assertEqual(cli.main(["restaurar-memoria"]), 0)
        self.assertEqual(bytes(self.chip.memory), fakehid.REDGEAR_MEMORY)
        self.assertEqual(self.chip.partial_commits, 0)

    def test_diagnostics_dumps_memory_without_writing(self):
        text = diagnostics.build_report()
        self.assertIn("protocolo: sunplus [confirmado]", text)
        self.assertIn("saludo: 04 a6 00 00 00 93 00 cc / 04 aa 0e fd 00 93 00 cc (variante 256 B)", text)
        self.assertIn("formato conocido", text)
        self.assertIn("luces: efecto 2, velocidad 8", text)
        self.assertIn("030: 01 fe 02 fd", text)
        self.assertNotIn(0x06, self.chip.log)
        self.assertNotIn(0x07, self.chip.log)


class ProtocolTest(unittest.TestCase):
    def test_sunplus_protocol_modes(self):
        proto = protocols.get("sunplus")
        self.assertEqual(sorted({m.code for m in proto.modes}), list(range(1, 8)))
        self.assertEqual(proto.mode(proto.off_mode).code, 7)
        self.assertEqual([m.key for m in proto.modes if m.color], ["estatico"])
        with self.assertRaises(NotImplementedError):
            proto.packets(proto.default_settings())


if __name__ == "__main__":
    unittest.main()
