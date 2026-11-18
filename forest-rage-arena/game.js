import * as THREE from 'three';
import { boundary, camera, makeFighter, makeShield, obstacles, removeModel, renderer, scene, updateForest } from './world.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  health: $('#health'), hp: $('#hp-value'), rage: $('#rage'), rageValue: $('#rage-value'),
  points: $('#rage-points'), remaining: $('#remaining'), boss: $('#boss-hud'),
  bossBar: $('#boss-health'), bossValue: $('#boss-percent'), hurt: $('#hurt-screen'),
  notice: $('#notice'), floaters: $('#floaters'), result: $('#result'),
};
const settings = {
  attack: { cost: 0, duration: .36, hit: .13 },
  charge: { cost: 1, duration: .85, minRange: 3.5, maxRange: 10, speed: 22 },
  throw: { cost: 2, duration: .33, hit: .10 },
  spin: { cost: 3, duration: 3.6, hit: .13, interval: .46 },
  dodge: { cost: 0, duration: .28 },
};
const actions = [...document.querySelectorAll('[data-action]')];
const maxHP = 320;
const gold = 0xffcc79;
const clamp = THREE.MathUtils.clamp;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const flatAngle = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const direction = (yaw) => v3(Math.sin(yaw), 0, Math.cos(yaw));
const effects = [];
const floaters = [];
const pressed = new Set();
const player = makeFighter('hero');
const thrownShield = makeShield(scene);
const floorMaterial = (color, opacity) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
const sparkGeometry = new THREE.TetrahedronGeometry(1);
const streakGeometry = new THREE.BoxGeometry(1, 1, 1);

function ring(inner, outer, color, opacity, height) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), floorMaterial(color, opacity));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = height;
  return mesh;
}
scene.add(ring(boundary - .06, boundary, 0xead09a, .12, .013));
player.root.add(ring(.64, .688, 0xf1e0ae, .69, .026));
const chargeMarker = ring(.98, 1.05, gold, .88, .038);
scene.add(chargeMarker);

let enemies = [];
let boss;
let hp, rage, points, elapsed, state, moveClock, hurt, noticeUntil;
let action, flight, combo, dodgeCooldown, cameraShake;
let lastFrame = 0;
let time = 0;
let previousUI = '';
let audio;
let muted = false;
let touchId = null;
const touch = new THREE.Vector2();
const stick = $('#touch-stick');
const mouse = new THREE.Vector2();
const pointer = v3(0, 0, 0);
const raycaster = new THREE.Raycaster();
const floor = new THREE.Plane(v3(0, 1, 0), 0);
const cameraFocus = v3(0, 0, 0);
const screenPoint = v3(0, 0, 0);

function makeEnemy(kind, x, z, phase) {
  const elite = kind === 'boss';
  const model = makeFighter(kind);
  const max = elite ? 720 : 152;
  model.root.position.set(x, 0, z);
  model.root.rotation.y = flatAngle(model.root.position, player.root.position);
  const radius = elite ? .77 : .51;
  const marker = ring(radius + .14, radius + .19, elite ? 0xe7a05d : 0xcba46c, .57, .03);
  model.root.add(marker);
  return {
    model, marker, pos: model.root.position, yaw: model.root.rotation.y, max, hp: max, elite, radius, phase,
    gait: phase, active: false, cooldown: .4 + phase * .1, stun: 0, flash: 0, down: 0, windup: null,
  };
}

function reset() {
  clearMovement();
  for (const effect of effects) disposeEffect(effect);
  effects.length = 0;
  for (const enemy of enemies) {
    clearWindup(enemy);
    disposeEffect({ mesh: enemy.marker, geometry: enemy.marker.geometry });
    removeModel(enemy.model);
  }
  for (const floater of floaters) floater.el.remove();
  floaters.length = 0;
  hp = maxHP;
  rage = points = elapsed = moveClock = hurt = noticeUntil = 0;
  dodgeCooldown = cameraShake = combo = 0;
  state = 'ready';
  action = flight = null;
  thrownShield.visible = false;
  player.shield.visible = true;
  player.root.position.set(0, 0, 5.6);
  player.root.rotation.y = Math.PI;
  player.figure.rotation.z = 0;
  applyFlash(player, 0);
  animateFighter(player, 0, 0, 'idle', 0);
  cameraFocus.copy(player.root.position);
  enemies = [
    makeEnemy('orc', -3.3, .2, 1),
    makeEnemy('orc', 3.7, -1.1, 2),
    makeEnemy('orc', -5.5, -5.5, 3),
    makeEnemy('orc', 5.4, -6.5, 4),
    makeEnemy('boss', .2, -7.4, 5),
  ];
  boss = enemies.at(-1);
  previousUI = '';
  ui.result.hidden = true;
  ui.notice.classList.remove('active');
  ui.hurt.style.opacity = 0;
  updateUI();
}

function startAudio() {
  if (muted) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  audio ??= new Audio();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}
