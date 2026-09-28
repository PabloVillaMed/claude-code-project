import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
const OUT = '/tmp/claude-0/-home-user-claude-code-project/79af1a98-c0b9-5538-96b9-3ad1afe6ad92/scratchpad/tex';
fs.mkdirSync(OUT, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2] ?? 'public/models/personajes/jugador.glb');
const root = doc.getRoot();
for (const m of root.listMaterials()) console.log('mat', m.getName(), m.getBaseColorTexture()?.getName(), m.getBaseColorTexture()?.getMimeType(), m.getBaseColorFactor());
for (const me of root.listMeshes()) for (const p of me.listPrimitives()) console.log('mesh', me.getName(), p.getMaterial()?.getName(), p.getAttribute('POSITION').getCount(), p.getIndices()?.getCount() / 3);
root.listTextures().forEach((t, i) => {
  fs.writeFileSync(`${OUT}/${i}-${t.getName()}.webp`, t.getImage());
  console.log('tex', i, t.getName(), t.getSize());
});
console.log(root.listNodes().map((n) => n.getName()).join(' '));
