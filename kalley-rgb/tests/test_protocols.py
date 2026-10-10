import unittest

from kalley_rgb import protocols
from kalley_rgb.protocols import Settings


def hexes(packets):
    return [p.hex(" ") for p in packets]


class InstantTest(unittest.TestCase):
    proto = protocols.get("instant")

    def test_neon_mode_packet_and_latch(self):
        packets = self.proto.packets(Settings("neon", speed=2, brightness=4))
        self.assertEqual(hexes(packets), [
            "07 13 ff e2 1b 04 00 02",
            "07 18 10 00 00 00 00 00",
            "07 18 00 00 00 00 00 00",
        ])

    def test_mode_byte_matches_vendor_capture(self):
        # En la captura del 30fa:1030 el byte de modo vale 0x85 (modo 0, vel. 5)
        # y 0x95 (modo 1, vel. 5): misma codificacion 0x80 | modo << 4 | velocidad.
        for key, expected in (("dpi", 0x85), ("respiracion", 0x95)):
            packet = self.proto.packets(Settings(key, speed=5))[0]
            self.assertEqual(packet[3], expected)

    def test_static_color_goes_to_all_zones_around_mode(self):
        packets = self.proto.packets(Settings("estatico", color=(255, 0, 0), speed=3, brightness=4))
        colors = [f"07 14 {z << 5:02x} f0 00 00 00 00" for z in range(8)]
        self.assertEqual(hexes(packets), colors + ["07 13 80 a3 1b 04 00 02"] + colors + [
            "07 18 10 00 00 00 00 00", "07 18 00 00 00 00 00 00"])

    def test_color_is_reduced_to_4_bits_per_channel(self):
        packet = self.proto.packets(Settings("estatico", color=(0x12, 0x88, 0xFF)))[0]
        # verde 0x88 -> 8 (junto a la zona 0); rojo 0x12 -> 1 y azul 0xff -> f
        self.assertEqual(packet[2:4].hex(), "081f")

    def test_modes_from_8_set_extension_bit(self):
        packet = self.proto.packets(Settings("apagado", speed=1, brightness=0))[0]
        self.assertEqual(packet.hex(" "), "07 13 80 d1 1b 00 80 02")

    def test_values_are_clamped(self):
        packet = self.proto.packets(Settings("neon", speed=99, brightness=-3))[0]
        self.assertEqual(packet[3] & 0x0F, 7)
        self.assertEqual(packet[5], 0)

    def test_unknown_mode(self):
        with self.assertRaises(ValueError):
            self.proto.packets(Settings("disco"))


class InstantA704Test(unittest.TestCase):
    proto = protocols.get("instant-a704")

    def test_packets(self):
        cases = {("respiracion", 1): "07 13 7f 10 00 00 00 00",
                 ("respiracion", 6): "07 13 7f 15 00 00 00 00",
                 ("estatico", 3): "07 13 7f 16 00 00 00 00",
                 ("apagado", 3): "07 13 7f 17 00 00 00 00"}
        for (mode, speed), expected in cases.items():
            self.assertEqual(hexes(self.proto.packets(Settings(mode, speed=speed))), [expected])


class HoltekA070Test(unittest.TestCase):
    proto = protocols.get("holtek-a070")

    def test_static(self):
        self.assertEqual(hexes(self.proto.packets(Settings("estatico", color=(255, 128, 1)))), [
            "07 0b 01 01 00 00 00 00", "07 0a 00 ff 80 01 00 00"])

    def test_breathing_speeds(self):
        for speed, code in ((1, 2), (2, 3), (3, 4)):
            packet = self.proto.packets(Settings("respiracion", speed=speed))[0]
            self.assertEqual(packet[3], code)

    def test_off_sends_black(self):
        self.assertEqual(hexes(self.proto.packets(Settings("apagado", color=(9, 9, 9)))), [
            "07 0b 01 01 00 00 00 00", "07 0a 00 00 00 00 00 00"])


class CommonTest(unittest.TestCase):
    def test_every_packet_protocol_produces_8_byte_reports(self):
        for proto in protocols.PROTOCOLS.values():
            if proto.reads_memory:
                continue  # Sunplus: se prueba en test_sunplus con un chip simulado
            for mode in proto.modes:
                for packet in proto.packets(Settings(mode.key)):
                    self.assertEqual(len(packet), 8, (proto.id, mode.key))
                    self.assertEqual(packet[0], proto.report_id)

    def test_defaults_are_valid(self):
        for proto in protocols.PROTOCOLS.values():
            settings = proto.default_settings()
            proto.mode(settings.mode)
            proto.mode(proto.off_mode)
            self.assertTrue(proto.speed_range[0] <= settings.speed <= proto.speed_range[1])


if __name__ == "__main__":
    unittest.main()