function sound(from, to, duration, level, type = 'triangle') {
  if (!audio || audio.state !== 'running' || muted) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + duration);
  gain.gain.setValueAtTime(level, start);
  gain.gain.exponentialRampToValueAtTime(.001, start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration);
}
$('#sound').addEventListener('click', (event) => {
  muted = !muted;
  event.currentTarget.setAttribute('aria-pressed', muted);
  event.currentTarget.setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
  if (!muted) startAudio();
});
$('#restart').addEventListener('click', () => {
  reset();
  renderer.domElement.focus({ preventScroll: true });
});
$('#again').addEventListener('click', () => {
  reset();
  renderer.domElement.focus();
});
renderer.domElement.tabIndex = 0;

function activate() {
  if (state === 'ready') state = 'combat';
}
function notice(message, seconds = 1.1) {
  ui.notice.textContent = message;
  ui.notice.classList.add('active');
  noticeUntil = elapsed + seconds;
}
function movement() {
  const horizontal = Number(pressed.has('KeyD') || pressed.has('ArrowRight')) - Number(pressed.has('KeyA') || pressed.has('ArrowLeft'));
  const vertical = Number(pressed.has('KeyS') || pressed.has('ArrowDown')) - Number(pressed.has('KeyW') || pressed.has('ArrowUp'));
  return v3(horizontal + touch.x, 0, vertical + touch.y).clampLength(0, 1);
}

function nearest(from, maxDistance, exclude = null, minDistance = 0) {
  let best = null;
  let closest = maxDistance;
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || enemy === exclude) continue;
    const distance = from.distanceTo(enemy.pos);
    if (distance < minDistance || distance > closest) continue;
    best = enemy;
    closest = distance;
  }
  return best;
}
function begin(kind, aim = null) {
  if (state === 'won' || state === 'lost') return;
  startAudio();
  if (action) {
    const charging = action.kind === 'charge' && !action.impacted;
    if (kind === 'dodge' && dodgeCooldown <= 0 && !charging && action.kind !== 'spin' && action.kind !== 'dodge') {
      if (action.kind === 'throw' && action.tick === 0) points += action.cost;
      action = null;
    } else {
      if (action.kind === 'attack' && kind !== 'dodge') {
        if (kind !== 'attack' || (action.time >= .18 && !action.queued)) {
          action.queued = { kind, aim: aim?.clone() };
        }
      }
      return;
    }
  }

  const spec = settings[kind];
  if (kind === 'dodge' && dodgeCooldown > 0) return;
  if ((kind === 'throw' || kind === 'charge') && flight) {
    notice('盾牌正在返回');
    return;
  }
  if (points < spec.cost) {
    notice('需要 ' + spec.cost + ' 个怒气点');
    return;
  }

  let target = null;
  let yaw = player.root.rotation.y;
  const pos = player.root.position;
  if (kind === 'throw' || kind === 'charge') {
    const charging = kind === 'charge';
    target = charging ? nearest(pos, spec.maxRange, null, spec.minRange) : nearest(pos, 12);
    if (!target) {
      if (charging && nearest(pos, spec.minRange)) notice('太近了，拉开到 ' + spec.minRange + ' 米再冲锋');
      else if (charging) notice('冲锋需要 ' + spec.minRange + '–' + spec.maxRange + ' 米内的敌人');
      else notice('12 米内没有可投掷的目标');
      return;
    }
    yaw = flatAngle(pos, target.pos);
  } else if (kind === 'dodge') {
    const move = movement();
    if (move.lengthSq() > 0) yaw = Math.atan2(move.x, move.z);
    dodgeCooldown = .75;
  } else if (aim && aim.distanceTo(pos) > .2) {
    yaw = flatAngle(pos, aim);
  } else if (kind === 'attack') {
    target = nearest(pos, 3.0);
    if (target) yaw = flatAngle(pos, target.pos);
  }

  activate();
  points -= spec.cost;
  if (kind === 'attack') combo = 1 - combo;
  action = { kind, target, yaw, time: 0, tick: 0, queued: null, ...spec };
  player.root.rotation.y = yaw;
  const button = actions.find((item) => item.dataset.action === kind);
  button.classList.add('fired');
  clearTimeout(button.firedTimer);
  button.firedTimer = setTimeout(() => button.classList.remove('fired'), 150);
  if (kind === 'dodge') sound(190, 60, .16, .055, 'sine');
  if (kind === 'charge') {
    flashRing(pos, .82, gold, .25);
    sound(95, 410, .23, .095);
  }
}

