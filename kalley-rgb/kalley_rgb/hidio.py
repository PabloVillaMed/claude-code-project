"""Acceso a dispositivos HID a traves de la libreria hidapi (paquete `hidapi`)."""

from dataclasses import dataclass, field

from . import descriptor as hid_descriptor


class HidUnavailable(RuntimeError):
    pass


def _hid():
    try:
        import hid
    except ImportError as exc:
        raise HidUnavailable(
            "Falta la librería hidapi. Instálala con:  pip install hidapi") from exc
    if not hasattr(hid, "device"):
        raise HidUnavailable(
            "El módulo 'hid' instalado no es el de hidapi. Ejecuta:\n"
            "  pip uninstall hid\n  pip install hidapi")
    return hid


@dataclass
class Collection:
    """Una coleccion HID de nivel superior (en Windows cada una tiene su propia ruta)."""

    path: bytes
    interface: int
    usage_page: int
    usage: int


@dataclass
class Device:
    vid: int
    pid: int
    manufacturer: str
    product: str
    serial: str
    release: int
    collections: list = field(default_factory=list)

    @property
    def ids(self):
        return f"{self.vid:04x}:{self.pid:04x}"

    @property
    def label(self):
        name = " ".join(s for s in (self.manufacturer, self.product) if s).strip()
        return f"{name or 'Dispositivo HID'} ({self.ids})"

    @property
    def is_mouse(self):
        return any(c.usage_page == 0x01 and c.usage == 0x02 for c in self.collections)

    def paths(self):
        seen = []
        for c in self.collections:
            if c.path not in seen:
                seen.append(c.path)
        return seen


def enumerate_devices():
    """Agrupa las entradas de hid.enumerate() por dispositivo fisico."""
    hid = _hid()
    devices = {}
    for info in hid.enumerate():
        # Dos ratones identicos sin numero de serie se verian como uno solo;
        # hidapi no da un dato comun mas fiable en todas las plataformas.
        key = (info["vendor_id"], info["product_id"], info.get("serial_number") or "")
        dev = devices.get(key)
        if dev is None:
            dev = devices[key] = Device(
                vid=info["vendor_id"], pid=info["product_id"],
                manufacturer=(info.get("manufacturer_string") or "").strip(),
                product=(info.get("product_string") or "").strip(),
                serial=(info.get("serial_number") or "").strip(),
                release=info.get("release_number") or 0)
        dev.collections.append(Collection(
            path=info["path"], interface=info.get("interface_number", -1),
            usage_page=info.get("usage_page", 0), usage=info.get("usage", 0)))
    return list(devices.values())



class HidHandle:
    def __init__(self, path):
        hid = _hid()
        self.path = path
        self._dev = hid.device()
        try:
            self._dev.open_path(path)
        except (OSError, IOError) as exc:
            raise OSError(_open_error_hint(path)) from exc

    def send_feature_report(self, data):
        written = self._dev.send_feature_report(bytes(data))
        if written < 0:
            raise OSError(f"El ratón rechazó el reporte {bytes(data).hex(' ')}: este chip "
                          "probablemente no es el de tu ratón.")
        return written

    def get_feature_report(self, report_id, length):
        return bytes(self._dev.get_feature_report(report_id, length))

    def report_descriptor(self):
        return bytes(self._dev.get_report_descriptor())

    def close(self):
        self._dev.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _open_error_hint(path):
    import sys
    msg = f"No se pudo abrir {path!r}."
    if sys.platform.startswith("linux"):
        msg += (" En Linux hace falta permiso sobre /dev/hidraw*: instala la regla "
                "linux/70-kalley-rgb.rules (ver README) o ejecuta con sudo.")
    else:
        msg += " Cierra otros programas de RGB que puedan estar usando el ratón."
    return msg


def read_descriptor(path):
    """Devuelve (bytes, Descriptor) o (None, None) si el sistema no lo entrega."""
    try:
        with HidHandle(path) as handle:
            raw = handle.report_descriptor()
    except Exception:
        return None, None
    if not raw:
        return None, None
    return raw, hid_descriptor.parse(raw)
