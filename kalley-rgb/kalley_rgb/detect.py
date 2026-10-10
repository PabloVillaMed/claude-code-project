"""Identifica que protocolo habla cada raton y por que coleccion HID hablarle."""

from dataclasses import dataclass

from . import hidio, protocols

# Modelos con protocolo verificado por terceros.
KNOWN_MODELS = {
    (0x30FA, 0x1440): "instant",
    (0x30FA, 0x1701): "instant-a704",
    (0x18F8, 0x1286): "instant-a704",
    (0x04D9, 0xA070): "holtek-a070",
    (0x1BCF, 0x08A0): "sunplus",  # Kalley K-GMOUSE6
}
# Fabricantes de chips cuyos ratones suelen hablar el protocolo Instant.
INSTANT_VIDS = {0x30FA, 0x18F8}
SUNPLUS_VID = 0x1BCF
# 30fa:1030 guarda la configuracion en la flash con otra familia de comandos.
NOTES = {
    (0x30FA, 0x1030): ("Este modelo usa una variante que reescribe la configuración "
                       "en la memoria del ratón; los comandos de esta app podrían no tener efecto."),
}

CONFIDENCE_ORDER = ("confirmado", "probable", "posible", "experimental", "sin protocolo")


@dataclass
class Match:
    device: hidio.Device
    protocol: object  # protocols.Protocol o None
    confidence: str
    reason: str
    descriptors: dict  # ruta -> (bytes, Descriptor)

    @property
    def summary(self):
        proto = self.protocol.name if self.protocol else "sin protocolo"
        return f"{self.device.label} — {proto} [{self.confidence}]"

    def target_path(self, protocol=None):
        """Ruta HID a la que se envian los reportes de luces."""
        protocol = protocol or self.protocol
        if protocol is None:
            return None
        with_report = [path for path, (_, desc) in self.descriptors.items()
                       if desc and _has_config_report(desc, protocol.report_id)]
        for path in with_report:
            desc = self.descriptors[path][1]
            if desc.feature(protocol.report_id).usage_page == protocol.usage_page:
                return path
        if with_report:
            return with_report[0]
        return _fallback_path(self.device.collections, protocol)

    def open(self, protocol=None):
        """Abre la coleccion de configuracion del raton para `protocol`."""
        protocol = protocol or self.protocol
        if protocol is None:
            raise RuntimeError("No hay protocolo para este ratón; elige uno manualmente.")
        path = self.target_path(protocol)
        if path is None:
            raise RuntimeError("El ratón no expone ninguna interfaz de configuración.")
        return hidio.HidHandle(path)

    def apply(self, settings, protocol=None):
        """Envia los ajustes al raton y devuelve los paquetes enviados."""
        protocol = protocol or self.protocol
        with self.open(protocol) as handle:
            return protocol.apply(handle, settings)


def _fallback_path(cols, protocol):
    """Sin descriptor: la coleccion que el protocolo suele usar, o la mas parecida."""
    for pick in (
        lambda c: c.interface == protocol.interface and c.usage_page == protocol.usage_page,
        lambda c: c.interface == protocol.interface and c.usage_page >= 0xFF00,
        lambda c: c.usage_page >= 0xFF00,
        lambda c: c.interface == protocol.interface,
    ):
        for c in cols:
            if pick(c):
                return c.path
    return None


def _has_config_report(desc, report_id=protocols.REPORT_ID):
    report = desc.feature(report_id)
    return report is not None and report.size == 8


def identify(device, descriptors=None):
    descriptors = descriptors or {}
    key = (device.vid, device.pid)
    if key in KNOWN_MODELS:
        return Match(device, protocols.get(KNOWN_MODELS[key]), "confirmado",
                     "Modelo con protocolo documentado.", descriptors)
    if key in NOTES:
        return Match(device, protocols.get("instant"), "experimental", NOTES[key], descriptors)
    if device.vid in INSTANT_VIDS:
        return Match(device, protocols.get("instant"), "probable",
                     "Chip Instant Microelectronics; se usa su protocolo más común.", descriptors)
    sunplus = protocols.get("sunplus")
    if device.vid == SUNPLUS_VID and any(
            desc and _has_config_report(desc, sunplus.report_id) for _, desc in descriptors.values()):
        return Match(device, sunplus, "probable",
                     "Chip Sunplus con el reporte de configuración 4; antes de escribir se "
                     "comprueba que su memoria tenga el formato conocido.", descriptors)

    for _, desc in descriptors.values():
        if desc and _has_config_report(desc):
            page = desc.feature(protocols.REPORT_ID).usage_page
            proto = "holtek-a070" if page == 0xFF00 else "instant"
            return Match(device, protocols.get(proto), "posible",
                         "Tiene el reporte de configuración de 8 bytes (ID 7) que usan "
                         "los chips Instant y Holtek. Prueba un efecto para confirmarlo.",
                         descriptors)
    return Match(device, None, "sin protocolo",
                 "No se reconoce el chip. Usa 'Diagnóstico' y comparte el resultado.",
                 descriptors)


def scan(read_descriptors=True):
    """Devuelve los ratones conectados, los mas prometedores primero."""
    matches = []
    for device in hidio.enumerate_devices():
        if not (device.is_mouse or device.vid in INSTANT_VIDS
                or (device.vid, device.pid) in KNOWN_MODELS):
            continue
        descriptors = {}
        if read_descriptors:
            for path in device.paths():
                raw, desc = hidio.read_descriptor(path)
                if raw:
                    descriptors[path] = (raw, desc)
        matches.append(identify(device, descriptors))
    matches.sort(key=lambda m: CONFIDENCE_ORDER.index(m.confidence))
    return matches
