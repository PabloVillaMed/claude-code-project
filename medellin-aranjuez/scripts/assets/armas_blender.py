# Conversión de fuentes .blend / .fbx a GLB "crudo" para scripts/assets/armas.mjs.
# Se ejecuta con el módulo `bpy` de Blender (pip install bpy); armas.mjs lo
# llama solo:  python armas_blender.py -- <entrada> <salida.glb> [objeto,objeto,...]
#
# Deja solo los objetos de malla pedidos (o todas las mallas si no se indica
# lista), aplica sus transformaciones y exporta GLB con normales, UV y los
# nombres de material originales (armas.mjs reasigna los materiales).

import sys
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
keep = set(args[2].split(',')) if len(args) > 2 and args[2] else None

if src.lower().endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=src)
    else:
        raise SystemExit(f'Formato no soportado: {src}')

for o in list(bpy.data.objects):
    if o.type != 'MESH' or (keep is not None and o.name not in keep):
        bpy.data.objects.remove(o, do_unlink=True)

# Aplicar modificadores y transformaciones (el GLB queda con nodos identidad).
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    o.hide_set(False)
    o.hide_viewport = False
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
for o in bpy.context.scene.objects:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:  # noqa: BLE001
            print('modificador no aplicado', o.name, m.name, e)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_materials='EXPORT',
    export_yup=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
print('ok', out, [o.name for o in bpy.context.scene.objects])
