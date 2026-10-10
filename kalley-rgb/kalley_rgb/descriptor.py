"""Lectura minima de descriptores de reporte HID.

Solo extrae lo que la app necesita: que reportes declara cada coleccion,
de que tipo son (input/output/feature) y cuantos bytes ocupan.
"""

from dataclasses import dataclass, field

_MAIN_INPUT, _MAIN_OUTPUT, _MAIN_FEATURE = 0x8, 0x9, 0xB
_MAIN_COLLECTION, _MAIN_END_COLLECTION = 0xA, 0xC
_GLOBAL_USAGE_PAGE, _GLOBAL_REPORT_SIZE = 0x0, 0x7
_GLOBAL_REPORT_ID, _GLOBAL_REPORT_COUNT = 0x8, 0x9
_GLOBAL_PUSH, _GLOBAL_POP = 0xA, 0xB
_LOCAL_USAGE = 0x0


@dataclass
class Report:
    report_id: int
    kind: str  # "input", "output" o "feature"
    usage_page: int  # de la coleccion de nivel superior que lo contiene
    bits: int = 0

    @property
    def size(self):
        """Bytes en el cable, contando el byte de ID cuando existe."""
        return (self.bits + 7) // 8 + (1 if self.report_id else 0)


@dataclass
class Descriptor:
    collections: list = field(default_factory=list)  # (usage_page, usage)
    reports: list = field(default_factory=list)

    def feature(self, report_id):
        for r in self.reports:
            if r.kind == "feature" and r.report_id == report_id:
                return r
        return None


def parse(data):
    data = bytes(data)
    desc = Descriptor()
    reports = {}
    state = {"page": 0, "size": 0, "count": 0, "id": 0}
    stack = []
    usages = []
    depth = 0
    top_page = 0
    i = 0
    while i < len(data):
        prefix = data[i]
        if prefix == 0xFE:  # item largo, no se usa en ratones
            i += 3 + (data[i + 1] if i + 1 < len(data) else 0)
            continue
        size = (0, 1, 2, 4)[prefix & 0x3]
        kind = (prefix >> 2) & 0x3
        tag = prefix >> 4
        value = int.from_bytes(data[i + 1:i + 1 + size], "little")
        i += 1 + size

        if kind == 1:  # global
            if tag == _GLOBAL_USAGE_PAGE:
                state["page"] = value
            elif tag == _GLOBAL_REPORT_SIZE:
                state["size"] = value
            elif tag == _GLOBAL_REPORT_COUNT:
                state["count"] = value
            elif tag == _GLOBAL_REPORT_ID:
                state["id"] = value
            elif tag == _GLOBAL_PUSH:
                stack.append(dict(state))
            elif tag == _GLOBAL_POP and stack:
                state = stack.pop()
        elif kind == 2:  # local
            if tag == _LOCAL_USAGE:
                usages.append(value if size == 4 else (state["page"] << 16) | value)
        elif kind == 0:  # main
            if tag == _MAIN_COLLECTION:
                if depth == 0:
                    usage = usages[0] if usages else 0
                    top_page = usage >> 16
                    desc.collections.append((top_page, usage & 0xFFFF))
                depth += 1
            elif tag == _MAIN_END_COLLECTION:
                depth = max(0, depth - 1)
            elif tag in (_MAIN_INPUT, _MAIN_OUTPUT, _MAIN_FEATURE):
                name = {_MAIN_INPUT: "input", _MAIN_OUTPUT: "output", _MAIN_FEATURE: "feature"}[tag]
                key = (state["id"], name)
                if key not in reports:
                    reports[key] = Report(state["id"], name, top_page)
                    desc.reports.append(reports[key])
                reports[key].bits += state["size"] * state["count"]
            usages = []
    return desc
