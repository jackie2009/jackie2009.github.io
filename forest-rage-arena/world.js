import * as THREE from 'three';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x98a98c);
scene.fog = new THREE.FogExp2(0xa5b29a, 0.028);

const world = document.querySelector('#world');
export const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 105);
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.17;
renderer.domElement.setAttribute('aria-label', '铁橡林 3D 战斗');
world.append(renderer.domElement);

function resize() {
  camera.aspect = world.clientWidth / world.clientHeight;
  camera.fov = camera.aspect < 1 ? 52 : 42;
  camera.updateProjectionMatrix();
  renderer.setSize(world.clientWidth, world.clientHeight);
}
addEventListener('resize', resize);
resize();

const hemi = new THREE.HemisphereLight(0xe9edd2, 0x435742, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffdca1, 2.8);
sun.position.set(-14, 22, -10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -23, right: 23, bottom: -23, top: 23, near: .5, far: 64 });
sun.shadow.bias = -.0005;
sun.shadow.normalBias = .035;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xc3e3d8, .55);
fill.position.set(4, 8, 10);
scene.add(fill);

const material = (color, roughness = .85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
const box = new THREE.BoxGeometry();
const sphere = new THREE.IcosahedronGeometry(1, 1);
const coarse = new THREE.IcosahedronGeometry(1, 0);
const cylinder = new THREE.CylinderGeometry(.5, .57, 1, 8);
const cone = new THREE.ConeGeometry(1, 1, 7);
const leaf = new THREE.PlaneGeometry(1, 1);
leaf.translate(0, .5, 0);

let seed = 37;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const range = (low, high) => low + random() * (high - low);
const pick = (values) => values[Math.floor(random() * values.length)];

function part(parent, geometry, mat, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function group(parent, x, y, z) {
  const node = new THREE.Group();
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

const batch = new Map();
const template = new THREE.Object3D();
function scatter(name, geometry, opts, position, scale, rotation, color) {
  if (!batch.has(name)) batch.set(name, { geometry, opts, matrices: [], colors: [] });
  const entry = batch.get(name);
  template.position.set(...position);
  template.scale.set(...scale);
  template.rotation.set(...rotation);
  template.updateMatrix();
  entry.matrices.push(template.matrix.clone());
  entry.colors.push(new THREE.Color(color));
}
function flushScenery() {
  for (const { geometry, opts, matrices, colors } of batch.values()) {
    const mat = material(0xffffff);
    if (opts.double) mat.side = THREE.DoubleSide;
    const objects = new THREE.InstancedMesh(geometry, mat, matrices.length);
    matrices.forEach((matrix, index) => {
      objects.setMatrixAt(index, matrix);
      objects.setColorAt(index, colors[index]);
    });
    objects.castShadow = opts.shadow ?? false;
    objects.receiveShadow = true;
    scene.add(objects);
  }
  batch.clear();
}
const shadowed = { shadow: true };
const plain = {};
const double = { double: true };

export const boundary = 16;
export const obstacles = [];
const groundSize = 118;
const groundTexture = document.createElement('canvas');
groundTexture.width = groundTexture.height = 768;
const ctx = groundTexture.getContext('2d');
const pixels = ctx.createImageData(768, 768);
for (let y = 0; y < 768; y++) {
  for (let x = 0; x < 768; x++) {
    const wx = (x / 768 - .5) * groundSize;
    const wz = (y / 768 - .5) * groundSize;
    const blend = Math.sin(wx * .55 + Math.sin(wz * .27)) * Math.cos(wz * .48) * .17;
    const clearing = THREE.MathUtils.clamp((1.16 - Math.hypot(wx / 14, wz / 17) + blend) * 3, 0, 1);
    const noise = range(-13, 13) + Math.sin(wx * 7 + Math.cos(wz * 4)) * 4;
    const offset = (y * 768 + x) * 4;
    pixels.data[offset] = 65 + clearing * 39 + noise;
    pixels.data[offset + 1] = 78 + clearing * 13 + noise;
    pixels.data[offset + 2] = 48 + clearing * 13 + noise * .7;
    pixels.data[offset + 3] = 255;
  }
}
ctx.putImageData(pixels, 0, 0);
const texture = new THREE.CanvasTexture(groundTexture);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function tree(x, z, height, width, pine) {
  const turn = range(0, Math.PI * 2);
  const bark = pick([0x514535, 0x63503c, 0x403c2d, 0x746148]);
  const trunkHeight = height * (pine ? .95 : .78);
  scatter('trunks', cylinder, shadowed, [x, trunkHeight / 2, z], [width, trunkHeight, width], [0, turn, 0], bark);
  if (Math.hypot(x, z) < 22) {
    for (let j = 0; j < 5; j++) {
      const a = turn + j * 1.28;
      scatter('roots', coarse, shadowed, [x + Math.sin(a) * width * .58, .10, z + Math.cos(a) * width * .58], [width * .26, width * .23, width * .89], [0, a, 0], bark);
    }
  }
  if (pine) {
    for (let j = 0; j < 3; j++) {
      const radius = height * (.29 - j * .059);
      scatter('pines', cone, shadowed, [x, height * (.57 + j * .18), z], [radius, height * .63, radius], [0, turn + j * .43, 0], pick([0x314f36, 0x486641, 0x4a6540, 0x335a43, 0x566e43]));
    }
    return;
  }
  const crown = pick([0x526b39, 0x667b40, 0x425f3e, 0x76874c, 0x5b7541]);
  for (let j = 0; j < 5; j++) {
    const a = turn + j * 2.4;
    const r = j ? height * range(.15, .23) : 0;
    const dx = Math.sin(a) * r;
    const dz = Math.cos(a) * r;
    const y = height * (j ? range(.76, .98) : 1.04);
    if (j) {
      const start = new THREE.Vector3(x, height * range(.45, .62), z);
      const end = new THREE.Vector3(x + dx, y, z + dz);
      const direction = end.clone().sub(start);
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
      scatter('trunks', cylinder, shadowed, start.lerp(end, .5).toArray(), [width * .37, direction.length(), width * .37], [rotation.x, rotation.y, rotation.z], bark);
    }
    scatter('crowns', sphere, shadowed, [x + dx, y, z + dz], [height * .24, height * .16, height * .24], [0, a, range(-.3, .3)], crown);
  }
}

for (let i = 0; i < 168; i++) {
  const a = (i / 168) * Math.PI * 2 + range(-.08, .08);
  const r = i < 58 ? range(15.5, 24) : range(24, 53);
  const x = Math.cos(a * (i < 58 ? 3 : 2)) * r;
  const z = Math.sin(a * (i < 58 ? 3 : 2)) * r;
  if (z > 5 && Math.abs(x) < 17) continue;
  const width = range(.47, 1.28);
  if (r < 19 && obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < 2)) continue;
  tree(x, z, range(6.5, 14), width, random() < .64);
  if (r < 19) obstacles.push({ x, z, radius: width * .65 });
}
for (const [x, z, h, w, pine] of [[-12, 4, 9, 1.9, false], [13, 3, 11, 1.4, false], [-9, -10, 10, 1.4, false], [10, -10, 9, 1.1, true], [-15, 13, 13, 1.5, true], [16, 11, 12, 1.5, false]]) {
  tree(x, z, h, w, pine);
  obstacles.push({ x, z, radius: w * .7 });
}
for (let i = 0; i < 210; i++) {
  const a = range(0, Math.PI * 2);
  const r = range(9, 31);
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const size = range(.18, 1.09) * (r < 13 ? .63 : 1);
  scatter('stones', coarse, shadowed, [x, size * .27, z], [size, size * .64, size * .73], [range(-.5, .5), a, .23], pick([0x646a58, 0x77796e, 0x526550, 0x77715d]));
  if (i % 3 === 0) scatter('moss', coarse, plain, [x - .05, size * .66, z - .05], [size * .77, size * .18, size * .53], [0, a, 0], 0x6b7f43);
}
for (let i = 0; i < 2550; i++) {
  const x = range(-29, 29);
  const z = range(-32, 20);
  const clear = Math.hypot(x / 12, z / 13) < range(.65, 1.15);
  if (clear && random() < .96) continue;
  const height = range(.15, .60);
  const color = pick([0x698752, 0x4d6b40, 0x617648, 0x7e8e4d, 0x456b46]);
  for (let j = 0; j < 4; j++) {
    scatter('grass', leaf, double, [x + range(-.14, .14), .01, z + range(-.14, .14)], [range(.03, .095), height * range(.4, 1.3), 1], [range(-.42, .42), range(0, 6.28), range(-.44, .44)], color);
  }
}
for (let i = 0; i < 100; i++) {
  const a = range(0, 6.28);
  const r = range(10, 24);
  const x = Math.sin(a) * r;
  const z = Math.cos(a) * r;
  const height = range(.17, .47);
  for (let j = 0; j < 6; j++) {
    const angle = j * 1.04;
    scatter('ferns', coarse, plain, [x + Math.sin(angle) * height * .54, height * .64, z + Math.cos(angle) * height * .54], [height * .26, height * .07, height * .78], [.55, angle, 0], pick([0x678b50, 0x496f47, 0x789451]));
  }
  if (i % 3 === 0) {
    for (let j = 0; j < 3; j++) {
      const mx = x + range(-.6, .6);
      const mz = z + range(-.6, .6);
      const h = range(.1, .26);
      scatter('stems', cylinder, plain, [mx, h / 2, mz], [h * .22, h, h * .22], [0, 0, 0], 0xb99872);
      scatter('caps', sphere, plain, [mx, h, mz], [h * .73, h * .30, h * .73], [0, a, .13], pick([0xbe7745, 0xcd8458, 0xd9b77b]));
    }
  }
}

for (const side of [-1, 1]) {
  const x = side * 3.15;
  for (let i = 0; i < 5; i++) {
    scatter('ruins', box, shadowed, [x + range(-.12, .12), .32 + i * .65, -11.9], [1.22 - i * .07, .62, 1.22], [range(-.055, .055), range(-.21, .21), range(-.06, .06)], pick([0x6d7363, 0x77796a, 0x83816b]));
  }
  obstacles.push({ x, z: -11.9, radius: .75 });
  for (let i = 0; i < 3; i++) {
    const angle = i * .39;
    scatter('ruins', box, shadowed, [side * (3.13 - 1.3 * (1 - Math.cos(angle))), 3.5 + 1.6 * Math.sin(angle), -11.9], [1.02, .61, 1.05], [0, 0, side * angle], 0x767b6a);
  }
}
for (let i = 0; i < 96; i++) {
  const x = range(-13, 13), z = range(-14, 13);
  scatter('litter', coarse, plain, [x, .021, z], [range(.025, .11), .015, range(.06, .22)], [0, range(0, 6.28), 0], pick([0x967648, 0x6b7545, 0x5b4c34, 0xad9056]));
}
flushScenery();

const sporeCount = 110;
const drift = [];
const sporePositions = new Float32Array(sporeCount * 3);
for (let i = 0; i < sporeCount; i++) drift.push([range(-21, 21), range(.35, 9), range(-24, 13), range(0, 7)]);
const sporeGeometry = new THREE.BufferGeometry();
sporeGeometry.setAttribute('position', new THREE.BufferAttribute(sporePositions, 3));
const spores = new THREE.Points(sporeGeometry, new THREE.PointsMaterial({
  color: 0xffe4a0, size: .055, transparent: true, opacity: .64, depthWrite: false,
}));
spores.frustumCulled = false;
scene.add(spores);

export function updateForest(time) {
  for (let i = 0; i < sporeCount; i++) {
    const [x, y, z, phase] = drift[i];
    sporePositions[i * 3] = x + Math.sin(time * .35 + phase) * .9;
    sporePositions[i * 3 + 1] = y + Math.sin(time * .78 + phase) * .32;
    sporePositions[i * 3 + 2] = z + Math.cos(time * .26 + phase) * .8;
  }
  sporeGeometry.attributes.position.needsUpdate = true;
}

const iron = material(0xabb9b1, .37, .67);
const darkIron = material(0x454f4c, .45, .55);
const brass = material(0xe0b562, .42, .53);
const leather = material(0x493527);
const boots = material(0x2a2d25);
const cloth = material(0x315a59);
const trim = material(0xcbac65);
const face = material(0xbd936a);
const tooth = material(0xe0d5a7);
const axeStone = material(0x838884, .48, .48);
const chain = material(0x434340);
const eye = new THREE.MeshStandardMaterial({ color: 0xf6ba48, emissive: 0x9a4116, emissiveIntensity: .65 });
const helmet = material(0x687e7a, .48, .47);
const orcSkin = material(0x68824b);
const bossSkin = material(0x667545);
const redCloth = material(0x773e30);
const helmetSlit = material(0x1a2824);

function extruded(points, depth) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y));
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .025, bevelThickness: .024, bevelSegments: 1, steps: 1 });
  geom.translate(0, 0, -depth / 2);
  return geom;
}
const shieldOutline = extruded([[-.43, .34], [0, .45], [.43, .34], [.39, -.17], [.23, -.36], [0, -.53], [-.23, -.36], [-.39, -.17]], .10);
const swordBlade = extruded([[-.09, .16], [.09, .16], [.074, .92], [0, 1.12], [-.074, .92]], .045);
const axeBlade = extruded([[-.04, -.13], [.18, -.14], [.27, -.29], [.47, -.22], [.52, .19], [.37, .30], [.16, .15], [-.04, .14]], .079);

