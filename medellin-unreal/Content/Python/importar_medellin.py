"""
Importa a Unreal Engine 5 el mundo exportado del juego web.

Antes: en medellin-aranjuez/ correr `npm run exportar:unreal` (deja los
archivos en medellin-unreal/Importar).

En el editor de Unreal, con este proyecto abierto:
    Tools (Herramientas) > Execute Python Script... > Content/Python/importar_medellin.py
o en el Output Log, con la consola en modo "Python":
    import importar_medellin; importar_medellin.run()

Opciones:
    importar_medellin.run(vegetacion=True, pasto=False, modelos=True, radio_m=None)
      vegetacion  árboles, arbustos y enredaderas
      pasto       matas de pasto (muchas: mejor usar el Foliage de Unreal)
      modelos     personajes, vehículos y armas originales (glb)
      radio_m     solo la utilería a menos de N metros de la aparición del jugador

Qué hace:
  1. Importa calibracion.glb y mide cómo convierte los ejes el importador de
     glTF de esta versión de Unreal (three.js: metros, Y arriba; Unreal:
     centímetros, Z arriba). Así la utilería queda donde va en cualquier versión.
  2. Crea (o limpia) el nivel /Game/Medellin/Mapas/Aranjuez.
  3. Importa las piezas del mundo (terreno, calles, edificios...) y las pone en
     el origen: sus vértices ya vienen en coordenadas del mundo.
  4. Importa cada plantilla de utilería y la reparte con componentes de
     instancias (o actores sueltos si esta versión no deja crearlos).
  5. Un material con color de vértice para las fachadas (cada casa de su color).
  6. Sol, cielo, niebla, luz del cielo y un PlayerStart en la aparición.
"""
import json
import math
import os

import unreal

DEST = "/Game/Medellin/Importado"
MATERIALES = "/Game/Medellin/Materiales"
MAPA = "/Game/Medellin/Mapas/Aranjuez"
CARPETA = "Medellin"  # carpeta de los actores en el World Outliner


# --------------------------------------------------------------------- útiles
def _log(msg):
    unreal.log("[Medellin] " + str(msg))


def _warn(msg):
    unreal.log_warning("[Medellin] " + str(msg))


def _dir_importar():
    proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    return os.path.join(proj, "Importar")


def _asset_tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def _importar_varios(pares):
    """pares: [(archivo, carpeta_destino)]. Devuelve {carpeta: [StaticMesh]}."""
    tareas = []
    for archivo, destino in pares:
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", archivo)
        t.set_editor_property("destination_path", destino)
        t.set_editor_property("automated", True)
        t.set_editor_property("save", True)
        t.set_editor_property("replace_existing", True)
        tareas.append(t)
    if tareas:
        _asset_tools().import_asset_tasks(tareas)
    salida = {}
    for archivo, destino in pares:
        salida[destino] = _mallas_en(destino)
    return salida


def _mallas_en(carpeta, clase=None):
    clase = clase or unreal.StaticMesh
    out = []
    if not unreal.EditorAssetLibrary.does_directory_exist(carpeta):
        return out
    for ruta in unreal.EditorAssetLibrary.list_assets(carpeta, recursive=True, include_folder=False):
        a = unreal.EditorAssetLibrary.load_asset(ruta)
        if isinstance(a, clase):
            out.append(a)
    return out


def _actor_subsystem():
    try:
        return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    except Exception:
        return None


def _spawn_object(obj, pos, rot=None):
    rot = rot or unreal.Rotator(0, 0, 0)
    sub = _actor_subsystem()
    if sub:
        return sub.spawn_actor_from_object(obj, pos, rot)
    return unreal.EditorLevelLibrary.spawn_actor_from_object(obj, pos, rot)


def _spawn_class(cls, pos, rot=None):
    rot = rot or unreal.Rotator(0, 0, 0)
    sub = _actor_subsystem()
    if sub:
        return sub.spawn_actor_from_class(cls, pos, rot)
    return unreal.EditorLevelLibrary.spawn_actor_from_class(cls, pos, rot)