const keyActions = {
  Space: 'dodge', KeyQ: 'charge', KeyE: 'throw', KeyR: 'spin',
};
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (movementKeys.has(event.code)) {
    event.preventDefault();
    if (state === 'ready' || state === 'combat') {
      activate();
      startAudio();
      pressed.add(event.code);
    }
  }
  if (keyActions[event.code] && state !== 'won' && state !== 'lost') {
    event.preventDefault();
    if (!event.repeat) begin(keyActions[event.code]);
  }
});
function clearMovement() {
  pressed.clear();
  touchId = null;
  touch.set(0, 0);
  stick.firstElementChild.style.transform = '';
}
addEventListener('keyup', (event) => pressed.delete(event.code));
addEventListener('blur', clearMovement);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearMovement();
});
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  raycaster.setFromCamera(mouse, camera);
  let aim = null;
  if (event.pointerType === 'mouse') {
    const target = enemies.find((enemy) => enemy.hp > 0 &&
      enemy.pos.distanceTo(player.root.position) < 3.4 &&
      raycaster.ray.distanceToPoint(enemy.pos.clone().add(v3(0, 1.2 * enemy.model.scale, 0))) < .64 * enemy.model.scale);
    aim = target?.pos ?? raycaster.ray.intersectPlane(floor, pointer);
  }
  begin('attack', aim);
});
for (const button of actions) button.addEventListener('click', (event) => {
  begin(button.dataset.action);
  if (event.detail) renderer.domElement.focus({ preventScroll: true });
});

function moveTouch(event) {
  if (event.pointerId !== touchId) return;
  const rect = stick.getBoundingClientRect();
  touch.set((event.clientX - rect.left - rect.width / 2) / 33, (event.clientY - rect.top - rect.height / 2) / 33).clampLength(0, 1);
  stick.firstElementChild.style.transform = 'translate(' + touch.x * 23 + 'px,' + touch.y * 23 + 'px)';
}
stick.addEventListener('pointerdown', (event) => {
  if (touchId !== null || (state !== 'ready' && state !== 'combat')) return;
  touchId = event.pointerId;
  stick.setPointerCapture(touchId);
  startAudio();
  activate();
  moveTouch(event);
});
stick.addEventListener('pointermove', moveTouch);
stick.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId !== touchId) return;
  touchId = null;
  touch.set(0, 0);
  stick.firstElementChild.style.transform = '';
});

function moveBody(pos, x, z, radius) {
  pos.x += x;
  pos.z += z;
  for (const obstacle of obstacles) {
    const dx = pos.x - obstacle.x;
    const dz = pos.z - obstacle.z;
    const limit = radius + obstacle.radius;
    const distance = Math.hypot(dx, dz);
    if (distance < limit && distance > .001) {
      const overlap = (limit - distance) / distance;
      pos.x += dx * overlap;
      pos.z += dz * overlap;
    }
  }
  const distance = Math.hypot(pos.x, pos.z);
  if (distance > boundary - radius) {
    const scale = (boundary - radius) / distance;
    pos.x *= scale;
    pos.z *= scale;
  }
}
function separatePlayer(pos) {
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const dx = pos.x - enemy.pos.x;
    const dz = pos.z - enemy.pos.z;
    const distance = Math.hypot(dx, dz);
    const limit = enemy.radius + .47;
    if (distance < limit && distance > .001) {
      moveBody(pos, dx * (limit - distance) / distance, dz * (limit - distance) / distance, .47);
    }
  }
}

function slash(pos, yaw, reach, width, color, life = .25, height = 1.1) {
  const geometry = new THREE.RingGeometry(reach - .28, reach, 36, 1, Math.PI / 2 - width / 2, width);
  const mesh = new THREE.Mesh(geometry, floorMaterial(color, .75));
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.z = -yaw;
  mesh.position.set(pos.x, height, pos.z);
  scene.add(mesh);
  effects.push({ mesh, geometry, life, total: life, grow: .19, opacity: .75 });
}
function flashRing(pos, radius, color, life = .32) {
  const mesh = ring(radius - .065, radius, color, .84, .042);
  mesh.position.x = pos.x;
  mesh.position.z = pos.z;
  scene.add(mesh);
  effects.push({ mesh, geometry: mesh.geometry, life, total: life, grow: .35, opacity: .84 });
}
function sparks(pos, y, color, count = 9) {
  const mat = floorMaterial(color, 1);
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(sparkGeometry, i ? mat.clone() : mat);
    mesh.position.set(pos.x, y, pos.z);
    mesh.scale.setScalar(.045 + Math.random() * .073);
    scene.add(mesh);
    const life = .23 + Math.random() * .26;
    effects.push({ mesh, life, total: life, opacity: 1, velocity: v3((Math.random() - .5) * 5, .5 + Math.random() * 3, (Math.random() - .5) * 5) });
  }
}
function shieldTrail(pos) {
  const mesh = new THREE.Mesh(sparkGeometry, floorMaterial(0xffd28a, .65));
  mesh.position.copy(pos);
  mesh.scale.setScalar(.12);
  scene.add(mesh);
  effects.push({ mesh, life: .24, total: .24, opacity: .65 });
}
function disposeEffect(effect) {
  effect.mesh.removeFromParent();
  effect.mesh.material.dispose();
  effect.geometry?.dispose();
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.life -= dt;
    if (effect.life <= 0) {
      disposeEffect(effect);
      effects.splice(i, 1);
      continue;
    }
    const progress = 1 - effect.life / effect.total;
    effect.mesh.material.opacity = effect.opacity * (1 - progress);
    if (effect.grow) effect.mesh.scale.setScalar(1 + progress * effect.grow);
    if (effect.velocity) {
      effect.mesh.position.addScaledVector(effect.velocity, dt);
      effect.velocity.y -= dt * 6.5;
      effect.mesh.rotation.x += dt * 9;
    }
  }
}
function numberAt(pos, y, value, color) {
  const el = document.createElement('span');
  el.className = 'floater';
  el.textContent = value;
  el.style.color = color;
  ui.floaters.append(el);
  floaters.push({ el, pos: v3(pos.x + (Math.random() - .5) * .65, y, pos.z), life: .86 });
}
function updateFloaters(dt) {
  const canvas = renderer.domElement;
  for (let i = floaters.length - 1; i >= 0; i--) {
    const entry = floaters[i];
    entry.life -= dt;
    if (entry.life <= 0) {
      entry.el.remove();
      floaters.splice(i, 1);
      continue;
    }
    screenPoint.copy(entry.pos);
    screenPoint.y += (1 - entry.life / .86) * 1.15;
    screenPoint.project(camera);
    entry.el.hidden = screenPoint.z >= 1 || Math.abs(screenPoint.x) >= 1 || Math.abs(screenPoint.y) >= 1;
    entry.el.style.left = (screenPoint.x * .5 + .5) * canvas.clientWidth + 'px';
    entry.el.style.top = (.5 - screenPoint.y * .5) * canvas.clientHeight + 'px';
    entry.el.style.transform = 'translate(-50%, -50%)';
    entry.el.style.opacity = Math.min(1, entry.life * 3.5);
  }
}

