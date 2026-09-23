// Objetos recogibles: plata, munición, botiquín y chaleco.

import * as THREE from 'three';
import { groundHeight } from '../sim/terrain.js';
import { WEAPONS } from '../sim/weapons.js';

const MATS = {};
function matFor(type) {
  if (!MATS[type]) {
    const color = { cash: 0x2e8b57, ammo: 0xc9a227, health: 0xe63946, armor: 0x3a86ff }[type];
    MATS[type] = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 });
  }
  return MATS[type];
}

function meshFor(type) {
  const g = new THREE.Group();
  if (type === 'cash') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.16), matFor(type));
    const m2 = m.clone();
    m2.position.y = 0.09;
    m2.rotation.y = 0.3;
    g.add(m, m2);
  } else if (type === 'health') {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.13), matFor(type));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.13), matFor(type));
    g.add(a, b);
  } else if (type === 'armor') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.14), matFor(type)));
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), matFor(type)));
  }
  return g;
}

export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.t = 0;
    // Recogibles fijos que reaparecen.
    const fixed = [
      ['health', 'hospital', 0, 4],
      ['armor', 'armeria', 3, 0],
      ['health', 'parque', -12, -10],
      ['armor', 'cancha', 0, -12],
      ['health', 'mirador', 8, 0],
    ];
    for (const [type, poiId, dx, dz] of fixed) {
      const poi = game.city.pois.find((p) => p.id === poiId);
      if (poi) this.add(type, poi.x + dx, poi.z + dz, type === 'health' ? 50 : 50, 60);
    }
  }

  add(type, x, z, amount, respawn = 0, weaponId = null) {
    const mesh = meshFor(type);
    const y = groundHeight(x, z) + 0.6;
    mesh.position.set(x, y, z);
    this.game.scene.add(mesh);
    const it = { type, x, y, z, amount, respawn, weaponId, mesh, cooldown: 0, life: respawn ? Infinity : 45 };
    this.items.push(it);
    return it;
  }

  drop(x, z, faction) {
    const r = Math.random();
    this.add('cash', x + 0.4, z, faction === 'civil' ? 20 + Math.floor(r * 80) : 60 + Math.floor(r * 140));
    if (faction !== 'civil') {
      const guns = WEAPONS.filter((w) => w.kind === 'gun');
      const w = faction === 'police' ? 'pistol' : guns[Math.floor(Math.random() * 2)].id;
      this.add('ammo', x - 0.4, z + 0.3, 24, 0, w);
    }
  }

  update(dt, player) {
    this.t += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.cooldown > 0) {
        it.cooldown -= dt;
        it.mesh.visible = it.cooldown <= 0;
        continue;
      }
      it.mesh.rotation.y += dt * 2;
      it.mesh.position.y = it.y + Math.sin(this.t * 3 + i) * 0.12;
      it.life -= dt;
      if (it.life <= 0) {
        it.mesh.removeFromParent();
        this.items.splice(i, 1);
        continue;
      }
      if (player.dead) continue;
      const d = Math.hypot(player.x - it.x, player.z - it.z);
      if (d < (player.inVehicle ? 2.2 : 1.1) && Math.abs(player.y - it.y) < 3) {
        if (this._collect(it, player)) {
          if (it.respawn) {
            it.cooldown = it.respawn;
            it.mesh.visible = false;
          } else {
            it.mesh.removeFromParent();
            this.items.splice(i, 1);
          }
        }
      }
    }
  }

  _collect(it, player) {
    const g = this.game;
    switch (it.type) {
      case 'cash':
        g.addMoney(it.amount);
        return true;
      case 'health':
        if (player.health >= 100) return false;
        player.health = Math.min(100, player.health + it.amount);
        g.hud.toast(`+${it.amount} salud`);
        g.audio.ui('ok');
        return true;
      case 'armor':
        if (player.armor >= 100) return false;
        player.armor = Math.min(100, player.armor + it.amount);
        g.hud.toast(`+${it.amount} chaleco`);
        g.audio.ui('ok');
        return true;
      case 'ammo': {
        const inv = player.inventory;
        const id = it.weaponId ?? 'pistol';
        if (!inv.has(id)) {
          inv.give(id, it.amount);
          g.hud.toast(`Recogiste: ${WEAPONS.find((w) => w.id === id).name}`);
        } else {
          inv.addAmmo(id, it.amount);
          g.hud.toast(`+${it.amount} balas`);
        }
        g.audio.ui('ok');
        return true;
      }
      default:
        return false;
    }
  }
}