def _todos_los_actores():
    sub = _actor_subsystem()
    if sub:
        return sub.get_all_level_actors()
    return unreal.EditorLevelLibrary.get_all_level_actors()


def _destruir(actor):
    sub = _actor_subsystem()
    if sub:
        sub.destroy_actor(actor)
    else:
        unreal.EditorLevelLibrary.destroy_actor(actor)


# ------------------------------------------------------------ ejes (matrices)
def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mat_inv(m):
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if abs(det) < 1e-12:
        raise ValueError("matriz singular")
    inv = [
        [(e * i - f * h), -(b * i - c * h), (b * f - c * e)],
        [-(d * i - f * g), (a * i - c * g), -(a * f - c * d)],
        [(d * h - e * g), -(a * h - b * g), (a * e - b * d)],
    ]
    return [[x / det for x in fila] for fila in inv]


def _det(m):
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)


# Si la calibración falla: la conversión habitual del importador de glTF de
# Unreal (adelante +Z de glTF -> +X, derecha +X -> +Y, arriba +Y -> +Z), en cm.
P_RESPALDO = [[0, 0, 100], [100, 0, 0], [0, 100, 0]]


def _calibrar(carpeta_import):
    archivo = os.path.join(carpeta_import, "calibracion.glb")
    destino = DEST + "/Calibracion"
    mallas = _importar_varios([(archivo, destino)])[destino]
    centros = {}
    for sm in mallas:
        nombre = sm.get_name().lower()
        for eje in ("cal_x", "cal_y", "cal_z"):
            if eje in nombre:
                caja = sm.get_bounding_box()
                mn, mx = caja.min, caja.max
                centros[eje] = [(mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2]
    if len(centros) != 3:
        _warn("calibración incompleta (%d de 3 cubos); se usa la conversión habitual" % len(centros))
        return P_RESPALDO
    # Columna j = imagen del eje j de three.js (por metro).
    cols = [[v / 10.0 for v in centros[e]] for e in ("cal_x", "cal_y", "cal_z")]
    p = [[cols[j][i] for j in range(3)] for i in range(3)]
    largos = [math.sqrt(sum(c * c for c in col)) for col in cols]
    if min(largos) < 1e-3:
        _warn("los cubos de calibración quedaron en el origen (¿se recentró el pivote al importar?); se usa la conversión habitual")
        return P_RESPALDO
    _log("ejes three.js -> Unreal: X->%s Y->%s Z->%s (cm por metro)" % tuple(str([round(v, 1) for v in c]) for c in cols))
    return p


def _transformar(p, p_inv, e):
    """Matriz 4x4 de three.js (lista por columnas) -> (posición, rotador, escala) de Unreal."""
    r = [[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]]
    t = [e[12], e[13], e[14]]
    a = _mat_mul(_mat_mul(p, r), p_inv)
    pos = [sum(p[i][k] * t[k] for k in range(3)) for i in range(3)]
    cx = [a[0][0], a[1][0], a[2][0]]
    cy = [a[0][1], a[1][1], a[2][1]]
    cz = [a[0][2], a[1][2], a[2][2]]
    sx = math.sqrt(sum(v * v for v in cx)) or 1.0
    sy = math.sqrt(sum(v * v for v in cy)) or 1.0
    sz = math.sqrt(sum(v * v for v in cz)) or 1.0
    if _det(a) < 0:
        sy = -sy
    rot = unreal.MathLibrary.make_rot_from_xz(
        unreal.Vector(cx[0] / sx, cx[1] / sx, cx[2] / sx), unreal.Vector(cz[0] / sz, cz[1] / sz, cz[2] / sz)
    )
    return unreal.Vector(*pos), rot, unreal.Vector(sx, sy, sz)


# ------------------------------------------------------------------- nivel
def _abrir_nivel():
    les = None
    try:
        les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    except Exception:
        pass
    if unreal.EditorAssetLibrary.does_asset_exist(MAPA):
        ok = les.load_level(MAPA) if les else unreal.EditorLevelLibrary.load_level(MAPA)
        # Limpiar lo que dejó una importación anterior.
        n = 0
        for actor in _todos_los_actores():
            if str(actor.get_folder_path()).startswith(CARPETA):
                _destruir(actor)
                n += 1
        _log("nivel existente abierto (%s), %d actores anteriores quitados" % (ok, n))
    else:
        ok = les.new_level(MAPA) if les else unreal.EditorLevelLibrary.new_level(MAPA)
        _log("nivel nuevo %s (%s)" % (MAPA, ok))
    return les


def _guardar_nivel(les):
    try:
        if les:
            les.save_current_level()
        else:
            unreal.EditorLevelLibrary.save_current_level()
    except Exception as ex:
        _warn("no se pudo guardar el nivel: %s" % ex)


def _ambiente(p, aparicion):
    def carpeta(a, sub="Ambiente"):
        a.set_folder_path(CARPETA + "/" + sub)
        return a

    sol = carpeta(_spawn_class(unreal.DirectionalLight, unreal.Vector(0, 0, 50000), unreal.Rotator(-15, -50, 0)))
    sol.set_actor_label("Sol")
    try:
        comp = sol.get_component_by_class(unreal.DirectionalLightComponent)
        comp.set_editor_property("intensity", 8.0)
        comp.set_editor_property("atmosphere_sun_light", True)
    except Exception:
        pass
    carpeta(_spawn_class(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0))).set_actor_label("Atmosfera")
    luz = carpeta(_spawn_class(unreal.SkyLight, unreal.Vector(0, 0, 20000)))
    luz.set_actor_label("LuzDelCielo")
    try:
        sc = luz.get_component_by_class(unreal.SkyLightComponent)
        sc.set_editor_property("real_time_capture", True)
    except Exception:
        pass
    carpeta(_spawn_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))).set_actor_label("Niebla")
    try:
        carpeta(_spawn_class(unreal.VolumetricCloud, unreal.Vector(0, 0, 0))).set_actor_label("Nubes")
    except Exception:
        pass
    if aparicion:
        t = [aparicion["x"], aparicion.get("y", 0) + 1.0, aparicion["z"]]
        pos = [sum(p[i][k] * t[k] for k in range(3)) for i in range(3)]
        carpeta(_spawn_class(unreal.PlayerStart, unreal.Vector(*pos)), "Juego").set_actor_label("Aparicion")


