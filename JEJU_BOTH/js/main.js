import * as THREE from "three";
import { DEFAULT_SITES } from "./data.js";
import { CONFIG } from "./config.js";
import { loadFromSheets, logResult } from "./sheets.js";

// ── 지리 좌표 → 게임 월드 좌표 변환 ─────────────────────────────
// 경도 126.13~126.97 → x -380~380 / 위도 33.14~33.60 → z 250~-250 (북쪽이 -z)
const GEO = { lonC: 126.55, lonSpan: 0.84, latC: 33.37, latSpan: 0.46, w: 760, h: 500 };
const lonToX = (lon) => ((lon - GEO.lonC) / GEO.lonSpan) * GEO.w;
const latToZ = (lat) => -((lat - GEO.latC) / GEO.latSpan) * GEO.h;

// 섬 모양(슈퍼타원)과 한라산
const ISLAND = { cx: 0, cz: latToZ(33.385), ax: 380, bz: 222 };
const HALLA = { x: lonToX(126.533), z: latToZ(33.362) };

function rawHeightAt(x, z) {
  const dx = (x - ISLAND.cx) / ISLAND.ax;
  const dz = (z - ISLAND.cz) / ISLAND.bz;
  const s = dx * dx * dx * dx + dz * dz * dz * dz;
  if (s >= 1) return Math.max(-10, -22 * (s - 1)) - 0.4; // 바다 밑
  const coast = 1 - s;
  const base = Math.pow(coast, 0.5) * 3.5;
  const hx = (x - HALLA.x) / 150;
  const hz = (z - HALLA.z) / 95;
  const halla = 62 * Math.exp(-(hx * hx + hz * hz) * 2.2) * Math.pow(coast, 0.3);
  const bumps =
    coast *
    (1.6 * Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.05) +
      1.0 * Math.sin(x * 0.11) * Math.sin(z * 0.09 + 0.6));
  return base + halla + bumps;
}

// ── 유적지 데이터 ────────────────────────────────────────────────
const SITES = DEFAULT_SITES.map((s) => ({
  ...s,
  x: lonToX(s.lon),
  z: latToZ(s.lat),
  done: false,
}));

// 유적지 주변 지형 평탄화 (구조물이 뜨거나 묻히지 않게)
const PLATEAU_R = 30;
const PLATEAU_BLEND = 22;
const PLATEAUS = SITES.map((s) => ({ x: s.x, z: s.z, h: Math.max(rawHeightAt(s.x, s.z), 1.2) }));

function heightAt(x, z) {
  let h = rawHeightAt(x, z);
  for (const p of PLATEAUS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d >= PLATEAU_R + PLATEAU_BLEND) continue;
    let w = 1;
    if (d > PLATEAU_R) {
      const t = (d - PLATEAU_R) / PLATEAU_BLEND;
      w = 1 - t * t * (3 - 2 * t); // smoothstep 감쇠
    }
    h = h * (1 - w) + p.h * w;
  }
  return h;
}

// ── 기본 씬 구성 ────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ecbef);
scene.fog = new THREE.Fog(0x8ecbef, 300, 900);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById("app").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3f6d3f, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.15);
sun.position.set(-250, 400, -150);
scene.add(sun);

// ── 지형 ────────────────────────────────────────────────────────
function buildTerrain() {
  const geo = new THREE.PlaneGeometry(1100, 760, 220, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    if (h < 0.5) c.setHex(0xe6d69e); // 모래
    else if (h < 3) c.setHex(0x8cc063); // 초지
    else if (h < 14) c.setHex(0x55a04f);
    else if (h < 32) c.setHex(0x2f7a3e); // 숲
    else if (h < 48) c.setHex(0x6f6353); // 바위
    else c.setHex(0x9aa0a3); // 정상부
    c.offsetHSL(0, 0, (Math.sin(x * 0.9 + z * 1.3) % 1) * 0.02);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
}
buildTerrain();

// 바다
const ocean = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshPhongMaterial({ color: 0x1e6fae, transparent: true, opacity: 0.92, shininess: 90 })
);
ocean.rotation.x = -Math.PI / 2;
scene.add(ocean);