function gainRage(amount) {
  if (points === 3) return;
  rage += amount;
  if (rage >= 100) {
    points++;
    rage = points === 3 ? 0 : rage - 100;
    numberAt(player.root.position, 2.9, '+1 怒气点', '#ffcc71');
    flashRing(player.root.position, .95, gold, .4);
    sound(430, 820, .21, .065, 'sine');
  }
}
function damage(enemy, amount, color, stun = 0) {
  if (enemy.hp <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.flash = .16;
  enemy.active = true;
  sparks(enemy.pos, 1.08 * enemy.model.scale, color);
  numberAt(enemy.pos, 2.45 * enemy.model.scale, amount, color === gold ? '#ffcb79' : '#fff0da');
  if (stun) {
    enemy.stun = stun;
    clearWindup(enemy);
    enemy.cooldown = Math.max(enemy.cooldown, .45);
  }
  if (enemy.hp <= 0) {
    clearWindup(enemy);
    enemy.marker.visible = false;
    flashRing(enemy.pos, enemy.radius + .65, color);
    if (enemy.elite) sound(126, 36, .4, .12);
  }
}

function melee(kind, yaw, tick) {
  const pos = player.root.position;
  const spin = kind === 'spin';
  const reach = spin ? 3.05 : 2.25;
  const arc = spin ? Math.PI : 1.05;
  const color = kind === 'attack' ? 0xffead1 : gold;
  slash(pos, yaw, reach, spin ? Math.PI * 2 : arc * 2, color, spin ? .46 : .23, spin ? .92 + tick % 3 * .15 : 1.04);
  sound(spin ? 280 + tick * 65 : 370, 115, .18, .075);
  let hits = 0;
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || pos.distanceTo(enemy.pos) > reach + enemy.radius || Math.abs(angleDifference(flatAngle(pos, enemy.pos), yaw)) > arc) continue;
    const amount = spin ? 25 : combo ? 22 : 19;
    damage(enemy, amount, color);
    hits++;
  }
  if (!hits) return;
  if (kind === 'attack') gainRage(34 + Math.min(2, hits - 1) * 10);
  sound(253, 58, .17, .10);
  cameraShake = Math.max(cameraShake, .105);
}

function chargeImpact(current) {
  const enemy = current.target;
  const stun = enemy.elite ? 1.1 : 1.8;
  damage(enemy, 34, gold, stun);
  const contact = player.root.position.clone().lerp(enemy.pos, .64);
  flashRing(contact, 1.2, 0xffe5ae, .4);
  flashRing(contact, 2.05, gold, .28);
  sparks(contact, 1.02, 0xffe2a2, 18);
  if (enemy.hp > 0) {
    const scale = enemy.model.scale;
    const halo = ring(.36 * scale, .43 * scale, gold, .9, 2.53 * scale);
    enemy.model.root.add(halo);
    effects.push({ mesh: halo, geometry: halo.geometry, life: stun, total: stun, opacity: .9, grow: .2 });
    numberAt(enemy.pos, 3.03 * scale, '眩晕', '#ffe3a4');
  }
  cameraShake = Math.max(cameraShake, .39);
  sound(175, 36, .3, .15);
  sound(550, 120, .13, .06);
  current.impacted = true;
  current.time = 0;
  current.duration = .23;
}

