"""Linea de comandos. Sin argumentos abre la ventana."""

import argparse
import sys

from . import __version__, config, detect, diagnostics, protocols, sunplus
from .hidio import HidUnavailable


def _parser():
    p = argparse.ArgumentParser(
        prog="kalley-rgb",
        description="Controla las luces RGB del ratón Kalley K-GMOUSE6 (y otros con chips "
                    "Instant o Holtek). Sin argumentos abre la ventana.")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="command")

    sub.add_parser("listar", help="muestra los ratones detectados")

    s = sub.add_parser("efectos", help="lista los efectos de un protocolo")
    s.add_argument("-p", "--protocolo", choices=list(protocols.PROTOCOLS))

    def target(sp):
        sp.add_argument("-p", "--protocolo", choices=list(protocols.PROTOCOLS),
                        help="forzar un protocolo en lugar del detectado")
        sp.add_argument("-d", "--dispositivo", type=int, default=0,
                        help="número del ratón según 'listar' (por defecto el primero compatible)")
        sp.add_argument("--simular", action="store_true",
                        help="no escribe nada: muestra los bytes que se enviarían (en el Kalley "
                             "lee su memoria y muestra qué bytes cambiarían)")

    s = sub.add_parser("aplicar", help="aplica un efecto")
    s.add_argument("efecto", help="nombre del efecto (ver 'efectos')")
    s.add_argument("-c", "--color", default="rojo", help="RRGGBB o nombre (rojo, azul...)")
    s.add_argument("-v", "--velocidad", type=int,
                   help="velocidad (ver rango en 'efectos'); en el Kalley, sin -v se conserva la actual")
    s.add_argument("-b", "--brillo", type=int,
                   help="brillo (ver rango en 'efectos'); en el Kalley 1 = 50 %%, 2 = 100 %%, "
                        "sin -b se conserva el actual")
    target(s)

    target(sub.add_parser("apagar", help="apaga las luces"))
    sub.add_parser("restaurar", help="vuelve a aplicar los últimos ajustes guardados")
    sub.add_parser("restaurar-memoria",
                   help="ratón Kalley (Sunplus): reescribe la memoria guardada antes del primer cambio")

    s = sub.add_parser("diagnostico", help="genera un informe para dar soporte a tu ratón")
    s.add_argument("-o", "--salida", help="guardar el informe en un archivo")
    s.add_argument("--todos", action="store_true", help="incluir todos los dispositivos HID")
    return p


def main(argv=None):
    args = _parser().parse_args(argv)
    if args.command is None:
        try:
            from .gui import run
        except ImportError:
            print("Falta tkinter para abrir la ventana (en Linux: paquete python3-tk). "
                  "Usa los comandos: kalley-rgb --help", file=sys.stderr)
            return 1
        return run()
    try:
        return COMMANDS[args.command](args)
    except (HidUnavailable, ValueError, RuntimeError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrumpido. Si se estaba escribiendo en el ratón, no lo desconectes y ejecuta "
              "'restaurar-memoria'.", file=sys.stderr)
        return 130


def _list(args):
    matches = detect.scan()
    if not matches:
        print("No se encontró ningún ratón.")
        return 1
    for i, m in enumerate(matches, 1):
        print(f"{i}. {m.summary}\n   {m.reason}")
    return 0


def _effects(args):
    chosen = [protocols.get(args.protocolo)] if args.protocolo else protocols.PROTOCOLS.values()
    for proto in chosen:
        print(f"{proto.name} ({proto.id}): {proto.description}")
        ranges = [f"velocidad {proto.speed_range[0]}-{proto.speed_range[1]}"]
        if proto.brightness_range[1]:
            ranges.append(f"brillo {proto.brightness_range[0]}-{proto.brightness_range[1]}")
        print("  " + ", ".join(ranges))
        for m in proto.modes:
            extras = [n for n, ok in (("color", m.color), ("velocidad", m.speed),
                                      ("brillo", m.brightness)) if ok]
            print(f"  {m.key:12} {m.name}" + (f"  [{', '.join(extras)}]" if extras else ""))
    return 0


