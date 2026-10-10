"""Ventana de control (tkinter, incluido con Python)."""

import threading
import tkinter as tk
from tkinter import colorchooser, filedialog, messagebox, ttk

from . import __version__, config, detect, diagnostics, protocols
from .hidio import HidUnavailable

AUTO = "Automático"
PRESETS = ("#ff0000", "#ff6400", "#ffff00", "#00ff00", "#00ffff",
           "#0000ff", "#a000ff", "#ff00a0", "#ffffff")


class App:
    def __init__(self, root):
        self.root = root
        self.matches = []
        self.color = (255, 0, 0)
        self.saved = config.load()
        self._pending = None
        self._worker = None
        root.title(f"Kalley RGB {__version__}")
        root.resizable(False, False)
        self._build()
        root.after(50, self.refresh)

    # ---- construccion -------------------------------------------------
    def _build(self):
        pad = {"padx": 8, "pady": 4}
        top = ttk.Frame(self.root, padding=8)
        top.grid(sticky="nsew")

        ttk.Label(top, text="Ratón:").grid(row=0, column=0, sticky="w")
        self.device_box = ttk.Combobox(top, state="readonly", width=48)
        self.device_box.grid(row=0, column=1, sticky="ew", **pad)
        self.device_box.bind("<<ComboboxSelected>>", lambda e: self._device_changed())
        ttk.Button(top, text="Buscar", command=self.refresh).grid(row=0, column=2)

        ttk.Label(top, text="Chip:").grid(row=1, column=0, sticky="w")
        self.proto_box = ttk.Combobox(top, state="readonly", width=48)
        self.proto_box.grid(row=1, column=1, sticky="ew", **pad)
        self.proto_box.bind("<<ComboboxSelected>>", lambda e: self._protocol_changed())

        self.detect_label = ttk.Label(top, text="", wraplength=440, foreground="#555")
        self.detect_label.grid(row=2, column=0, columnspan=3, sticky="w", **pad)

        effects = ttk.LabelFrame(top, text="Efecto", padding=6)
        effects.grid(row=3, column=0, columnspan=3, sticky="ew", **pad)
        self.mode_list = tk.Listbox(effects, height=8, exportselection=False, width=40)
        self.mode_list.grid(row=0, column=0, sticky="ew")
        self.mode_list.bind("<<ListboxSelect>>", lambda e: self._mode_changed())
        scroll = ttk.Scrollbar(effects, command=self.mode_list.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.mode_list.config(yscrollcommand=scroll.set)
        effects.columnconfigure(0, weight=1)

        opts = ttk.LabelFrame(top, text="Ajustes", padding=6)
        opts.grid(row=4, column=0, columnspan=3, sticky="ew", **pad)
        ttk.Label(opts, text="Color:").grid(row=0, column=0, sticky="w")
        self.swatch = tk.Label(opts, width=4, relief="sunken", bg=config.color_hex(self.color))
        self.swatch.grid(row=0, column=1, padx=4)
        self.color_btn = ttk.Button(opts, text="Elegir…", command=self._choose_color)
        self.color_btn.grid(row=0, column=2, padx=4)
        presets = ttk.Frame(opts)
        presets.grid(row=0, column=3, sticky="w")
        self.preset_labels = []
        for i, hex_color in enumerate(PRESETS):
            lbl = tk.Label(presets, width=2, bg=hex_color, relief="raised", cursor="hand2")
            lbl.grid(row=0, column=i, padx=1)
            lbl.bind("<Button-1>", lambda e, c=hex_color: self._pick_preset(c))
            self.preset_labels.append(lbl)

        ttk.Label(opts, text="Velocidad:").grid(row=1, column=0, sticky="w")
        self.speed = tk.Scale(opts, orient="horizontal", length=260, showvalue=True)
        self.speed.grid(row=1, column=1, columnspan=3, sticky="w")
        ttk.Label(opts, text="Brillo:").grid(row=2, column=0, sticky="w")
        self.brightness = tk.Scale(opts, orient="horizontal", length=260, showvalue=True)
        self.brightness.grid(row=2, column=1, columnspan=3, sticky="w")

        buttons = ttk.Frame(top)
        buttons.grid(row=5, column=0, columnspan=3, sticky="ew", **pad)
        self.apply_btn = ttk.Button(buttons, text="Aplicar", command=self.apply)
        self.apply_btn.pack(side="left")
        self.off_btn = ttk.Button(buttons, text="Apagar luces", command=self.turn_off)
        self.off_btn.pack(side="left", padx=6)
        ttk.Button(buttons, text="Diagnóstico…", command=self.show_diagnostics).pack(side="right")

        self.status = ttk.Label(top, text="Buscando ratones…", wraplength=440)
        self.status.grid(row=6, column=0, columnspan=3, sticky="w", **pad)

    # ---- estado ---------------------------------------------------------
    @property
    def match(self):
        i = self.device_box.current()
        return self.matches[i] if 0 <= i < len(self.matches) else None

    @property
    def protocol(self):
        choice = self.proto_box.get()
        if choice.startswith(AUTO):
            return self.match.protocol if self.match else None
        return next((p for p in protocols.PROTOCOLS.values() if p.name == choice), None)

    def refresh(self):
        self.status.config(text="Buscando ratones…")
        self.root.update_idletasks()
        try:
            self.matches = detect.scan()
        except HidUnavailable as exc:
            self.matches = []
            self.status.config(text=str(exc))
            messagebox.showerror("Kalley RGB", str(exc))
        self.device_box["values"] = [m.summary for m in self.matches]
        if not self.matches:
            self.device_box.set("")
            self.status.config(text="No se encontró ningún ratón. Conéctalo y pulsa Buscar.")
            self._device_changed()
            return
        index = 0
        if self.saved:
            index = next((i for i, m in enumerate(self.matches)
                          if m.device.ids == self.saved[0]), 0)
        self.device_box.current(index)
        self._device_changed()
        self.status.config(text=f"{len(self.matches)} ratón(es) encontrado(s).")

    def _device_changed(self):
        match = self.match
        auto = f"{AUTO} ({match.protocol.name})" if match and match.protocol else f"{AUTO} (ninguno)"
        self.proto_box["values"] = [auto] + [p.name for p in protocols.PROTOCOLS.values()]
        self.proto_box.current(0)
        if self.saved and match and match.device.ids == self.saved[0]:
            saved_proto = protocols.PROTOCOLS.get(self.saved[1])
            if saved_proto and saved_proto is not match.protocol:
                self.proto_box.set(saved_proto.name)
        if match:
            text = f"Detección: {match.confidence}. {match.reason}"
        else:
            text = ""
        self.detect_label.config(text=text)
        self._protocol_changed()

    def _protocol_changed(self):
        proto = self.protocol
        self.mode_list.delete(0, "end")
        enabled = proto is not None and self.match is not None
        for w in (self.apply_btn, self.off_btn):
            w.state(["!disabled"] if enabled else ["disabled"])
        if proto is None:
            self._mode_changed()
            return
        for m in proto.modes:
            self.mode_list.insert("end", m.name)
        settings = proto.default_settings()
        if self.saved and self.saved[1] == proto.id:
            settings = self.saved[2]
            self._set_color(settings.color)
        # Tk ignora set() en una escala deshabilitada; _mode_changed la vuelve a deshabilitar.
        self.speed.config(from_=proto.speed_range[0], to=proto.speed_range[1], state="normal")
        self.brightness.config(from_=proto.brightness_range[0], to=proto.brightness_range[1],
                               state="normal")
        self.speed.set(settings.speed)
        self.brightness.set(settings.brightness)
        keys = [m.key for m in proto.modes]
        self.mode_list.selection_set(keys.index(settings.mode) if settings.mode in keys else 0)
        self._mode_changed()

    def _selected_mode(self):
        proto = self.protocol
        sel = self.mode_list.curselection()
        if proto is None or not sel:
            return None
        return proto.modes[sel[0]]

    def _mode_changed(self):
        mode = self._selected_mode()
        has = {"color": bool(mode and mode.color), "speed": bool(mode and mode.speed),
               "brightness": bool(mode and mode.brightness)}
        self.color_btn.state(["!disabled"] if has["color"] else ["disabled"])
        for lbl in self.preset_labels:
            lbl.config(cursor="hand2" if has["color"] else "")
        for scale, on in ((self.speed, has["speed"]), (self.brightness, has["brightness"])):
            scale.config(state="normal" if on else "disabled", fg="black" if on else "#aaa")

    def _pick_preset(self, hex_color):
        mode = self._selected_mode()
        if mode and mode.color:
            self._set_color(config.parse_color(hex_color))

    def _set_color(self, rgb):
        self.color = tuple(rgb)
        self.swatch.config(bg=config.color_hex(self.color))

    def _choose_color(self):
        rgb, _ = colorchooser.askcolor(color=config.color_hex(self.color), parent=self.root)
        if rgb:
            self._set_color(tuple(int(c) for c in rgb))

    # ---- acciones -------------------------------------------------------
    def _send(self, settings, done_text, save=True):
        """Aplica en segundo plano: algunos chips tardan segundos (leen y reescriben memoria)."""
        match, proto = self.match, self.protocol
        outcome = {}

        def work():
            try:
                match.apply(settings, proto)
            except Exception as exc:
                outcome["error"] = exc

        self._pending = (outcome, match, proto, settings, done_text, save)
        self._busy(True)
        self.status.config(text="Aplicando… puede tardar unos segundos.")
        self._worker = threading.Thread(target=work, daemon=True)
        self._worker.start()
        self.root.after(100, self._poll)

    def _poll(self):
        if self._pending is None:
            return
        if self._worker.is_alive():
            self.root.after(100, self._poll)
            return
        outcome, match, proto, settings, done_text, save = self._pending
        self._pending = None
        self._busy(False)
        if "error" in outcome:
            self.status.config(text=f"Error: {outcome['error']}")
            messagebox.showerror("Kalley RGB", str(outcome["error"]))
            return
        if save:
            config.save(match.device.ids, proto.id, settings)
            self.saved = (match.device.ids, proto.id, settings)
        self.status.config(text=done_text)

    def _busy(self, busy):
        for w in (self.apply_btn, self.off_btn):
            w.state(["disabled"] if busy else ["!disabled"])
        self.root.config(cursor="watch" if busy else "")

    def apply(self):
        mode = self._selected_mode()
        if mode is None:
            return
        settings = protocols.Settings(mode=mode.key, color=self.color,
                                      speed=int(self.speed.get()),
                                      brightness=int(self.brightness.get()))
        self._send(settings, f"Aplicado: {mode.name}. Si las luces no cambian, "
                             "prueba otro chip en la lista o usa Diagnóstico.")

    def turn_off(self):
        proto = self.protocol
        settings = proto.default_settings()
        settings.mode = proto.off_mode
        self._send(settings, "Luces apagadas.", save=False)

    def show_diagnostics(self):
        self.status.config(text="Generando diagnóstico…")
        self.root.update_idletasks()
        text = diagnostics.build_report()
        win = tk.Toplevel(self.root)
        win.title("Diagnóstico")
        box = tk.Text(win, width=100, height=30, wrap="none")
        box.insert("1.0", text)
        box.grid(row=0, column=0, columnspan=2, sticky="nsew")
        win.columnconfigure(0, weight=1)
        win.rowconfigure(0, weight=1)

        def copy():
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
            self.status.config(text="Diagnóstico copiado al portapapeles.")

        def save():
            path = filedialog.asksaveasfilename(parent=win, defaultextension=".txt",
                                                initialfile="diagnostico-kalley.txt")
            if path:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text + "\n")
                self.status.config(text=f"Diagnóstico guardado en {path}")

        ttk.Button(win, text="Copiar", command=copy).grid(row=1, column=0, sticky="w", padx=8, pady=6)
        ttk.Button(win, text="Guardar…", command=save).grid(row=1, column=1, sticky="e", padx=8, pady=6)
        self.status.config(text="Diagnóstico listo.")


def run():
    root = tk.Tk()
    App(root)
    root.mainloop()
    return 0