function cancelCharge(message) {
  points = Math.min(3, points + action.cost);
  action = null;
  notice(message);
}

function updateCharge(current, dt) {
  const pos = player.root.position;
  const enemy = current.target;
  if (enemy.hp <= 0) {
    cancelCharge('冲锋目标已倒下，返还怒气点');
    return;
  }
  const reach = enemy.radius + .61;
  const distance = pos.distanceTo(enemy.pos);
  const yaw = flatAngle(pos, enemy.pos);
  player.root.rotation.y = yaw;
  if (distance > reach && dt > 0) {
    const origin = pos.clone();
    const step = Math.min(current.speed * dt, distance - reach);
    const move = direction(yaw).multiplyScalar(step);
    moveBody(pos, move.x, move.z, .47);
    const travel = origin.distanceTo(pos);
    if (travel > .035) {
      const streak = new THREE.Mesh(streakGeometry, floorMaterial(0xf6c67b, .52));
      streak.position.copy(origin).lerp(pos, .5);
      streak.position.y = .07;
      streak.rotation.y = flatAngle(origin, pos);
      streak.scale.set(.48, .028, travel + .12);
      scene.add(streak);
      effects.push({ mesh: streak, life: .34, total: .34, opacity: .52 });
    }
    if (pos.distanceTo(enemy.pos) > Math.max(reach + .025, distance - step * .2)) {
      cancelCharge('冲锋路线受阻，返还怒气点');
      return;
    }
  }
  if (pos.distanceTo(enemy.pos) <= reach + .025) {
    chargeImpact(current);
  } else if ((current.time += dt) >= current.duration) {
    cancelCharge('冲锋未命中，返还怒气点');
  }
}

function throwShield(target) {
  const next = nearest(target.pos, 8, target);
  thrownShield.position.copy(player.root.position).add(v3(0, 1.2, 0));
  thrownShield.visible = true;
  player.shield.visible = false;
  flight = { targets: next ? [target, next] : [target], hitIndex: 0, trail: 0 };
  sound(410, 145, .24, .086);
}
function updateFlight(dt) {
  if (!flight) return;
  let target = flight.targets[flight.hitIndex];
  while (target && target.hp <= 0) {
    flight.hitIndex++;
    target = flight.targets[flight.hitIndex];
  }
  const destination = target
    ? target.pos.clone().add(v3(0, target.model.scale * 1.20, 0))
    : player.root.position.clone().add(v3(-.2, 1.2, 0));
  const delta = destination.sub(thrownShield.position);
  const step = (target ? 21 : 24) * dt;
  if (delta.length() <= step) {
    thrownShield.position.add(delta);
    if (target) {
      damage(target, flight.hitIndex === 0 ? 58 : 46, gold);
      flashRing(target.pos, target.radius + .51, gold, .29);
      sound(620, 153, .20, .105);
      cameraShake = Math.max(cameraShake, .12);
      flight.hitIndex++;
    } else {
      thrownShield.visible = false;
      player.shield.visible = true;
      sound(260, 320, .105, .055);
      flight = null;
      return;
    }
  } else {
    thrownShield.position.add(delta.setLength(step));
  }
  thrownShield.rotation.set(1.08 + Math.sin(time * 19) * .18, time * 19, time * 17);
  flight.trail += dt;
  if (flight.trail > .023) {
    flight.trail = 0;
    shieldTrail(thrownShield.position);
  }
}

function clearWindup(enemy) {
  if (!enemy.windup) return;
  for (const mesh of enemy.windup.meshes) disposeEffect({ mesh, geometry: mesh.geometry });
  enemy.windup = null;
}
function startWindup(enemy) {
  const radial = enemy.elite && enemy.phase % 3 === 0;
  const radius = radial ? 4.5 : enemy.elite ? 3.55 : 2.42;
  const width = radial ? Math.PI * 2 : enemy.elite ? 2.42 : 1.58;
  const yaw = enemy.yaw;
  const color = radial ? 0xf49843 : 0xff5a43;
  const start = Math.PI / 2 - width / 2;
  const outline = new THREE.Mesh(new THREE.RingGeometry(radius - .073, radius, 42, 1, start, width), floorMaterial(color, .87));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 42, start, width), floorMaterial(color, .15));
  const progress = new THREE.Mesh(new THREE.CircleGeometry(radius, 42, start, width), floorMaterial(color, .32));
  const meshes = [outline, fill, progress];
  meshes.forEach((mesh, index) => {
    mesh.rotation.set(Math.PI / 2, 0, -yaw);
    mesh.position.set(enemy.pos.x, .045 + index * .003, enemy.pos.z);
    scene.add(mesh);
  });
  progress.scale.setScalar(.01);
  enemy.windup = { time: 0, duration: radial ? 1.13 : enemy.elite ? .91 : .67, radius, width, yaw, radial, meshes, progress };
  enemy.phase++;
  if (enemy.elite) sound(radial ? 105 : 142, 58, .36, .066, 'sine');
}