// ── 도로 (유적지를 잇는 길) ─────────────────────────────────────
const V3 = (x, z) => new THREE.Vector3(x, 0, z);
const siteXZ = (id) => {
  const s = SITES.find((t) => t.id === id);
  return V3(s.x, s.z);
};
// 제어점은 한라산 고지대를 피해 해안 쪽으로 우회하도록 배치
const ROAD_CURVES = [
  new THREE.QuadraticBezierCurve3(siteXZ("jocheon"), V3(185, -195), siteXZ("haenyeo")),
  new THREE.QuadraticBezierCurve3(siteXZ("jocheon"), V3(28, -142), siteXZ("peace43")),
  new THREE.QuadraticBezierCurve3(siteXZ("peace43"), V3(-220, -60), siteXZ("alddreu")),
];
const ROAD_SAMPLES = ROAD_CURVES.flatMap((c) => c.getSpacedPoints(Math.round(c.getLength() / 6)));
const nearRoad = (x, z, r) => ROAD_SAMPLES.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < r * r);

function buildRoads() {
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x7a746b, side: THREE.DoubleSide });
  const W = 2.7; // 반폭
  ROAD_CURVES.forEach((curve) => {
    const n = Math.max(40, Math.round(curve.getLength() / 3.5));
    const pts = curve.getSpacedPoints(n);
    const verts = new Float32Array((n + 1) * 6);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, n)];
      const o = pts[Math.max(i - 1, 0)];
      const dx = q.x - o.x;
      const dz = q.z - o.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const lx = p.x + nx * W;
      const lz = p.z + nz * W;
      const rx = p.x - nx * W;
      const rz = p.z - nz * W;
      verts.set([lx, heightAt(lx, lz) + 0.22, lz, rx, heightAt(rx, rz) + 0.22, rz], i * 6);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, roadMat));
  });
}
buildRoads();

// 나무
function buildTrees() {
  const count = 380;
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3, 5);
  const leafGeo = new THREE.ConeGeometry(2.4, 6, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2e }), count);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x256b34 }), count);
  const m = new THREE.Matrix4();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < 8000) {
    const x = (Math.random() - 0.5) * 740;
    const z = (Math.random() - 0.5) * 470;
    const h = heightAt(x, z);
    if (h < 3.5 || h > 40) continue;
    if (SITES.some((s) => (x - s.x) ** 2 + (z - s.z) ** 2 < 32 * 32)) continue;
    if (nearRoad(x, z, 6)) continue;
    const sc = 0.7 + Math.random() * 0.9;
    m.makeScale(sc, sc, sc);
    m.setPosition(x, h + 1.5 * sc, z);
    trunks.setMatrixAt(placed, m);
    m.setPosition(x, h + (3 + 3) * sc * 0.85, z);
    leaves.setMatrixAt(placed, m);
    placed++;
  }
  trunks.count = leaves.count = placed;
  scene.add(trunks, leaves);
}
buildTrees();

// 구름
const clouds = [];
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let j = 0; j < 4; j++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 7, 8, 8), mat);
    puff.position.set(j * 11 - 16, Math.random() * 4, Math.random() * 8 - 4);
    puff.scale.y = 0.55;
    g.add(puff);
  }
  g.position.set((Math.random() - 0.5) * 900, 95 + Math.random() * 40, (Math.random() - 0.5) * 600);
  clouds.push(g);
  scene.add(g);
}

