"""Informe de diagnostico: todo lo necesario para dar soporte a un raton nuevo.

Solo lee: enumera, pide descriptores y hace GET_FEATURE de los reportes
que el propio raton declara. Nunca envia comandos de configuracion.
"""

import platform
import sys
from datetime import datetime

from . import __version__, detect, hidio


def _hex(data):
    return data.hex(" ") if data else "(vacío)"


def build_report(include_all=False):
    lines = [
        f"Kalley RGB {__version__} — diagnóstico {datetime.now():%Y-%m-%d %H:%M}",
        f"Sistema: {platform.platform()} | Python {sys.version.split()[0]}",
    ]
    try:
        import hid
        version = getattr(hid, "version_str", "?")
        lines.append(f"hidapi: {version() if callable(version) else version}")
        devices = hidio.enumerate_devices()
    except Exception as exc:  # sin hidapi no hay nada mas que reportar
        lines.append(f"ERROR: {exc}")
        return "\n".join(lines)

    shown = 0
    for device in devices:
        known = (device.vid, device.pid) in detect.KNOWN_MODELS or device.vid in detect.INSTANT_VIDS
        if not (include_all or device.is_mouse or known):
            continue
        shown += 1
        descriptors = {}
        lines += ["", "=" * 70, device.label,
                  f"  VID:PID {device.ids}  versión {device.release:04x}  serie '{device.serial}'"]
        for c in device.collections:
            lines.append(f"  interfaz {c.interface}  usage page 0x{c.usage_page:04x}"
                         f"  usage 0x{c.usage:04x}  ruta {c.path!r}")
        for path in device.paths():
            raw, desc = hidio.read_descriptor(path)
            lines.append(f"  -- {path!r}")
            if not raw:
                lines.append("     descriptor: no disponible (permisos o sistema)")
                continue
            descriptors[path] = (raw, desc)
            lines.append(f"     descriptor ({len(raw)} bytes): {_hex(raw)}")
            for r in desc.reports:
                lines.append(f"     reporte {r.kind:7} id {r.report_id:3}  {r.size:3} bytes"
                             f"  page 0x{r.usage_page:04x}")
            lines += _read_features(path, desc)
        match = detect.identify(device, descriptors)
        proto = match.protocol.id if match.protocol else "-"
        lines.append(f"  => protocolo: {proto} [{match.confidence}] {match.reason}")
        if match.protocol:
            lines.append(f"  => se enviaría a: {match.target_path()!r}")

    if not shown:
        lines += ["", "No se encontró ningún ratón. ¿Está conectado?"]
    lines += ["", "Comparte este texto completo para añadir soporte a tu ratón."]
    return "\n".join(lines)


def _read_features(path, desc):
    out = []
    features = [r for r in desc.reports if r.kind == "feature" and r.report_id]
    if not features:
        return out
    try:
        with hidio.HidHandle(path) as handle:
            for r in features:
                try:
                    data = handle.get_feature_report(r.report_id, r.size)
                    out.append(f"     GET_FEATURE {r.report_id}: {_hex(data)}")
                except Exception as exc:
                    out.append(f"     GET_FEATURE {r.report_id}: error {exc}")
    except Exception as exc:
        out.append(f"     no se pudo abrir para leer: {exc}")
    return out