function strike(enemy) {
  const { radial, radius, yaw, width } = enemy.windup;
  const pos = player.root.position;
  const color = enemy.elite ? 0xffa257 : 0xe16e49;
  if (radial) {
    flashRing(enemy.pos, radius, color, .39);
    flashRing(enemy.pos, radius * .68, color, .29);
    sparks(enemy.pos, .16, color, 16);
    cameraShake = Math.max(cameraShake, .2);
    sound(140, 28, .37, .11);
  } else {
    slash(enemy.pos, yaw, radius, width, color, .28, 1.12 * enemy.model.scale);
    sound(174, 60, .19, .04);
  }
  if (action?.kind === 'dodge') return;
  if (pos.distanceTo(enemy.pos) > radius + .24) return;
  if (!radial && Math.abs(angleDifference(flatAngle(enemy.pos, pos), yaw)) > width / 2) return;
  const amount = radial ? 30 : enemy.elite ? 24 : 13;
  hp = Math.max(0, hp - amount);
  numberAt(pos, 2.26, '-' + amount, '#ff967f');
  sparks(pos, 1, 0xff6550, 7);
  hurt = .31;
  cameraShake = Math.max(cameraShake, .27);
  const away = direction(flatAngle(enemy.pos, pos));
  moveBody(pos, away.x * .53, away.z * .53, .47);
  sound(103, 39, .21, .10);
}

function updateEnemy(enemy, dt, allowCombat) {
  const model = enemy.model;
  enemy.flash = Math.max(0, enemy.flash - dt);
  applyFlash(model, enemy.flash / .16);
  if (enemy.hp <= 0) {
    enemy.down += dt;
    model.figure.rotation.z = Math.min(1, enemy.down * 2.6) * 1.52;
    model.figure.position.y = .07 * Math.sin(Math.min(1, enemy.down * 2.6) * Math.PI);
    if (enemy.down > 2.7) {
      model.figure.scale.setScalar(model.scale * Math.max(0, 1 - (enemy.down - 2.7) * 2));
      model.root.visible = enemy.down < 3.2;
    }
    return;
  }

  let pose = 'idle';
  let progress = 0;
  let stride = 0;
  if (allowCombat && hp > 0) {
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    enemy.stun = Math.max(0, enemy.stun - dt);
    const distance = enemy.pos.distanceTo(player.root.position);
    if (!enemy.active && distance < (enemy.elite ? 9 : 8.8)) enemy.active = true;
    if (enemy.stun > 0) {
      pose = 'stun';
      progress = enemy.stun;
    } else if (enemy.windup) {
      const cast = enemy.windup;
      cast.time += dt;
      progress = Math.min(1, cast.time / cast.duration);
      pose = cast.radial ? 'slam' : 'windup';
      cast.progress.scale.setScalar(Math.max(.01, progress));
      if (progress >= 1) {
        strike(enemy);
        clearWindup(enemy);
        enemy.cooldown = enemy.elite ? 1.38 : 1.25 + enemy.phase % 4 * .13;
      }
    } else if (enemy.active) {
      const desired = flatAngle(enemy.pos, player.root.position);
      enemy.yaw += angleDifference(desired, enemy.yaw) * Math.min(1, dt * 12);
      const attackRange = enemy.elite ? 2.8 : 1.95;
      if (distance <= attackRange && enemy.cooldown <= 0) {
        startWindup(enemy);
      } else if (distance > attackRange * .86 && enemy.cooldown < 1.03) {
        const move = direction(desired);
        const speed = enemy.elite ? enemy.hp < enemy.max / 2 ? 3.06 : 2.52 : 3.37;
        for (const other of enemies) {
          if (other === enemy || other.hp <= 0) continue;
          const offset = enemy.pos.clone().sub(other.pos);
          const gap = offset.length();
          const spacing = enemy.radius + other.radius + .34;
          if (gap > .001 && gap < spacing) move.addScaledVector(offset, (spacing - gap) * 1.8 / gap);
        }
        move.normalize().multiplyScalar(speed * dt);
        moveBody(enemy.pos, move.x, move.z, enemy.radius);
        enemy.gait += dt * 11;
        stride = .85;
      }
    }
  }
  model.root.rotation.y = enemy.yaw;
  animateFighter(model, enemy.gait + time * .25, stride, pose, progress);
}