def _pick(args):
    """Elige raton y protocolo segun los argumentos."""
    if args.simular and args.protocolo and not protocols.get(args.protocolo).reads_memory:
        return None, protocols.get(args.protocolo)
    matches = detect.scan()
    if args.dispositivo:
        if not 1 <= args.dispositivo <= len(matches):
            raise ValueError(f"No existe el ratón {args.dispositivo}; usa 'listar'.")
        match = matches[args.dispositivo - 1]
    else:
        match = next((m for m in matches if m.protocol), None)
        if match is None:
            raise RuntimeError("No se encontró un ratón compatible. Ejecuta 'diagnostico'.")
    proto = protocols.get(args.protocolo) if args.protocolo else match.protocol
    if proto is None:
        raise RuntimeError(f"{match.device.label}: chip no reconocido. Prueba con -p instant "
                           "o ejecuta 'diagnostico'.")
    return match, proto


def _send(args, match, proto, settings, save=True):
    if args.simular and proto.reads_memory:
        # Estos chips se configuran reescribiendo su memoria: se lee (sin escribir)
        # y se muestran los bytes que cambiarian.
        with match.open(proto) as handle:
            changes = proto.preview(handle, settings)
        for addr, old, new in changes:
            print(f"0x{addr:02x}: {old:02x} -> {new:02x}")
        if not changes:
            print("Sin cambios: el ratón ya tiene esa configuración.")
        return 0
    if args.simular:
        for packet in proto.packets(settings):
            print(packet.hex(" "))
        return 0
    match.apply(settings, proto)
    if save:
        config.save(match.device.ids, proto.id, settings)
    print(f"Listo: '{proto.mode(settings.mode).name}' en {match.device.label}")
    return 0


def _apply(args):
    match, proto = _pick(args)
    settings = proto.default_settings()
    settings.mode = proto.mode(args.efecto).key
    settings.color = config.parse_color(args.color)
    if proto.reads_memory:  # sin -v/-b se conserva lo que tiene el raton
        settings.speed = settings.brightness = None
    if args.velocidad is not None:
        settings.speed = args.velocidad
    if args.brillo is not None:
        settings.brightness = args.brillo
    if proto.reads_memory and not args.simular:
        print("Leyendo y reescribiendo la memoria del ratón; no lo toques ni lo desconectes…")
    return _send(args, match, proto, settings)


def _off(args):
    match, proto = _pick(args)
    settings = proto.default_settings()
    settings.mode = proto.off_mode
    return _send(args, match, proto, settings, save=False)


def _restore(args):
    saved = config.load()
    if saved is None:
        raise RuntimeError("No hay ajustes guardados todavía.")
    device_ids, proto_id, settings = saved
    matches = detect.scan()
    match = next((m for m in matches if m.device.ids == device_ids), None)
    if match is None:
        raise RuntimeError(f"El ratón {device_ids} no está conectado.")
    proto = protocols.get(proto_id)
    match.apply(settings, proto)
    print(f"Restaurado '{proto.mode(settings.mode).name}' en {match.device.label}")
    return 0


def _restore_memory(args):
    match = next((m for m in detect.scan() if m.protocol and m.protocol.id == "sunplus"), None)
    if match is None:
        raise RuntimeError("No se encontró conectado un ratón con chip Sunplus (Kalley).")
    print("Escribiendo la memoria original; no toques ni desconectes el ratón…")
    with match.open() as handle:
        sunplus.restore_backup(handle)
    print("Memoria original restaurada y comprobada.")
    return 0


def _diagnose(args):
    text = diagnostics.build_report(include_all=args.todos)
    if args.salida:
        with open(args.salida, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"Informe guardado en {args.salida}")
    else:
        print(text)
    return 0


COMMANDS = {"listar": _list, "efectos": _effects, "aplicar": _apply, "apagar": _off,
            "restaurar": _restore, "restaurar-memoria": _restore_memory,
            "diagnostico": _diagnose}
