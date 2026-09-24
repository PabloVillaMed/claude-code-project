// Combate: disparos del jugador y de la IA, golpes cuerpo a cuerpo, daño,
// muertes, delitos (nivel de búsqueda) y explosiones.

import * as THREE from 'three';
import { traceShot, deviate } from '../sim/ballistics.js';
import { computeDamage, WEAPON_BY_ID } from '../sim/weapons.js';
import { groundHeight } from '../sim/terrain.js';
import { dist2D, forwardX, forwardZ, yawFromDir } from '../sim/math.js';

const v3 = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
  }

  _scene(ignore) {
    const g = this.game;
    const characters = g.world.peds.map((p) => ({ ref: p, x: p.x, y: p.y, z: p.z, dead: !p.alive }));
    if (!g.player.inVehicle && !g.player.dead) characters.push({ ref: g.player, x: g.player.x, y: g.player.y, z: g.player.z });
    const vehicles = g.world.vehicles.map((v) => ({ ref: v, obb: v.obb(), y: v.state.y, height: v.state.spec.height }));
    return { collision: g.city.collision, groundHeight, characters, vehicles, ignore };
  }

  lineOfSight(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.game.city.collision.raycast(a.x, a.y, a.z, dx / d, dy / d, dz / d, d);
    return !hit;
  }

  /** Disparo del jugador. aim = {origin, dir} desde la cámara. */
  playerFire(shot, aim) {
    const g = this.game;
    const p = g.player;
    const w = shot.weapon;
    if (shot.empty) {
      g.audio.click();
      return;
    }
    if (w.kind === 'melee') {
      this.melee(p, w);
      return;
    }
    // 1) Punto al que apunta la mira (desde la cámara).
    const ignore = new Set([p, p.vehicle].filter(Boolean));
    const scene = this._scene(ignore);
    const aimHit = traceShot(aim.origin, aim.dir, w.range, scene);
    const target = { x: aimHit.x, y: aimHit.y, z: aimHit.z };
    // 2) Desde el cañón hacia ese punto, con dispersión.
    const muzzle = p.rig.muzzleWorld(v3).clone();
    if (p.inVehicle) muzzle.set(p.x, p.y + 1.4, p.z);
    let dx = target.x - muzzle.x;
    let dy = target.y - muzzle.y;
    let dz = target.z - muzzle.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const base = { x: dx / dl, y: dy / dl, z: dz / dl };
    g.effects.muzzleFlash(muzzle, base);
    g.audio.gunshot(w.id, muzzle);
    for (const pel of shot.pellets) {
      const d = deviate(base, pel.dYaw, pel.dPitch);
      const hit = traceShot(muzzle, d, w.range, scene);
      const end = new THREE.Vector3(hit.x, hit.y, hit.z);
      g.effects.tracer(muzzle, end);
      this._applyHit(hit, w, 'player', muzzle);
    }
    // Delito: disparos en público.
    this._reportShots(p.x, p.z);
    g.world.addThreat(p.x, p.z, 38 * (w.loud ?? 1));
    g.camRig.kick(w.id === 'shotgun' ? 0.03 : w.id === 'rifle' ? 0.012 : 0.008);
  }

  _reportShots(x, z) {
    const g = this.game;
    const witness = g.world.peds.some((q) => q.alive && q.faction !== 'gang' && dist2D(q.x, q.z, x, z) < (q.faction === 'police' ? 70 : 30));
    const copCar = g.world.policeUnits.some((u) => dist2D(u.vehicle.state.x, u.vehicle.state.z, x, z) < 70);
    if (witness || copCar) g.wanted.report('shotsFired', g.player);
  }

  _applyHit(hit, w, attacker, from) {
    const g = this.game;
    if (!hit.kind) return;
    const pos = { x: hit.x, y: hit.y, z: hit.z };
    const dist = Math.hypot(hit.x - from.x, hit.y - from.y, hit.z - from.z);
    const dmg = computeDamage(w, dist, hit.headshot);
    if (attacker === 'player' && (hit.kind === 'character' || hit.kind === 'vehicle')) g.hud.hitmarker();
    if (hit.kind === 'character') {
      if (hit.ref === g.player) this.damagePlayer(dmg, from);
      else this.damagePed(hit.ref, dmg, attacker, from, hit.headshot);
      g.effects.impact(pos, hit.normal, 'blood');
    } else if (hit.kind === 'vehicle') {
      const v = hit.ref;
      v.state.health -= dmg * 0.6;
      v.lastHitBy = attacker;
      g.effects.impact(pos, hit.normal, 'spark');
      g.audio.hit(pos);
      if (attacker === 'player' && v.driver && v.driver !== 'player') {
        v.panic = 15;
        if (v.kind === 'police') g.wanted.report('copAssault', g.player);
      }
    } else {
      g.effects.impact(pos, hit.normal, hit.kind === 'ground' ? 'dust' : 'spark');
    }
  }

  melee(attacker, w) {
    const g = this.game;
    const isPlayer = attacker === g.player;
    const ax = attacker.x;
    const az = attacker.z;
    const yaw = isPlayer ? attacker.state.yaw : attacker.sim.yaw;
    attacker.rig.punch();
    g.audio.swing();
    const fx = forwardX(yaw);
    const fz = forwardZ(yaw);
    if (isPlayer) {
      let best = null;
      let bd = w.range + 0.4;
      for (const p of g.world.peds) {
        if (!p.alive) continue;
        const dx = p.x - ax;
        const dz = p.z - az;
        const d = Math.hypot(dx, dz);
        if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.4) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        this.damagePed(best, w.damage, 'player', { x: ax, y: attacker.y + 1.2, z: az }, false, 'melee');
        g.effects.impact({ x: best.x, y: best.y + 1.3, z: best.z }, { x: fx, y: 0, z: fz }, 'blood');
        g.audio.hit({ x: best.x, y: best.y, z: best.z }, true);
      }
    } else if (dist2D(ax, az, g.player.x, g.player.z) < w.range + 0.3 && !g.player.inVehicle) {
      this.damagePlayer(w.damage * 0.6, { x: ax, y: attacker.y + 1.2, z: az });
      g.audio.hit(null, true);
    }
  }

  damagePed(p, dmg, attacker, from, headshot = false, how = 'gun') {
    const g = this.game;
    if (!p.alive) return;
    p.health -= dmg;
    p.sim.health = p.health;
    if (p.health <= 0) {
      p.health = 0;
      p.sim.mode = 'dead';
      p.sim.speed = 0;
      if (attacker === 'player') {
        if (p.faction === 'police') g.wanted.report('copKill', g.player);
        else if (p.faction === 'civil') g.wanted.report(g.wanted.level >= 2 ? 'murderRepeat' : 'murder', g.player);
        g.stats.kills++;
        if (headshot) g.hud.toast('¡Tiro a la cabeza!', 1.2);
        // Botín: plata y munición.
        g.pickups.drop(p.x, p.z, p.faction);
      }
      if (from) g.world.addThreat(p.x, p.z, 30);
      return;
    }
    if (attacker === 'player') {
      if (p.faction === 'civil') {
        p.sim.mode = 'flee';
        p.sim.fleeFrom = { x: from.x, z: from.z };
        p.sim.timer = 12;
        if (how !== 'impact') g.wanted.report('assault', g.player);
      } else {
        p.alerted = true;
        if (p.faction === 'police') g.wanted.report('copAssault', g.player);
      }
    }
  }

  damagePlayer(dmg, from) {
    const g = this.game;
    const p = g.player;
    if (p.dead || g.godMode) return;
    // El chaleco absorbe 2/3 del daño.
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, dmg * 0.66);
      p.armor -= absorbed;
      dmg -= absorbed;
    }
    p.health -= dmg;
    p.damageFlash = Math.min(1, p.damageFlash + dmg / 40);
    if (from) g.hud.damageFrom(from);
    if (p.health <= 0) g.killPlayer();
  }

  /** Ataque de un NPC hostil (policía / pandilla) contra el jugador. */
  npcAttack(ped, dt, player, dist) {
    ped.fireCooldown -= dt;
    const w = WEAPON_BY_ID[ped.weapon ?? 'fists'];
    if (ped.fireCooldown > 0) return;
    if (w.kind === 'melee') {
      if (dist < w.range + 0.3) {
        ped.fireCooldown = w.interval * 1.8;
        this.melee(ped, w);
      }
      return;
    }
    if (dist > 45) return;
    const eye = { x: ped.x, y: ped.y + 1.45, z: ped.z };
    const tgt = { x: player.x, y: player.y + 1.1, z: player.z };
    if (!this.lineOfSight(eye, tgt)) {
      ped.fireCooldown = 0.5;
      return;
    }
    ped.fireCooldown = (w.auto ? w.interval * 3 : 0.55) + Math.random() * 0.7;
    ped.sim.yaw = yawFromDir(tgt.x - eye.x, tgt.z - eye.z);
    const dx = tgt.x - eye.x;
    const dy = tgt.y - eye.y;
    const dz = tgt.z - eye.z;
    const dl = Math.hypot(dx, dy, dz);
    const base = { x: dx / dl, y: dy / dl, z: dz / dl };
    // Precisión: peor a distancia y si el jugador se mueve rápido.
    const sigma = 0.018 + dist * 0.0009 + Math.min(0.06, player.speed * 0.006) + (player.inVehicle ? 0.02 : 0);
    const d = deviate(base, (Math.random() - 0.5) * 2 * sigma, (Math.random() - 0.5) * 2 * sigma);
    const muzzle = ped.rig.muzzleWorld(v3).clone();
    const g = this.game;
    const scene = this._scene(new Set([ped]));
    if (player.inVehicle) {
      // Disparar al vehículo del jugador (y, a veces, al conductor).
      const v = player.vehicle;
      scene.vehicles = scene.vehicles.filter((x) => x.ref !== v);
      scene.characters.push({ ref: player, x: player.x, y: player.y - 0.3, z: player.z });
    }
    const hit = traceShot(muzzle, d, w.range, scene);
    g.effects.muzzleFlash(muzzle, d);
    g.effects.tracer(muzzle, new THREE.Vector3(hit.x, hit.y, hit.z));
    g.audio.gunshot(w.id, muzzle);
    if (hit.kind === 'character' && hit.ref === player) {
      this.damagePlayer(computeDamage(w, dist, false) * (ped.faction === 'police' ? 0.55 : 0.5), eye);
      g.effects.impact({ x: hit.x, y: hit.y, z: hit.z }, hit.normal, 'blood');
      if (player.inVehicle) player.vehicle.state.health -= 8;
    } else {
      this._applyHit(hit, w, 'npc', muzzle);
    }
  }

  explode(pos, source) {
    const g = this.game;
    g.effects.explosion(pos);
    g.audio.explosion(pos);
    g.world.addThreat(pos.x, pos.z, 60, 1);
    const R = 9;
    for (const p of g.world.peds) {
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < R) this.damagePed(p, 180 * (1 - d / R), source?.lastHitBy ?? 'vehicle', pos);
    }
    const pd = Math.hypot(g.player.x - pos.x, g.player.z - pos.z);
    if (pd < R) this.damagePlayer(140 * (1 - pd / R), pos);
    for (const v of g.world.vehicles) {
      if (v === source) continue;
      const d = Math.hypot(v.state.x - pos.x, v.state.z - pos.z);
      if (d < R) {
        v.state.health -= 700 * (1 - d / R);
        const l = d || 1;
        v.state.vx += ((v.state.x - pos.x) / l) * 6 * (1 - d / R);
        v.state.vz += ((v.state.z - pos.z) / l) * 6 * (1 - d / R);
      }
    }
    const cd = g.camera.position.distanceTo(v3.set(pos.x, pos.y, pos.z));
    g.camRig.shake(Math.max(0, 1 - cd / 60) * 0.6);
  }
}