function applyFlash(model, strength) {
  for (const entry of model.flashes) {
    entry.mat.emissive.copy(entry.emissive);
    entry.mat.emissiveIntensity = entry.intensity;
    if (strength > 0) {
      entry.mat.emissive.setHex(0xff9b53);
      entry.mat.emissiveIntensity = strength * .66;
    }
  }
}
function animateFighter(model, gait, stride, pose, progress) {
  const [leftArm, rightArm] = model.arms;
  const [leftLeg, rightLeg] = model.legs;
  const pulse = Math.sin(gait);
  model.figure.position.y = .026 * Math.sin(time * 3.4 + model.root.position.x) + Math.abs(pulse) * .058 * stride;
  model.torso.rotation.set(.035 * stride, 0, 0);
  leftLeg.rotation.x = pulse * .64 * stride;
  rightLeg.rotation.x = -pulse * .64 * stride;
  leftArm.rotation.set(-.30 - pulse * .25 * stride, .10, -.19);
  rightArm.rotation.set(-.23 + pulse * .35 * stride, -.07, .20);
  if (pose === 'attack') {
    const swing = Math.sin(clamp(progress * 1.3, 0, 1) * Math.PI);
    const sign = combo ? 1 : -1;
    rightArm.rotation.set(-.53 - swing * 1.4, sign * .32, .25 + swing * 1.05);
    model.torso.rotation.y = sign * (.68 - progress * 1.48);
    model.torso.rotation.x = swing * .19;
  } else if (pose === 'charge' || pose === 'chargeImpact') {
    const push = pose === 'charge' ? .78 : 1 - progress;
    leftArm.rotation.set(-1.4 - push * .5, -.49, -.14);
    rightArm.rotation.x = .49;
    model.torso.rotation.set(.35 * push, -.22, 0);
  } else if (pose === 'throw') {
    leftArm.rotation.set(-.45 - 1.6 * Math.sin(progress * Math.PI), -.7 + progress * 1.4, -.3);
  } else if (pose === 'spin') {
    model.torso.rotation.y = progress * Math.PI * 14;
    rightArm.rotation.set(-.58, -.28, 1.48);
    leftArm.rotation.set(-.48, .40, -1.06);
  } else if (pose === 'dodge') {
    model.torso.rotation.x = .72 * Math.sin(progress * Math.PI);
    leftLeg.rotation.x = -.75 * Math.sin(progress * Math.PI);
    rightLeg.rotation.x = .75 * Math.sin(progress * Math.PI);
  } else if (pose === 'windup' || pose === 'slam') {
    const lift = progress < .81 ? progress / .81 : 1 - (progress - .81) / .19;
    rightArm.rotation.set(-.5 - Math.max(0, lift) * 2.24, -.19, .32);
    model.torso.rotation.x = -.32 * lift;
    if (pose === 'slam') leftArm.rotation.x = rightArm.rotation.x;
  } else if (pose === 'stun') {
    model.torso.rotation.z = Math.sin(time * 19) * progress * .23;
    model.torso.rotation.x = -.28 * progress;
  }
}

function updatePlayer(dt) {
  applyFlash(player, hurt / .31);
  if (action?.kind === 'charge' && !action.impacted) {
    updateCharge(action, dt);
    moveClock += dt * 32;
    const pose = action?.impacted ? 'chargeImpact' : action ? 'charge' : 'idle';
    animateFighter(player, moveClock, pose === 'charge' ? 1.2 : 0, pose, 0);
    return;
  }
  const pos = player.root.position;
  const move = movement();
  let speed = 6.05;
  let stride = move.length();
  dodgeCooldown = Math.max(0, dodgeCooldown - dt);
  if (action) {
    if (action.kind === 'dodge') {
      move.copy(direction(action.yaw));
      stride = 1;
      speed = 12.1;
    } else if (action.kind === 'charge' && action.time < .09) {
      stride = 0;
    } else {
      speed *= action.kind === 'spin' ? .82 : .38;
    }
  } else if (stride > .01) {
    const desired = Math.atan2(move.x, move.z);
    player.root.rotation.y += angleDifference(desired, player.root.rotation.y) * Math.min(1, dt * 18);
  }
  if (stride > .01) moveBody(pos, move.x * speed * dt, move.z * speed * dt, .47);
  if (action?.kind !== 'dodge') separatePlayer(pos);
  moveClock += dt * (stride > .01 ? speed * 2.2 : 2);

  if (action) {
    const current = action;
    current.time += dt;
    if (current.kind === 'spin') {
      const nextHit = current.hit + current.tick * current.interval;
      if (nextHit < current.duration && current.time >= nextHit) {
        melee('spin', current.yaw, current.tick++);
      }
    } else if ((current.kind === 'attack' || current.kind === 'throw') && current.tick === 0 && current.time >= current.hit) {
      current.tick++;
      if (current.kind === 'throw') throwShield(current.target);
      else melee(current.kind, current.yaw, 0);
    }
    if (current.time >= current.duration) {
      action = null;
      if (current.queued) begin(current.queued.kind, current.queued.aim);
    }
  }
  const pose = action?.kind === 'charge' ? 'chargeImpact' : action?.kind ?? 'idle';
  animateFighter(player, moveClock, stride, pose, action ? action.time / action.duration : 0);
}