export function makeShield(parent) {
  const shield = group(parent, 0, 0, 0);
  part(shield, shieldOutline, brass, 0, 0, 0, 1, 1, 1);
  part(shield, shieldOutline, cloth, 0, .008, .051, .84, .85, .57);
  part(shield, sphere, brass, 0, -.02, .156, .111, .111, .057);
  part(shield, box, trim, 0, -.027, .119, .038, .54, .02);
  for (const sign of [-1, 1]) for (const y of [-.12, .1]) {
    part(shield, box, trim, sign * .078, y, .119, .045, .18, .02).rotation.z = sign * -.72;
  }
  return shield;
}

export function makeFighter(kind) {
  const hero = kind === 'hero';
  const elite = kind === 'boss';
  const bodySkin = elite ? bossSkin : orcSkin;
  const scale = elite ? 1.63 : hero ? 1 : 1.05;
  const root = group(scene, 0, 0, 0);
  const figure = group(root, 0, 0, 0);
  figure.scale.setScalar(scale);
  const torso = group(figure, 0, 0, 0);
  part(torso, sphere, hero ? cloth : bodySkin, 0, 1.30, 0, hero ? .43 : .51, .49, .3);
  part(torso, cylinder, leather, 0, .96, .01, .73, .14, .57);
  part(torso, box, brass, 0, .97, .307, .13, .10, .069);
  if (hero) {
    part(torso, sphere, helmet, 0, 1.41, .148, .44, .34, .22);
    part(torso, box, trim, 0, 1.42, .362, .05, .31, .026);
    const cape = part(torso, box, cloth, 0, 1.13, -.32, .58, .93, .09);
    cape.rotation.x = .2;
  } else {
    part(torso, box, elite ? redCloth : leather, 0, 1.38, .27, .16, .73, .095).rotation.z = -.68;
    part(torso, sphere, elite ? darkIron : chain, 0, 1.14, .08, .43, .21, .255);
    if (elite) part(torso, box, redCloth, 0, 1.23, -.33, .76, 1.13, .095).rotation.x = .18;
  }
  const head = group(torso, 0, 1.94, 0);
  part(head, sphere, hero ? face : bodySkin, 0, -.019, .018, .275, .31, .252);
  if (hero) {
    part(head, sphere, helmet, 0, .11, -.01, .30, .28, .28);
    part(head, box, helmetSlit, 0, .015, .239, .44, .08, .068);
    part(head, box, brass, 0, .048, .271, .061, .29, .06);
    part(head, sphere, cloth, 0, .343, -.083, .09, .126, .22);
    for (const sign of [-1, 1]) part(head, box, helmet, sign * .19, -.11, .193, .105, .26, .13).rotation.z = sign * -.19;
  } else {
    part(head, box, bodySkin, 0, -.136, .146, .41, .175, .29);
    part(head, coarse, bodySkin, 0, .012, .253, .102, .107, .095);
    for (const sign of [-1, 1]) {
      part(head, cone, bodySkin, sign * .26, .03, -.005, .107, .29, .075).rotation.z = sign * -1.03;
      part(head, cone, tooth, sign * .15, -.10, .275, .037, .16, .036).rotation.z = sign * -.12;
      part(head, box, eye, sign * .109, .076, .224, .103, .046, .051).rotation.z = sign * .23;
      if (elite) part(head, cone, tooth, sign * .228, .275, -.026, .105, .38, .09).rotation.z = sign * -.51;
    }
    part(head, sphere, elite ? darkIron : redCloth, 0, .177, -.069, .267, .184, .239);
  }
  const arms = [], legs = [];
  let shield;
  for (const sign of [-1, 1]) {
    const arm = group(torso, sign * (hero ? .43 : .51), 1.63, .02);
    part(arm, sphere, hero ? helmet : elite ? darkIron : bodySkin, sign * .05, -.068, 0, .26, .223, .25);
    if (hero || elite) part(arm, sphere, hero ? brass : chain, sign * .097, -.08, .025, .224, .16, .24);
    if (elite) part(arm, cone, tooth, sign * .139, .197, .016, .082, .29, .087).rotation.z = sign * -.43;
    part(arm, cylinder, hero ? cloth : bodySkin, sign * .045, -.28, 0, .27, .40, .28);
    part(arm, sphere, hero ? darkIron : leather, sign * .051, -.49, .037, .153, .20, .142);
    if (sign === -1 && hero) {
      shield = makeShield(arm);
      shield.position.set(-.062, -.43, .18);
      shield.rotation.set(.11, -.12, -.12);
    }
    if (sign === 1) {
      const weapon = group(arm, .081, -.55, .15);
      weapon.rotation.z = hero ? -.17 : -.26;
      if (hero) {
        part(weapon, cylinder, leather, 0, -.02, 0, .082, .30, .083);
        part(weapon, box, brass, 0, .126, 0, .34, .071, .101);
        part(weapon, sphere, brass, 0, -.18, 0, .068, .064, .068);
        part(weapon, swordBlade, iron, 0, 0, 0, 1, 1, 1);
      } else {
        const size = elite ? 1.17 : .96;
        weapon.scale.setScalar(size);
        part(weapon, cylinder, leather, .007, .18, 0, .091, 1.21, .092);
        part(weapon, axeBlade, axeStone, .014, .63, 0, 1, 1, 1);
        if (elite) part(weapon, axeBlade, axeStone, -.02, .63, 0, -1, 1, 1);
      }
    }
    const leg = group(figure, sign * .206, .89, 0);
    part(leg, cylinder, hero ? cloth : elite ? redCloth : leather, 0, -.25, 0, .35, .52, .35);
    part(leg, sphere, hero ? helmet : darkIron, 0, -.532, .043, .187, .16, .180);
    part(leg, box, boots, 0, -.721, .072, .31, .30, .44);
    legs.push(leg);
    arms.push(arm);
  }

  const flashes = [];
  figure.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.material = mesh.material.clone();
    flashes.push({ mat: mesh.material, emissive: mesh.material.emissive.clone(), intensity: mesh.material.emissiveIntensity });
  });
  return { root, figure, torso, arms, legs, shield, flashes, scale };
}

export function removeModel(model) {
  model.root.removeFromParent();
  model.root.traverse((object) => {
    if (object.isMesh) object.material.dispose();
  });
}