# --------------------------------------------------------- color de vértice
def _material_color_vertice():
    """M_ColorVertice: color de vértice x textura x tinte (fachadas, techos...)."""
    ruta = MATERIALES + "/M_ColorVertice"
    if unreal.EditorAssetLibrary.does_asset_exist(ruta):
        return unreal.EditorAssetLibrary.load_asset(ruta)
    mel = unreal.MaterialEditingLibrary
    mat = _asset_tools().create_asset("M_ColorVertice", MATERIALES, unreal.Material, unreal.MaterialFactoryNew())
    vc = mel.create_material_expression(mat, unreal.MaterialExpressionVertexColor, -700, 0)
    tex = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -700, 200)
    tex.set_editor_property("parameter_name", "Textura")
    blanco = unreal.EditorAssetLibrary.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    if blanco:
        tex.set_editor_property("texture", blanco)
    tinte = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -700, 450)
    tinte.set_editor_property("parameter_name", "Tinte")
    tinte.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    m1 = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -400, 100)
    mel.connect_material_expressions(vc, "", m1, "A")
    mel.connect_material_expressions(tex, "RGB", m1, "B")
    m2 = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -200, 200)
    mel.connect_material_expressions(m1, "", m2, "A")
    mel.connect_material_expressions(tinte, "", m2, "B")
    mel.connect_material_property(m2, "", unreal.MaterialProperty.MP_BASE_COLOR)
    rug = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -400, 400)
    rug.set_editor_property("parameter_name", "Rugosidad")
    rug.set_editor_property("default_value", 0.85)
    mel.connect_material_property(rug, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    return mat


def _copiar_parametros(viejo, nuevo):
    mel = unreal.MaterialEditingLibrary
    # Textura de color y color base del material que creó el importador de glTF.
    for nombre in ("BaseColorTexture", "BaseColor", "Base Color Texture", "DiffuseTexture"):
        try:
            t = mel.get_material_instance_texture_parameter_value(viejo, nombre)
            if t:
                mel.set_material_instance_texture_parameter_value(nuevo, "Textura", t)
                break
        except Exception:
            pass
    for nombre in ("BaseColorFactor", "BaseColor", "Base Color Factor"):
        try:
            c = mel.get_material_instance_vector_parameter_value(viejo, nombre)
            if c and (c.r, c.g, c.b) != (0, 0, 0):
                mel.set_material_instance_vector_parameter_value(nuevo, "Tinte", c)
                break
        except Exception:
            pass


def _usar_color_vertice(mallas):
    """Los materiales exportados con color de vértice llevan "_vc" en el nombre."""
    base = None
    hechos = {}
    n = 0
    for sm in mallas:
        try:
            slots = sm.get_editor_property("static_materials")
        except Exception:
            continue
        for i, slot in enumerate(slots):
            mi = slot.get_editor_property("material_interface")
            nombre = str(slot.get_editor_property("material_slot_name"))
            if "_vc" not in nombre.lower() and not (mi and "_vc" in mi.get_name().lower()):
                continue
            if base is None:
                base = _material_color_vertice()
            clave = mi.get_name() if mi else nombre
            nuevo = hechos.get(clave)
            if nuevo is None:
                nuevo = _asset_tools().create_asset(
                    "MI_" + clave.replace("MI_", ""), MATERIALES + "/ColorVertice", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew()
                )
                unreal.MaterialEditingLibrary.set_material_instance_parent(nuevo, base)
                if mi:
                    _copiar_parametros(mi, nuevo)
                unreal.EditorAssetLibrary.save_loaded_asset(nuevo)
                hechos[clave] = nuevo
            sm.set_material(i, nuevo)
            n += 1
        unreal.EditorAssetLibrary.save_loaded_asset(sm)
    _log("color de vértice: %d ranuras de material" % n)


# ------------------------------------------------------------- instancias
def _ism(nombre, mallas, transformadas, sub):
    """Un actor con un componente de instancias por malla. None si no se puede."""
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    actor = _spawn_class(unreal.Actor, unreal.Vector(0, 0, 0))
    actor.set_actor_label(nombre)
    actor.set_folder_path(CARPETA + "/" + sub)
    raiz = sds.k2_gather_subobject_data_for_instance(actor)[0]
    for sm in mallas:
        params = unreal.AddNewSubobjectParams(parent_handle=raiz, new_class=unreal.HierarchicalInstancedStaticMeshComponent, blueprint_context=None)
        handle, _fallo = sds.add_new_subobject(params)
        data = unreal.SubobjectDataBlueprintFunctionLibrary.get_data(handle)
        comp = unreal.SubobjectDataBlueprintFunctionLibrary.get_object(data)
        comp.set_static_mesh(sm)
        # El actor está en el origen sin girar: espacio local = mundo.
        comp.add_instances(transformadas, False)
    return actor


def _repartir(nombre, mallas, lista, p, p_inv, sub):
    trs = [_transformar(p, p_inv, e) for e in lista]
    if len(trs) > 20:
        try:
            _ism(nombre, mallas, [unreal.Transform(pos, rot, esc) for pos, rot, esc in trs], sub)
            return "instancias"
        except Exception as ex:
            _warn("%s: sin componentes de instancias (%s); se ponen actores sueltos" % (nombre, ex))
    with unreal.ScopedSlowTask(len(trs), "Colocando " + nombre) as tarea:
        tarea.make_dialog(True)
        for pos, rot, esc in trs:
            if tarea.should_cancel():
                break
            tarea.enter_progress_frame(1)
            for sm in mallas:
                a = _spawn_object(sm, pos, rot)
                a.set_actor_scale3d(esc)
                a.set_folder_path(CARPETA + "/" + sub + "/" + nombre)
    return "actores"


# --------------------------------------------------------------- principal
def run(vegetacion=True, pasto=False, modelos=True, radio_m=None):
    origen = _dir_importar()
    if not os.path.isdir(origen):
        raise RuntimeError("No existe %s: primero `npm run exportar:unreal` en medellin-aranjuez" % origen)
    with open(os.path.join(origen, "instancias.json"), encoding="utf-8") as f:
        inst = json.load(f)
    with open(os.path.join(origen, "puntos.json"), encoding="utf-8") as f:
        puntos = json.load(f)

    p = _calibrar(origen)
    p_inv = _mat_inv(p)
    les = _abrir_nivel()

    # Mundo.
    carpeta_mundo = os.path.join(origen, "mundo")
    archivos = sorted(f for f in os.listdir(carpeta_mundo) if f.lower().endswith(".glb"))
    _log("importando %d piezas del mundo (puede tardar)..." % len(archivos))
    pares = [(os.path.join(carpeta_mundo, f), DEST + "/Mundo/" + f[:-4]) for f in archivos]
    mundo = []
    for mallas in _importar_varios(pares).values():
        mundo.extend(mallas)
    _usar_color_vertice(mundo)
    for sm in mundo:
        a = _spawn_object(sm, unreal.Vector(0, 0, 0))
        a.set_actor_label(sm.get_name())
        a.set_folder_path(CARPETA + "/Mundo")
    _log("mundo: %d mallas en el origen" % len(mundo))

    # Utilería e instancias.
    centro = puntos.get("aparicion")
    elegidas = {}
    for nombre, d in inst["plantillas"].items():
        low = nombre.lower()
        if low.startswith("pasto") and not pasto:
            continue
        if not vegetacion and (low.startswith("arbol") or low.startswith("arbust") or low.startswith("enredadera")):
            continue
        lista = d["matrices"]
        if radio_m and centro:
            lista = [e for e in lista if math.hypot(e[12] - centro["x"], e[14] - centro["z"]) <= radio_m]
        if lista:
            elegidas[nombre] = (d, lista)
    pares = [(os.path.join(origen, d["archivo"]), DEST + "/Plantillas/" + nombre) for nombre, (d, _l) in elegidas.items()]
    _log("importando %d plantillas de utilería..." % len(pares))
    mallas_de = _importar_varios(pares)
    _usar_color_vertice([sm for ms in mallas_de.values() for sm in ms])
    total = 0
    for nombre, (d, lista) in elegidas.items():
        mallas = mallas_de.get(DEST + "/Plantillas/" + nombre) or []
        if not mallas:
            _warn("%s: no se importó ninguna malla" % nombre)
            continue
        sub = "Vegetacion" if nombre.lower().startswith(("arbol", "arbust", "enredadera", "pasto")) else "Utileria"
        modo = _repartir(nombre, mallas, lista, p, p_inv, sub)
        total += len(lista)
        _log("%s: %d copias (%s)" % (nombre, len(lista), modo))
    _log("utilería: %d copias en total" % total)

    # Modelos originales (no van al nivel: quedan en el Content Browser).
    if modelos:
        pares = []
        for sub in ("personajes", "vehiculos", "armas"):
            carpeta = os.path.join(origen, "modelos", sub)
            if not os.path.isdir(carpeta):
                continue
            for f in sorted(os.listdir(carpeta)):
                # animaciones.glb viene empacado a la medida del juego web: no sirve en Unreal.
                if f.lower().endswith(".glb") and f != "animaciones.glb":
                    pares.append((os.path.join(carpeta, f), DEST + "/Modelos/" + sub.capitalize() + "/" + f[:-4]))
        _log("importando %d modelos (personajes, vehículos, armas)..." % len(pares))
        _importar_varios(pares)

    _ambiente(p, centro)
    _guardar_nivel(les)
    _log("listo: abre %s (ya está guardado). Ver LEEME.md para seguir." % MAPA)


if __name__ == "__main__":
    run()