function updateCamera(dt) {
  cameraFocus.lerp(player.root.position, 1 - Math.exp(-dt * 5.8));
  const portrait = camera.aspect < 1;
  const shake = cameraShake * cameraShake * 2.3;
  camera.position.set(
    cameraFocus.x * .72 + Math.sin(time * 100) * shake,
    portrait ? 13.0 : 11.5,
    cameraFocus.z + (portrait ? 13.6 : 12.8),
  );
  camera.lookAt(cameraFocus.x * .86, 1.15 + Math.sin(time * 83) * shake, cameraFocus.z - (portrait ? 4.1 : 4.8));
  camera.updateMatrixWorld();
}
function updateUI() {
  const charge = settings.charge;
  const charging = action?.kind === 'charge' && !action.impacted && state === 'combat';
  const canAimCharge = points >= charge.cost && !flight && (state === 'combat' || state === 'ready');
  const chargeTarget = canAimCharge && nearest(player.root.position, charge.maxRange, null, charge.minRange);
  const markedEnemy = charging ? action.target : chargeTarget;
  chargeMarker.visible = Boolean(markedEnemy);
  if (markedEnemy) {
    chargeMarker.position.x = markedEnemy.pos.x;
    chargeMarker.position.z = markedEnemy.pos.z;
    chargeMarker.scale.setScalar(1 + Math.sin(time * 9) * .065);
  }
  const remaining = enemies.filter((enemy) => enemy.hp > 0).length;
  const signature = [hp, rage, points, remaining, boss.hp, flight !== null, dodgeCooldown > 0, !!chargeTarget, charging].join('/');
  if (previousUI === signature) return;
  previousUI = signature;
  ui.health.style.transform = 'scaleX(' + hp / maxHP + ')';
  ui.hp.textContent = hp + ' / ' + maxHP;
  ui.rage.style.transform = 'scaleX(' + rage / 100 + ')';
  ui.rageValue.textContent = points === 3 ? '已满' : rage + ' / 100';
  ui.points.setAttribute('aria-label', points + ' / 3 怒气点');
  [...ui.points.children].forEach((pip, index) => pip.classList.toggle('on', index < points));
  ui.remaining.lastElementChild.textContent = remaining;
  ui.boss.hidden = boss.hp <= 0;
  ui.bossBar.style.transform = 'scaleX(' + boss.hp / boss.max + ')';
  ui.bossValue.textContent = Math.ceil(boss.hp / boss.max * 100) + '%';
  for (const button of actions) {
    const kind = button.dataset.action;
    const shieldAway = (kind === 'throw' || kind === 'charge') && flight !== null;
    const waitingForRange = kind === 'charge' && (!chargeTarget || charging);
    if (settings[kind].cost > 0) button.classList.toggle('ready', points >= settings[kind].cost && !shieldAway && !waitingForRange);
    button.classList.toggle('cooling', shieldAway || (kind === 'dodge' && dodgeCooldown > 0));
  }
}
function finish(won) {
  state = won ? 'won' : 'lost';
  clearMovement();
  for (const enemy of enemies) clearWindup(enemy);
  $('#result-tag').textContent = won ? 'TRIAL COMPLETE' : 'TRIAL FAILED';
  $('#result-title').textContent = won ? '试炼完成' : '战士倒下了';
  const defeated = enemies.filter((enemy) => enemy.hp <= 0).length;
  $('#result-detail').textContent = won ? '已击败半兽人统领和四名守卫。' : '已击败 ' + defeated + ' / ' + enemies.length + ' 名敌人。';
  ui.result.hidden = false;
  $('#again').focus({ preventScroll: true });
  sound(won ? 450 : 175, won ? 740 : 54, .42, .09, 'sine');
}

function frame(timestamp) {
  requestAnimationFrame(frame);
  const dt = Math.min(.034, (timestamp - (lastFrame || timestamp)) / 1000);
  lastFrame = timestamp;
  elapsed += dt;
  time += dt;
  cameraShake = Math.max(0, cameraShake - dt * 1.34);
  hurt = Math.max(0, hurt - dt);
  const inCombat = state === 'combat';
  if (inCombat) {
    updatePlayer(dt);
    updateFlight(dt);
  } else if (state === 'ready') {
    animateFighter(player, 0, 0, 'idle', 0);
  }
  for (const enemy of enemies) updateEnemy(enemy, dt, inCombat);
  if (inCombat && hp <= 0) {
    player.figure.rotation.z = 1.27;
    finish(false);
  } else if (inCombat && !flight && enemies.every((enemy) => enemy.hp <= 0)) {
    finish(true);
  }
  if (elapsed >= noticeUntil) ui.notice.classList.remove('active');
  ui.hurt.style.opacity = hurt * 1.57;
  updateEffects(dt);
  updateForest(time);
  updateCamera(dt);
  updateFloaters(dt);
  updateUI();
  renderer.render(scene, camera);
}

reset();
requestAnimationFrame(frame);
$('#loading').hidden = true;
