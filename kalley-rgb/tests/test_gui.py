import tempfile
import unittest
from pathlib import Path

from kalley_rgb import config

from tests import fakehid

try:
    import tkinter as tk
    from kalley_rgb import gui
except ImportError:  # Python sin tkinter
    tk = None


@unittest.skipIf(tk is None, "tkinter no disponible")
class GuiTest(unittest.TestCase):
    def setUp(self):
        try:
            self.root = tk.Tk()
        except tk.TclError as exc:  # sin pantalla
            self.skipTest(f"sin pantalla: {exc}")
        self.root.withdraw()
        self.hid = fakehid.install(fakehid.FakeHid(
            fakehid.instant_entries(),
            {b"/dev/hidraw0": fakehid.INSTANT_IF0, b"/dev/hidraw1": fakehid.INSTANT_IF1}))
        self.tmp = tempfile.TemporaryDirectory()
        self.old_path, config.PATH = config.PATH, Path(self.tmp.name) / "cfg.json"
        self.app = self._open()

    def tearDown(self):
        self.root.destroy()
        config.PATH = self.old_path
        self.tmp.cleanup()
        fakehid.uninstall()

    def _open(self):
        app = gui.App(self.root)
        app.refresh()
        return app

    def _select(self, app, name):
        app.mode_list.selection_clear(0, "end")
        app.mode_list.selection_set(app.mode_list.get(0, "end").index(name))
        app._mode_changed()

    def test_detects_mouse_and_enables_only_supported_settings(self):
        self.assertIn("30fa:1440", self.app.device_box.get())
        self.assertTrue(self.app.proto_box.get().startswith(gui.AUTO))
        self._select(self.app, "Color fijo")
        self.assertEqual(self.app.color_btn.state(), ())
        self.assertEqual(self.app.speed.cget("state"), "disabled")
        self._select(self.app, "Cometa")
        self.assertIn("disabled", self.app.color_btn.state())
        self.assertEqual(self.app.speed.cget("state"), "normal")

    def test_apply_sends_packets_and_is_remembered(self):
        self._select(self.app, "Color fijo")
        self.app._pick_preset("#00ffff")
        self.app.speed.config(state="normal")
        self.app.speed.set(6)
        self.app.apply()
        self.assertEqual(len(self.hid.sent), 19)
        self.assertEqual(self.hid.sent[0][1].hex(" "), "07 14 0f 0f 00 00 00 00")

        reopened = self._open()
        self.assertEqual(reopened.mode_list.get(reopened.mode_list.curselection()), "Color fijo")
        self.assertEqual(reopened.color, (0, 255, 255))
        self.assertEqual(reopened.speed.get(), 6)  # aunque la escala quede deshabilitada

    def test_manual_protocol_and_turn_off(self):
        self.app.proto_box.set("Instant A704 / A704F")
        self.app._protocol_changed()
        self.assertEqual(self.app.mode_list.get(0, "end"),
                         ("Respiración multicolor", "Estático", "Apagado"))
        self.app.turn_off()
        self.assertEqual([p.hex(" ") for _, p in self.hid.sent], ["07 13 7f 17 00 00 00 00"])

    def test_no_mouse_disables_actions(self):
        self.hid.entries = []
        self.app.refresh()
        self.assertIn("disabled", self.app.apply_btn.state())


if __name__ == "__main__":
    unittest.main()
