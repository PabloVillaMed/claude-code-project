import gc
import tempfile
import unittest
from pathlib import Path

from kalley_rgb import config, sunplus

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
        # Liberar el interprete Tk aqui: si el recolector lo hiciera en el hilo de trabajo
        # de la prueba siguiente, Tcl aborta ("async handler deleted by the wrong thread").
        self.app = None
        gc.collect()
        config.PATH = self.old_path
        self.tmp.cleanup()
        fakehid.uninstall()

    def _open(self):
        app = gui.App(self.root)
        app.refresh()
        return app

    def _wait(self, app):
        """Espera la tarea en segundo plano de Aplicar/Apagar y procesa su resultado."""
        app._worker.join(timeout=10)
        app._poll()

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
        self.assertIn("disabled", self.app.apply_btn.state())  # ocupado mientras aplica
        self._wait(self.app)
        self.assertNotIn("disabled", self.app.apply_btn.state())
        self.assertTrue(self.app.status.cget("text").startswith("Aplicado: Color fijo"))
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
        self._wait(self.app)
        self.assertEqual([p.hex(" ") for _, p in self.hid.sent], ["07 13 7f 17 00 00 00 00"])

    def test_no_mouse_disables_actions(self):
        self.hid.entries = []
        self.app.refresh()
        self.assertIn("disabled", self.app.apply_btn.state())


@unittest.skipIf(tk is None, "tkinter no disponible")
class KalleyGuiTest(unittest.TestCase):
    """La ventana con el Kalley real del usuario (Sunplus 1bcf:08a0) simulado."""

    def setUp(self):
        try:
            self.root = tk.Tk()
        except tk.TclError as exc:
            self.skipTest(f"sin pantalla: {exc}")
        self.root.withdraw()
        self.chip = fakehid.FakeSunplusChip()
        fakehid.install(fakehid.FakeHid(fakehid.kalley_entries(), dict(fakehid.KALLEY_DESCRIPTORS),
                                        chips={b"col04": self.chip}))
        self.tmp = tempfile.TemporaryDirectory()
        self.old = (config.PATH, sunplus.BACKUP_DIR, sunplus.DELAY, sunplus.SETTLE)
        config.PATH = Path(self.tmp.name) / "cfg.json"
        sunplus.BACKUP_DIR = Path(self.tmp.name) / "kalley"
        sunplus.DELAY = sunplus.SETTLE = 0
        self.app = gui.App(self.root)
        self.app.refresh()

    def tearDown(self):
        self.root.destroy()
        # Liberar el interprete Tk aqui: si el recolector lo hiciera en el hilo de trabajo
        # de la prueba siguiente, Tcl aborta ("async handler deleted by the wrong thread").
        self.app = None
        gc.collect()
        config.PATH, sunplus.BACKUP_DIR, sunplus.DELAY, sunplus.SETTLE = self.old
        self.tmp.cleanup()
        fakehid.uninstall()

    def test_kalley_effects_apply_in_background(self):
        app = self.app
        self.assertIn("1bcf:08a0", app.device_box.get())
        self.assertIn("Sunplus", app.proto_box.get())
        self.assertEqual(app.mode_list.get(0, "end"), (
            "Arcoíris", "Multicolor", "Flujo", "Vals", "Cuatro estaciones",
            "Color fijo", "Color según DPI", "Apagado"))
        self.assertEqual((app.brightness.cget("from"), app.brightness.cget("to")), (1, 2))
        app.mode_list.selection_clear(0, "end")
        app.mode_list.selection_set(2)  # Flujo
        app._mode_changed()
        app.speed.set(7)
        app.apply()
        app._worker.join(timeout=10)
        app._poll()
        self.assertEqual(self.chip.memory[0x32], 0x04 | sunplus.speed_bits(7))
        self.assertEqual(app.status.cget("text"), "Aplicado y comprobado: Flujo.")
        app.turn_off()
        app._worker.join(timeout=10)
        app._poll()
        self.assertEqual(self.chip.memory[0x32] & 0x07, 7)
        self.assertEqual(app.status.cget("text"), "Luces apagadas.")
        self.assertEqual(self.chip.partial_commits, 0)

    def test_everything_is_locked_while_writing(self):
        app = self.app
        self.assertEqual(app.restore_btn.state(), ())  # disponible para el chip Sunplus
        self.assertEqual(app.brightness_hint.cget("text"), "1 = 50 %, 2 = 100 %")
        release = __import__("threading").Event()
        original_apply = app.match.apply
        app.match.apply = lambda *a, **k: (release.wait(5), original_apply(*a, **k))
        app.apply()
        for widget in (app.apply_btn, app.off_btn, app.restore_btn, app.search_btn,
                       app.diag_btn, app.device_box, app.proto_box):
            self.assertIn("disabled", widget.state())
        self.assertEqual(app.mode_list.cget("state"), "disabled")
        app.refresh()  # Buscar durante la escritura no debe reactivar nada
        self.assertIn("disabled", app.apply_btn.state())
        app._on_close = app._on_close  # cerrar esta bloqueado mientras escribe
        self.assertTrue(app.busy)
        release.set()
        app._worker.join(timeout=10)
        app._poll()
        self.assertFalse(app.busy)
        self.assertNotIn("disabled", app.search_btn.state())
        self.assertEqual(app.mode_list.cget("state"), "normal")

    def test_restore_button_writes_backup(self):
        app = self.app
        app.mode_list.selection_clear(0, "end")
        app.mode_list.selection_set(7)  # Apagado
        app._mode_changed()
        app.apply()
        app._worker.join(timeout=10)
        app._poll()
        self.assertEqual(self.chip.memory[0x32] & 0x07, 7)
        gui.messagebox.askyesno, old = (lambda *a, **k: True), gui.messagebox.askyesno
        try:
            app.restore()
        finally:
            gui.messagebox.askyesno = old
        app._worker.join(timeout=10)
        app._poll()
        self.assertEqual(bytes(self.chip.memory), fakehid.REDGEAR_MEMORY)
        self.assertEqual(app.status.cget("text"), "Memoria original restaurada y comprobada.")

    def test_static_color_uses_picker_color(self):
        app = self.app
        app.mode_list.selection_clear(0, "end")
        app.mode_list.selection_set(5)  # Color fijo
        app._mode_changed()
        self.assertEqual(app.color_btn.state(), ())
        app._pick_preset("#a000ff")
        app.apply()
        app._worker.join(timeout=10)
        app._poll()
        self.assertEqual(self.chip.memory[0x32] & 0x07, 1)
        self.assertEqual(self.chip.memory[0x1A:0x1D], bytes([0xA0, 0x00, 0xFF]))
        sunplus.validate(bytes(self.chip.memory), sunplus.VARIANTS[0])


if __name__ == "__main__":
    unittest.main()