// ── 캐릭터 (귤 머리띠를 한 학자 — 한손엔 붓, 한손엔 서책) ────────
const player = new THREE.Group();
{
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffd9b3 });
  const robeMat = new THREE.MeshLambertMaterial({ color: 0xf4ecd9 });
  const inkMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2b });
  const gyulMat = new THREE.MeshLambertMaterial({ color: 0xff8f2e });

  // 두루마기 (아래로 퍼지는 도포 자락)
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 2.7, 14), robeMat);
  robe.position.y = 1.45;
  const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.73, 0.82, 0.25, 14), new THREE.MeshLambertMaterial({ color: 0x2e6b4f }));
  sash.position.y = 2.0;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 12), robeMat);
  chest.position.y = 2.75;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), skinMat);
  head.position.y = 3.4;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.25, 3.5, 0.72);
  eyeR.position.set(0.25, 3.5, 0.72);

  // 상투
  const topknot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), inkMat);
  topknot.position.y = 4.28;

  // 귤 머리띠 (이마의 귤 장식 + 잎사귀)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.14, 8, 22), gyulMat);
  band.rotation.x = Math.PI / 2;
  band.position.y = 3.72;
  const gyul = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), gyulMat);
  gyul.scale.y = 0.85;
  gyul.position.set(0, 3.85, 0.8);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshLambertMaterial({ color: 0x2e8b3f }));
  leaf.scale.set(1.4, 0.5, 0.8);
  leaf.position.set(0.08, 4.12, 0.84);

  // 앞으로 내민 도포 소매 + 손
  const armGeo = new THREE.CylinderGeometry(0.2, 0.34, 1.5, 8);
  const armR = new THREE.Mesh(armGeo, robeMat);
  armR.position.set(0.82, 2.4, 0.4);
  armR.rotation.set(0.95, 0, -0.45);
  const armL = new THREE.Mesh(armGeo, robeMat);
  armL.position.set(-0.82, 2.4, 0.4);
  armL.rotation.set(0.95, 0, 0.45);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), skinMat);
  handR.position.set(1.12, 2.0, 0.88);
  const handL = handR.clone();
  handL.position.set(-1.12, 2.0, 0.88);

  // 오른손: 붓 (세운 붓대 + 아래로 향한 먹물 붓촉)
  const brush = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.15, 6), new THREE.MeshLambertMaterial({ color: 0xb98a4e }));
  handle.position.y = 0.45;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 8), inkMat);
  tip.rotation.x = Math.PI;
  tip.position.y = -0.32;
  brush.add(handle, tip);
  brush.position.set(1.12, 2.15, 0.88);
  brush.rotation.z = -0.12;

  // 왼손: 서책 (파란 표지 + 하얀 책장)
  const book = new THREE.Group();
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.2, 0.62), new THREE.MeshLambertMaterial({ color: 0xf7f2e2 }));
  const coverMat = new THREE.MeshLambertMaterial({ color: 0x33608c });
  const coverTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.7), coverMat);
  coverTop.position.y = 0.12;
  const coverBottom = coverTop.clone();
  coverBottom.position.y = -0.12;
  book.add(pages, coverTop, coverBottom);
  book.position.set(-1.12, 2.18, 0.88);
  book.rotation.set(0.15, 0, 0.18);

  player.add(robe, sash, chest, head, eyeL, eyeR, topknot, band, gyul, leaf, armR, armL, handR, handL, brush, book);
}
const blobShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1.9, 20),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
);
blobShadow.rotation.x = -Math.PI / 2;
scene.add(player, blobShadow);

const pState = { x: -18, z: -141, angle: Math.PI };
player.position.set(pState.x, heightAt(pState.x, pState.z), pState.z);

