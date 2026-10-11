"""Informe de diagnostico: todo lo necesario para dar soporte a un raton nuevo.

Solo lee: enumera, pide descriptores y hace GET_FEATURE de los reportes
que el propio raton declara. En los chips Sunplus ademas descarga la memoria
de configuracion con el mismo procedimiento de lectura que usa al aplicar.
Nunca escribe.
"""

import platform
import sys
from datetime import datetime

from . import __version__, detect, hidio, sunplus


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
        if match.protocol and match.protocol.reads_memory:
            lines += _memory_dump(match)

    if not shown:
        lines += ["", "No se encontró ningún ratón. ¿Está conectado?"]
    lines += ["", "Comparte este texto completo para añadir soporte a tu ratón."]
    return "\n".join(lines)


def _memory_dump(match):
    out = ["  -- memoria de configuración (solo lectura)"]
    if sunplus.write_left_pending():
        return out + [f"     {sunplus.PENDING_HINT}"]
    link = None
    try:
        with match.open() as handle:
            link = sunplus.SunplusLink(handle)
            variant, memory = link.read()
    except Exception as exc:
        if link and link.handshake:
            out.append(f"     saludo: {link.handshake[0].hex(' ')} / {link.handshake[1].hex(' ')}")
        return out + [f"     no se pudo leer: {exc}"]
    hello, ident = link.handshake
    out.append(f"     saludo: {hello.hex(' ')} / {ident.hex(' ')} (variante {variant.name})")
    shown = memory[:0x100]
    for i in range(0, len(shown), 16):
        out.append(f"     {i:03x}: {shown[i:i + 16].hex(' ')}")
    if len(memory) > len(shown):
        out.append(f"     ... ({len(memory)} bytes en total; se muestran los primeros 256)")
    try:
        sunplus.validate(memory, variant)
        out.append("     formato conocido (checksums y complementos correctos)")
    except sunplus.SunplusError as exc:
        out.append(f"     {exc}")
    out.append(f"     luces: {sunplus.describe(memory)}")
    copies = sunplus.backup_info()
    for name, path, digest in copies:
        out.append(f"     copia de seguridad ({name}): {path} ({digest})")
    if not copies:
        out.append("     copia de seguridad: todavía no hay")
    return out


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