// ── UI 아이콘 (Heroicons outline) ───────────────────────────────
const ICON_PATHS = {
  mapPin:
    "M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z",
  check: "m4.5 12.75 6 6 9-13.5",
  checkCircle: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  pencil:
    "m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125",
  sparkles:
    "M9.813 15.904 9.375 18.75l-.438-2.846a4.5 4.5 0 0 0-3.09-3.09L3 12.375l2.846-.438a4.5 4.5 0 0 0 3.09-3.09L9.375 6l.438 2.846a4.5 4.5 0 0 0 3.09 3.09l2.846.438-2.846.438a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z",
  faceFrown:
    "M15.182 16.318A4.486 4.486 0 0 0 12.016 15a4.486 4.486 0 0 0-3.198 1.318M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z",
  warning:
    "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
};
const icon = (name) =>
  `<svg class="hi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;

// ── 유적지 마커 ─────────────────────────────────────────────────
const RED = 0xff3d4e;
const GREEN = 0x2ecc71;

const LABEL_FONT = "bold 88px 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif";
const labelRedraws = [];

function makeLabel(text) {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 200;
  const ctx = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  const draw = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.font = LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(10,25,45,0.9)";
    ctx.strokeText(text, 512, 100);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 512, 100);
    tex.needsUpdate = true;
  };
  draw();
  labelRedraws.push(draw); // 웹폰트 로드 후 Pretendard로 다시 그림
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(42, 8.2, 1);
  return sp;
}
document.fonts?.ready.then(() => labelRedraws.forEach((draw) => draw()));

const markers = [];
SITES.forEach((site) => {
  const g = new THREE.Group();
  // 구조물과 겹치지 않도록 남쪽(광장 앞)에 배치
  const mz = site.z + 11;
  const y = heightAt(site.x, mz);
  g.position.set(site.x, y, mz);

  const ringMat = new THREE.MeshBasicMaterial({ color: RED });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.35, 10, 40), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.6;

  const pillarMat = new THREE.MeshLambertMaterial({ color: RED, emissive: RED, emissiveIntensity: 0.5 });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 10, 10), pillarMat);
  pillar.position.y = 5;

  const orbMat = new THREE.MeshLambertMaterial({ color: RED, emissive: RED, emissiveIntensity: 0.8 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1.7, 18, 18), orbMat);
  orb.position.y = 12;

  const beamMat = new THREE.MeshBasicMaterial({
    color: RED,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 46, 14, 1, true), beamMat);
  beam.position.y = 23;

  const label = makeLabel(site.name);
  label.position.y = 19;

  g.add(ring, pillar, orb, beam, label);
  scene.add(g);
  markers.push({ site, group: g, orb, ring, mats: [ringMat, pillarMat, orbMat, beamMat] });
});

function setMarkerDone(marker) {
  marker.mats.forEach((m) => {
    m.color.setHex(GREEN);
    if (m.emissive) m.emissive.setHex(GREEN);
  });
}

// ── 유적지 구조물 (실제 모습을 본뜬 저폴리 재현) ────────────────
const MAT = {
  stone: new THREE.MeshLambertMaterial({ color: 0xd8d8d0 }),
  darkStone: new THREE.MeshLambertMaterial({ color: 0x8f8f88 }),
  concrete: new THREE.MeshLambertMaterial({ color: 0x9fa39a }),
  asphalt: new THREE.MeshLambertMaterial({ color: 0x55534e }),
  white: new THREE.MeshLambertMaterial({ color: 0xf2f2ec }),
  bronze: new THREE.MeshLambertMaterial({ color: 0x5d4a3a }),
  glass: new THREE.MeshLambertMaterial({ color: 0x35586e }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a5a3a }),
  orange: new THREE.MeshLambertMaterial({ color: 0xe8843c }),
};

function box(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}
function cyl(rTop, rBot, h, seg, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

// 태극기 텍스처
function taegukgiTexture() {
  const cv = document.createElement("canvas");
  cv.width = 96;
  cv.height = 64;
  const c = cv.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 96, 64);
  c.fillStyle = "#cd2e3a";
  c.beginPath();
  c.arc(48, 32, 14, Math.PI, 0);
  c.fill();
  c.fillStyle = "#0047a0";
  c.beginPath();
  c.arc(48, 32, 14, 0, Math.PI);
  c.fill();
  c.fillStyle = "#cd2e3a";
  c.beginPath();
  c.arc(41, 32, 7, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#0047a0";
  c.beginPath();
  c.arc(55, 32, 7, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#111";
  [[10, 18], [10, 38], [74, 18], [74, 38]].forEach(([x, y]) => {
    for (let i = 0; i < 3; i++) c.fillRect(x, y + i * 4, 12, 2);
  });
  return new THREE.CanvasTexture(cv);
}
const flagTex = taegukgiTexture();

function flagpole(x, z, h = 11) {
  const g = new THREE.Group();
  g.add(cyl(0.09, 0.13, h, 8, MAT.darkStone, 0, h / 2, 0));
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.1),
    new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide })
  );
  flag.position.set(1.7, h - 1.3, 0);
  g.add(flag);
  g.position.set(x, 0, z);
  return g;
}

// 조천만세동산: 광장 + 애국선열추모탑 + 3·1운동기념탑 + 태극기
function buildJocheon(g) {
  g.add(cyl(17, 18, 0.7, 28, MAT.stone, 0, 0.35, 0));
  // 애국선열추모탑 (중앙 뒤편, 날개벽을 거느린 흰 탑)
  g.add(box(7, 1.4, 7, MAT.darkStone, 0, 1.1, -9));
  g.add(box(5, 1.4, 5, MAT.darkStone, 0, 2.4, -9));
  const tower = cyl(0.8, 1.5, 17, 4, MAT.white, 0, 11, -9);
  tower.rotation.y = Math.PI / 4;
  g.add(tower);
  const top = cyl(0.05, 0.9, 1.8, 4, MAT.white, 0, 20.3, -9);
  top.rotation.y = Math.PI / 4;
  g.add(top);
  g.add(box(2.6, 4.5, 0.9, MAT.white, -3.2, 3.4, -9, 0.18));
  g.add(box(2.6, 4.5, 0.9, MAT.white, 3.2, 3.4, -9, -0.18));
  // 3·1운동기념탑 (작은 비석)
  g.add(box(2.2, 0.8, 1.4, MAT.darkStone, 8.5, 0.9, 3));
  g.add(box(1.5, 3.6, 0.7, MAT.stone, 8.5, 3.1, 3));
  // 태극기 게양대
  g.add(flagpole(-11, 8));
  g.add(flagpole(11, 8));
}

// 제주해녀항일운동기념탑: 3단 기단 + 돌탑 + 해녀상 + 테왁
function buildHaenyeo(g) {
  g.add(cyl(7.5, 8.2, 0.8, 24, MAT.stone, 0, 0.4, 0));
  g.add(cyl(5.2, 5.8, 0.9, 24, MAT.stone, 0, 1.25, 0));
  g.add(cyl(3.4, 3.9, 0.9, 24, MAT.darkStone, 0, 2.15, 0));
  const tower = cyl(0.9, 1.5, 15, 4, MAT.darkStone, 0, 10.1, 0);
  tower.rotation.y = Math.PI / 4;
  g.add(tower);
  // 해녀상 3인 (물옷 차림, 기단 앞)
  [-2.4, 0, 2.4].forEach((dx, i) => {
    const fig = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.2, 4, 8), MAT.bronze);
    body.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), MAT.bronze);
    head.position.y = 2.5;
    fig.add(body, head);
    fig.position.set(dx, 1.7, 4.2 - Math.abs(dx) * 0.2);
    fig.rotation.y = -dx * 0.12;
    if (i === 1) fig.scale.setScalar(1.12);
    g.add(fig);
  });
  // 테왁 (주황 부표)
  g.add(cyl(0.55, 0.55, 1.1, 10, MAT.orange, 4.2, 2.25, 2.6));
}

// 알뜨르 비행장: 활주로 + 아치형 콘크리트 격납고
function buildAlddreu(g) {
  const runway = box(56, 0.3, 13, MAT.asphalt, 0, 0.15, 10, 0.2);
  g.add(runway);
  const hangarPos = [
    [-18, -12, 0.3],
    [-2, -16, 0.1],
    [14, -11, 0.45],
    [27, -18, 0.2],
  ];
  hangarPos.forEach(([hx, hz, ry]) => {
    const hangar = new THREE.Group();
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 8, 14, 1, false, 0, Math.PI), MAT.concrete);
    arch.rotation.z = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    hangar.add(arch);
    const back = new THREE.Mesh(new THREE.CircleGeometry(4.6, 14, 0, Math.PI), MAT.concrete);
    back.position.z = -4;
    hangar.add(back);
    hangar.position.set(hx, 0.1, hz);
    hangar.rotation.y = ry;
    g.add(hangar);
  });
}

// 4·3 평화공원: 원형 광장 + 위령탑 + 각명비 + 기념관
function buildPeace43(g) {
  g.add(cyl(15, 16, 0.6, 28, MAT.stone, 0, 0.3, 0));
  // 위령탑 (원형 제단 위 두 손을 모은 형태)
  g.add(cyl(4.5, 5, 1.1, 20, MAT.darkStone, 0, 1.1, -6));
  const armL = box(1.3, 12, 1.3, MAT.white, -2, 7, -6);
  armL.rotation.z = 0.22;
  const armR = box(1.3, 12, 1.3, MAT.white, 2, 7, -6);
  armR.rotation.z = -0.22;
  g.add(armL, armR);
  // 각명비 (희생자 이름을 새긴 벽, 반원 배치)
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7;
    const wx = Math.cos(a) * 13;
    const wz = -Math.sin(a) * 13 - 2;
    g.add(box(3.6, 2.1, 0.5, MAT.darkStone, wx, 1.05, wz, Math.PI / 2 - a));
  }
  // 4·3평화기념관 (낮고 둥근 건물)
  const museum = new THREE.Group();
  museum.add(cyl(8.5, 9, 4.6, 22, MAT.white, 0, 2.3, 0));
  museum.add(cyl(8.8, 8.8, 0.9, 22, MAT.glass, 0, 3.4, 0));
  museum.add(cyl(4, 9.1, 1.2, 22, MAT.concrete, 0, 5.3, 0));
  museum.position.set(20, 0, 14);
  g.add(museum);
}

const STRUCTURE_BUILDERS = {
  jocheon: buildJocheon,
  haenyeo: buildHaenyeo,
  alddreu: buildAlddreu,
  peace43: buildPeace43,
};

SITES.forEach((site) => {
  const build = STRUCTURE_BUILDERS[site.id];
  if (!build) return;
  const g = new THREE.Group();
  g.position.set(site.x, heightAt(site.x, site.z), site.z);
  build(g);
  scene.add(g);
});

// ── 입력 ────────────────────────────────────────────────────────
const keys = new Set();
let uiOpen = true; // 시작 화면부터
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  keys.add(e.code);
  if (e.code === "KeyE" && !uiOpen && nearSite) openPanel(nearSite);
  if (e.code === "Escape") closeAllPanels();
  if (!uiOpen && /^Digit[1-4]$/.test(e.code)) {
    const s = SITES[parseInt(e.code.slice(5), 10) - 1];
    if (s) {
      pState.x = s.x + 9;
      pState.z = s.z + 9;
      showToast(`${icon("mapPin")} ${s.name} 근처로 이동했습니다`);
      renderHUD();
      drawMinimap();
    }
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));

// 카메라 궤도 (드래그)
const cam = { yaw: Math.PI, pitch: 0.42, dist: 27 };
let dragging = false;
let lastPX = 0;
let lastPY = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastPX = e.clientX;
  lastPY = e.clientY;
});
addEventListener("pointerup", () => (dragging = false));
addEventListener("pointermove", (e) => {
  if (!dragging || uiOpen) return;
  cam.yaw -= (e.clientX - lastPX) * 0.005;
  cam.pitch = Math.min(1.25, Math.max(0.08, cam.pitch + (e.clientY - lastPY) * 0.004));
  lastPX = e.clientX;
  lastPY = e.clientY;
});
addEventListener("wheel", (e) => {
  if (uiOpen) return;
  cam.dist = Math.min(65, Math.max(12, cam.dist + e.deltaY * 0.03));
});

// ── UI 요소 ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hud = $("hud");
const promptEl = $("prompt");
const panel = $("panel");
const panelCard = $("panelCard");
const minimap = $("minimap");
const mmCtx = minimap.getContext("2d");

let playerName = "";
let nearSite = null;

function showToast(msg, ms = 2200) {
  const t = $("toast");
  t.innerHTML = msg;
  t.style.opacity = 1;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.style.opacity = 0), ms);
}

function renderHUD() {
  const doneCount = SITES.filter((s) => s.done).length;
  $("progress").textContent = `${doneCount}/${SITES.length}`;
  $("siteList").innerHTML = SITES.map((s, i) => {
    const d = Math.round(Math.hypot(pState.x - s.x, pState.z - s.z) / 10); // 10유닛 ≈ 1km
    return `<div class="site-row"><span class="dot ${s.done ? "done" : ""}"></span>${s.name}<span class="key">[${i + 1}]</span><span class="dist">${d}km</span></div>`;
  }).join("");
}

// 미니맵
function superellipsePoint(t) {
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return [
    ISLAND.cx + ISLAND.ax * Math.sign(ct) * Math.sqrt(Math.abs(ct)),
    ISLAND.cz + ISLAND.bz * Math.sign(st) * Math.sqrt(Math.abs(st)),
  ];
}
const mmX = (x) => 95 + (x / 800) * 180;
function drawMinimap() {
  mmCtx.clearRect(0, 0, 190, 140);
  mmCtx.fillStyle = "rgba(20,50,90,0.4)";
  mmCtx.fillRect(0, 0, 190, 140);
  mmCtx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const [x, z] = superellipsePoint((i / 64) * Math.PI * 2);
    const px = mmX(x);
    const py = 70 + (z / 800) * 180;
    i === 0 ? mmCtx.moveTo(px, py) : mmCtx.lineTo(px, py);
  }
  mmCtx.closePath();
  mmCtx.fillStyle = "#3e7d46";
  mmCtx.fill();
  // 한라산
  mmCtx.beginPath();
  mmCtx.arc(mmX(HALLA.x), 70 + (HALLA.z / 800) * 180, 6, 0, Math.PI * 2);
  mmCtx.fillStyle = "#2a5a33";
  mmCtx.fill();
  // 도로
  mmCtx.strokeStyle = "rgba(255,255,255,0.55)";
  mmCtx.lineWidth = 1.2;
  ROAD_CURVES.forEach((c) => {
    mmCtx.beginPath();
    c.getSpacedPoints(40).forEach((p, i) => {
      const px = mmX(p.x);
      const py = 70 + (p.z / 800) * 180;
      i === 0 ? mmCtx.moveTo(px, py) : mmCtx.lineTo(px, py);
    });
    mmCtx.stroke();
  });
  // 유적지
  SITES.forEach((s) => {
    mmCtx.beginPath();
    mmCtx.arc(mmX(s.x), 70 + (s.z / 800) * 180, 4, 0, Math.PI * 2);
    mmCtx.fillStyle = s.done ? "#2ecc71" : "#ff3d4e";
    mmCtx.fill();
    mmCtx.strokeStyle = "rgba(255,255,255,0.7)";
    mmCtx.lineWidth = 1;
    mmCtx.stroke();
  });
  // 플레이어
  mmCtx.beginPath();
  mmCtx.arc(mmX(pState.x), 70 + (pState.z / 800) * 180, 3.5, 0, Math.PI * 2);
  mmCtx.fillStyle = "#ffffff";
  mmCtx.fill();
}

// ── 유적지 정보 / 퀴즈 패널 ─────────────────────────────────────
function closeAllPanels() {
  panel.classList.add("hidden");
  $("finishScreen").classList.add("hidden");
  if (!$("startScreen").classList.contains("hidden")) return;
  uiOpen = false;
}

function openPanel(site) {
  uiOpen = true;
  panel.classList.remove("hidden");
  panelCard.innerHTML = `
    <span class="badge ${site.done ? "done" : ""}">${site.done ? `${icon("check")} 탐방 완료` : "미탐방 유적지"}</span>
    <h2>${site.name}</h2>
    <div class="history">${site.history}</div>
    <div class="actions">
      <button class="btn secondary" id="pClose">닫기</button>
      <button class="btn" id="pQuiz">${site.done ? "퀴즈 다시 풀기" : `퀴즈 풀기 ${icon("pencil")}`}</button>
    </div>`;
  $("pClose").onclick = closeAllPanels;
  $("pQuiz").onclick = () => startQuiz(site);
}

function startQuiz(site) {
  const state = { i: 0, wrong: 0 };
  renderQuestion(site, state);
}

function renderQuestion(site, state) {
  const q = site.quiz[state.i];
  panelCard.innerHTML = `
    <span class="badge">퀴즈</span>
    <h2>${site.name}</h2>
    <div class="quiz-progress">문제 ${state.i + 1} / ${site.quiz.length}</div>
    <div class="quiz-q">${q.q}</div>
    <div id="opts">${q.options
      .map((o, i) => `<button class="quiz-opt" data-i="${i}">${i + 1}. ${o}</button>`)
      .join("")}</div>
    <div id="qFeedback"></div>
    <div class="actions"><button class="btn secondary" id="pClose">그만두기</button></div>`;
  $("pClose").onclick = closeAllPanels;

  panelCard.querySelectorAll(".quiz-opt").forEach((btn) => {
    btn.onclick = () => {
      const pick = parseInt(btn.dataset.i, 10);
      panelCard.querySelectorAll(".quiz-opt").forEach((b) => (b.disabled = true));
      const fb = $("qFeedback");
      if (pick === q.answer) {
        btn.classList.add("correct");
        fb.innerHTML = `<div class="quiz-feedback ok">${icon("sparkles")} 정답! ${q.explain}</div>`;
        const last = state.i === site.quiz.length - 1;
        const next = document.createElement("button");
        next.className = "btn";
        next.textContent = last ? "탐방 완료!" : "다음 문제 →";
        next.onclick = () => {
          if (last) finishSite(site, state);
          else {
            state.i++;
            renderQuestion(site, state);
          }
        };
        panelCard.querySelector(".actions").appendChild(next);
      } else {
        state.wrong++;
        btn.classList.add("wrong");
        fb.innerHTML = `<div class="quiz-feedback no">${icon("faceFrown")} 아쉬워요! 위의 설명을 떠올리며 다시 도전해 보세요.</div>`;
        const retry = document.createElement("button");
        retry.className = "btn";
        retry.textContent = "다시 풀기";
        retry.onclick = () => renderQuestion(site, state);
        panelCard.querySelector(".actions").appendChild(retry);
      }
    };
  });
}

function finishSite(site, state) {
  const first = !site.done;
  site.done = true;
  const marker = markers.find((m) => m.site === site);
  if (marker) setMarkerDone(marker);
  renderHUD();
  closeAllPanels();
  showToast(`${icon("checkCircle")} ${site.name} 탐방 완료!`);
  logResult(CONFIG, {
    player: playerName || "익명",
    site_id: site.id,
    site_name: site.name,
    result: "clear",
    wrong_count: String(state.wrong),
  });
  if (first && SITES.every((s) => s.done)) {
    setTimeout(() => {
      uiOpen = true;
      $("finishText").textContent = `${playerName || "탐험가"}님, 제주의 네 유적지를 모두 탐방했습니다. 아픈 역사를 기억하는 것이 평화의 첫걸음입니다.`;
      $("finishScreen").classList.remove("hidden");
    }, 800);
  }
}
$("finishClose").onclick = closeAllPanels;

// ── 시작 ────────────────────────────────────────────────────────
(async () => {
  const status = $("sheetStatus");
  if (CONFIG.APPS_SCRIPT_URL || CONFIG.SHEET_ID) {
    status.textContent = "구글 시트에서 데이터를 불러오는 중…";
    const r = await loadFromSheets(CONFIG, SITES);
    status.innerHTML = r.loaded
      ? `${icon("checkCircle")} 구글 시트 연결됨 · ${r.via} (유적지 설명 ${r.siteCount}건 적용)`
      : `${icon("warning")} ${r.error || "시트를 읽지 못해 기본 데이터를 사용합니다."}`;
  } else {
    status.textContent = "내장 데이터로 실행 중 — js/config.js 에 APPS_SCRIPT_URL을 넣으면 구글 시트와 연동됩니다.";
  }
})();

$("startBtn").onclick = () => {
  playerName = $("playerName").value.trim();
  $("startScreen").classList.add("hidden");
  hud.classList.remove("hidden");
  minimap.classList.remove("hidden");
  $("controlsHint").classList.remove("hidden");
  uiOpen = false;
  renderHUD();
};

// ── 게임 루프 ───────────────────────────────────────────────────
const clock = new THREE.Clock();
const SPEED = 27;
const RUN = 48;
let lastHudUpdate = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 이동
  let mx = 0;
  let mz = 0;
  if (!uiOpen) {
    if (keys.has("KeyW") || keys.has("ArrowUp")) mz += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) mz -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
  }
  const moving = mx !== 0 || mz !== 0;
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? RUN : SPEED;
    // 카메라 기준 방향
    const fwdX = -Math.sin(cam.yaw);
    const fwdZ = -Math.cos(cam.yaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const vx = (fwdX * mz + rightX * mx) * speed * dt;
    const vz = (fwdZ * mz + rightZ * mx) * speed * dt;
    const nx = Math.min(520, Math.max(-520, pState.x + vx));
    const nz = Math.min(360, Math.max(-360, pState.z + vz));
    if (heightAt(nx, nz) > -1.2) {
      pState.x = nx;
      pState.z = nz;
    }
    pState.angle = Math.atan2(vx, vz);
  }

  const groundY = Math.max(heightAt(pState.x, pState.z), -1.2);
  const bob = moving ? Math.abs(Math.sin(t * 9)) * 0.45 : 0;
  player.position.set(pState.x, groundY + bob, pState.z);
  let da = pState.angle - player.rotation.y;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  player.rotation.y += da * Math.min(1, dt * 12);
  blobShadow.position.set(pState.x, groundY + 0.15, pState.z);

  // 카메라
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    pState.x + Math.sin(cam.yaw) * cam.dist * cp,
    groundY + 4 + Math.sin(cam.pitch) * cam.dist,
    pState.z + Math.cos(cam.yaw) * cam.dist * cp
  );
  const camGround = heightAt(camera.position.x, camera.position.z);
  if (camera.position.y < camGround + 2.5) camera.position.y = camGround + 2.5;
  camera.lookAt(pState.x, groundY + 5, pState.z);

  // 마커 애니메이션 + 근접 감지
  nearSite = null;
  let bestD = Infinity;
  markers.forEach((m, i) => {
    m.orb.position.y = 12 + Math.sin(t * 2 + i) * 0.9;
    m.ring.rotation.z = t * 0.6;
    const d = Math.hypot(pState.x - m.site.x, pState.z - m.site.z);
    if (d < 17 && d < bestD) {
      bestD = d;
      nearSite = m.site;
    }
  });
  if (nearSite && !uiOpen) {
    promptEl.innerHTML = `<kbd>E</kbd> &nbsp;${nearSite.name} 살펴보기`;
    promptEl.classList.remove("hidden");
  } else {
    promptEl.classList.add("hidden");
  }

  // 구름 이동
  clouds.forEach((c2, i) => {
    c2.position.x += dt * (2 + (i % 3));
    if (c2.position.x > 550) c2.position.x = -550;
  });

  const now = performance.now();
  if (now - lastHudUpdate > 400 && !hud.classList.contains("hidden")) {
    lastHudUpdate = now;
    renderHUD();
    drawMinimap();
  }

  renderer.render(scene, camera);
}
animate();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
