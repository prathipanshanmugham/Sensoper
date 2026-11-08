/* The home page's 3D hero: rows of glass TOPCon solar panels and a battery-and-inverter cabinet, filmed from dawn to night.
   One number — the scroll progress p from 0 to 1 — sets the time of day, the camera, the light and the energy flows.
   Built into assets/hero3d.js with:  npm run build:hero  (see website/README.md). */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Vector3, Object3D, BoxGeometry, PlaneGeometry, SphereGeometry, BufferGeometry,
  Float32BufferAttribute, Points, PointsMaterial, Mesh, InstancedMesh, MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial,
  ShaderMaterial, DirectionalLight, HemisphereLight, PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace, CanvasTexture,
  PMREMGenerator, CatmullRomCurve3, TubeGeometry, AdditiveBlending, BackSide, MathUtils,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const { clamp, lerp, smoothstep, degToRad } = MathUtils;
const ease = (t) => t * t * (3 - 2 * t);

/** Hour of day for scroll progress p. */
export const hourAt = (p) => (p < 0.5 ? lerp(5.95, 12.5, p / 0.5) : p < 0.82 ? lerp(12.5, 18.2, (p - 0.5) / 0.32) : lerp(18.2, 20.2, (p - 0.82) / 0.18));
/** What a home system does at hour h (a 6.6 kWp roof and a 10 kWh battery, clear November day near Erode). */
export function energyAt(h) {
  const elev = Math.sin(Math.PI * clamp((h - 6.05) / 12.1, 0, 1)) * 58;
  const solar = elev > 0.5 ? 6.6 * 0.78 * Math.pow(Math.sin(degToRad(elev)), 1.12) : 0;
  const home = 0.45 + 0.9 * Math.exp(-((h - 7.5) ** 2) / 1.2) + 1.3 * Math.exp(-((h - 19.5) ** 2) / 2.5);
  const battery = h < 6 ? 65 - 30 * h / 6 : h < 7 ? 35 : h < 15 ? lerp(35, 100, smoothstep(h, 7, 15)) : h < 18 ? 100 : 100 - 38 * (1 - Math.exp(-(h - 18) / 2.5));
  return { elev, solar, home, battery };
}

function cellTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#c3c9d1'; g.fillRect(0, 0, 512, 1024);                       // aluminium frame
  g.fillStyle = '#1a2130'; g.fillRect(9, 9, 494, 1006);
  const cols = 6, rows = 20, pad = 3, w = (494 - pad * (cols + 1)) / cols, h = (1006 - pad * (rows + 3)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = 9 + pad + k * (w + pad), y = 9 + pad + r * (h + pad) + (r >= rows / 2 ? pad * 2 : 0);
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, '#0f1d3a'); gr.addColorStop(0.55, '#0a1329'); gr.addColorStop(1, '#14264d');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(160,175,195,.22)'; g.lineWidth = 1;
      for (let b = 1; b < 10; b++) { const bx = x + (w / 10) * b; g.beginPath(); g.moveTo(bx, y + 1); g.lineTo(bx, y + h - 1); g.stroke(); }
    }
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function radialTexture(rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, `rgba(${rgb},1)`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

export function createHero(canvas, { mobile = false } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: !mobile || (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.fog = new Fog(0xdfe7ee, 30, 170);
  const camera = new PerspectiveCamera(36, 1, 0.1, 900);

  /* sky with the sun drawn in, and stars for the night */
  const sky = new Mesh(new SphereGeometry(500, 48, 24), new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new Color() }, mid: { value: new Color() }, horizon: { value: new Color() }, sunDir: { value: new Vector3() }, sunColor: { value: new Color() }, sunAmt: { value: 1 } },
    vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunAmt; varying vec3 vW;
      void main(){ vec3 d = normalize(vW); float h = d.y;
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.14, h));
        col = mix(col, top, smoothstep(0.1, 0.7, h));
        if (h < 0.0) col = horizon * 0.85;
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * sunAmt * (pow(s, 2400.0) * 14.0 + pow(s, 180.0) * 0.7 + pow(s, 16.0) * 0.25 + pow(s, 3.0) * 0.07);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);
  const starGeo = new BufferGeometry(); const sp = [];
  for (let i = 0; i < 900; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.92 + 0.06), r = 480;
    sp.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new Float32BufferAttribute(sp, 3));
  const starMat = new PointsMaterial({ color: 0xdfe8ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  scene.add(new Points(starGeo, starMat));

  const hemi = new HemisphereLight(0xbfd6ff, 0x55524c, 0.3);
  const sun = new DirectionalLight(0xffffff, 3.5);
  const moon = new DirectionalLight(0x8fa8ff, 0); moon.position.set(-30, 45, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 26, bottom: -26, near: 1, far: 200 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target, moon);

  const M = {
    deck: new MeshStandardMaterial({ color: 0x6b6e72, roughness: 0.92, envMapIntensity: 0.14 }),
    edge: new MeshStandardMaterial({ color: 0xa9acb0, roughness: 0.85, envMapIntensity: 0.15 }),
    alu: new MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.28, metalness: 0.9, envMapIntensity: 1 }),
    rail: new MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.6, envMapIntensity: 0.5 }),
    cells: new MeshPhysicalMaterial({ map: cellTexture(), roughness: 0.34, metalness: 0.08, clearcoat: 0.85, clearcoatRoughness: 0.05, envMapIntensity: 0.5 }),
    back: new MeshStandardMaterial({ color: 0xd4d8dd, roughness: 0.6, envMapIntensity: 0.3 }),
    cabinet: new MeshPhysicalMaterial({ color: 0xf3f3f1, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.7 }),
    plinth: new MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, envMapIntensity: 0.3 }),
    bar: new MeshStandardMaterial({ color: 0x0b1210, emissive: new Color(0x7bd389), emissiveIntensity: 0 }),
    led: new MeshStandardMaterial({ color: 0x0b1210, emissive: new Color(0xf2b544), emissiveIntensity: 0 }),
  };
  Object.values(M).forEach((m) => { m.envMap = envTex; });
  const ENV = Object.values(M).map((m) => [m, m.envMapIntensity]);
  const box = (w, h, d, mat, x, y, z, cast = true) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
  };

  /* a large flat roof, with a raised edge where it ends */
  const deck = new Mesh(new PlaneGeometry(1400, 1400), M.deck); deck.rotation.x = -Math.PI / 2; deck.receiveShadow = true; scene.add(deck);

  /* the array: 8 rows × 24 panels, tilted 12° to the south, on dark rails */
  const ROWS = 8, PER = 24, tilt = degToRad(12), rowGap = 3.3, x0 = -(PER - 1) * 1.16 / 2;
  const panels = new InstancedMesh(new BoxGeometry(1.13, 0.04, 2.28), [M.alu, M.alu, M.cells, M.back, M.alu, M.alu], ROWS * PER);
  panels.castShadow = true; panels.receiveShadow = true;
  const o = new Object3D(); let n = 0;
  const rowZ = (r) => (r - (ROWS - 1) / 2) * rowGap;
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < PER; i++) {
      o.position.set(x0 + i * 1.16, 0.62 + Math.sin(tilt) * 1.14, rowZ(r)); o.rotation.set(tilt, 0, 0); o.updateMatrix();
      panels.setMatrixAt(n++, o.matrix);
    }
    box(PER * 1.16, 0.06, 0.08, M.rail, 0, 0.45, rowZ(r) + 0.95);
    box(PER * 1.16, 0.06, 0.08, M.rail, 0, 0.92, rowZ(r) - 0.95);
  }
  scene.add(panels);
  const legs = new InstancedMesh(new BoxGeometry(0.06, 1, 0.06), M.rail, ROWS * 9 * 2); legs.castShadow = true; n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let k = 0; k < 9; k++) {
      const x = x0 + k * ((PER - 1) * 1.16 / 8);
      [[0.45, 0.95], [0.92, -0.95]].forEach(([h, dz]) => { o.position.set(x, h / 2, rowZ(r) + dz); o.rotation.set(0, 0, 0); o.scale.set(1, h, 1); o.updateMatrix(); legs.setMatrixAt(n++, o.matrix); });
    }
  }
  o.scale.set(1, 1, 1);
  scene.add(legs);

  /* the cabinet: hybrid inverter and lithium battery, on a dark plinth at the end of the rows */
  const CX = -x0 + 4.6, CZ = 1.2;
  box(3.4, 0.16, 1.6, M.plinth, CX, 0.08, CZ);
  box(1.2, 2.3, 0.75, M.cabinet, CX - 0.68, 0.16 + 1.15, CZ);                     // battery
  box(1.0, 1.25, 0.32, M.cabinet, CX + 0.72, 0.16 + 1.4, CZ - 0.2);                // inverter
  const bar = box(0.06, 1.8, 0.02, M.bar, CX - 0.68, 0.16 + 1.15, CZ + 0.38, false);
  const barBase = bar.position.y - 0.9;
  box(0.5, 0.025, 0.02, M.led, CX + 0.72, 0.16 + 1.85, CZ - 0.03, false);
  const glowMat = new MeshBasicMaterial({ map: radialTexture('140,220,160'), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
  const glow = new Mesh(new PlaneGeometry(7, 4.2), glowMat); glow.rotation.x = -Math.PI / 2; glow.position.set(CX - 0.5, 0.02, CZ + 1.4); scene.add(glow);

  /* energy: a light line along the end of every row, gathering into the cabinet */
  const flows = [];
  const flowMat = (hex, freq) => new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { t: { value: 0 }, op: { value: 0 }, col: { value: new Color(hex) }, freq: { value: freq }, dir: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float t; uniform float op; uniform vec3 col; uniform float freq; uniform float dir; varying vec2 vUv;
      void main(){ float x = fract(vUv.x * freq - t * dir * 0.7); float pulse = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.08, 0.32, x));
        gl_FragColor = vec4(col * (0.7 + pulse * 2.8), (0.16 + pulse) * op); }`,
  });
  const gold = flowMat(0xf2b544, 3), green = flowMat(0x7bd389, 1.5);
  const endX = -x0 + 0.9;
  for (let r = 0; r < ROWS; r++) {
    const z = rowZ(r);
    const pts = [[endX - 2, 0.4, z + 0.95], [endX, 0.2, z + 1.1], [endX + 1.2, 0.12, lerp(z + 1.1, CZ, 0.6)], [CX + 0.3, 0.12, CZ - 0.45]];
    scene.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts.map((p) => new Vector3(...p))), 60, 0.04, 6, false), gold));
  }
  scene.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(CX + 0.4, 0.9, CZ - 0.2), new Vector3(CX, 0.5, CZ + 0.1), new Vector3(CX - 0.4, 0.6, CZ + 0.1)]), 30, 0.035, 6, false), green));
  flows.push(gold, green);

  /* camera path */
  const K = [
    { p: 0.0, pos: [x0 - 2.5, 1.9, 9.5], at: [x0 + 16, 1.1, 3.0] },                // low across the glass, into the sunrise
    { p: 0.18, pos: [x0 + 2, 5.5, 18], at: [x0 + 16, 0.5, 0] },
    { p: 0.38, pos: [-4, 30, 24], at: [0, 0, -1] },                                // high over the whole array at noon
    { p: 0.6, pos: [CX + 7, 9, 16], at: [CX - 4, 0.6, 0] },
    { p: 0.8, pos: [CX + 4.5, 2.3, 8.5], at: [CX - 1.2, 1.3, CZ] },                // the cabinet as the sun goes down
    { p: 1.0, pos: [CX - 9, 2.8, 12], at: [CX - 0.6, 1.2, CZ - 0.6] },                // night: the battery keeps going
  ];
  const posCurve = new CatmullRomCurve3(K.map((k) => new Vector3(...k.pos)), false, 'centripetal');
  const atCurve = new CatmullRomCurve3(K.map((k) => new Vector3(...k.at)), false, 'centripetal');
  const tAt = (p) => {
    for (let i = 0; i < K.length - 1; i++) if (p <= K[i + 1].p) return (i + ease((p - K[i].p) / (K[i + 1].p - K[i].p))) / (K.length - 1);
    return 1;
  };

  const C = (h) => new Color(h);
  const SKY = {
    night: { top: C(0x03071a), mid: C(0x0a1430), horizon: C(0x16264a), sun: C(0x000000) },
    dawn: { top: C(0x10204d), mid: C(0x585684), horizon: C(0xf3a05a), sun: C(0xffac58) },
    day: { top: C(0x2c62b5), mid: C(0x7cb0e3), horizon: C(0xdae7f2), sun: C(0xfff2d8) },
    dusk: { top: C(0x181d4b), mid: C(0x784c77), horizon: C(0xf08852), sun: C(0xff924c) },
  };

  let aspect = 1, state = { p: 0 };
  const dir = new Vector3();
  function set(p) {
    p = clamp(p, 0, 1);
    const h = hourAt(p), e = energyAt(h);
    const az = Math.PI * clamp((h - 6.05) / 12.1, 0, 1);                           // east (+x) → south (+z) → west (−x)
    const el = degToRad(h < 6.05 ? -1.5 + (h - 5.95) * 10 : h > 18.15 ? -3 - (h - 18.15) * 5 : Math.max(e.elev, 1.2));
    dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.8 + 0.1).normalize();
    sun.position.copy(dir).multiplyScalar(90); sun.target.position.set(0, 0, 0);
    const lightUp = smoothstep(e.elev, -1, 10);
    sun.intensity = 3.8 * lightUp;
    sun.color.copy(C(0xff9f55)).lerp(C(0xfff3e2), smoothstep(e.elev, 2, 28));
    const warm = h < 12.5 ? SKY.dawn : SKY.dusk;
    const toDay = smoothstep(e.elev, 4, 24), toNight = h > 18 ? smoothstep(h, 18.15, 19.3) : 0;
    const u = sky.material.uniforms;
    ['top', 'mid', 'horizon'].forEach((k) => { u[k].value.copy(warm[k]).lerp(SKY.day[k], toDay).lerp(SKY.night[k], toNight); });
    u.sunColor.value.copy(warm.sun).lerp(SKY.day.sun, toDay); u.sunDir.value.copy(dir); u.sunAmt.value = 1 - toNight;
    starMat.opacity = toNight * 0.9;
    scene.fog.color.copy(u.horizon.value).lerp(u.mid.value, 0.3);
    hemi.color.copy(u.mid.value).lerp(C(0xffffff), 0.3); hemi.intensity = lerp(0.12, 0.3, lightUp);
    moon.intensity = toNight * 0.4;
    const ef = lerp(0.3, 1, lightUp); ENV.forEach(([m, b]) => { m.envMapIntensity = b * ef; });
    renderer.toneMappingExposure = lerp(1.2, 0.95, lightUp);
    const solarOn = smoothstep(e.solar, 0.15, 0.8), evening = smoothstep(h, 18.0, 18.7);
    gold.uniforms.op.value = solarOn;
    green.uniforms.op.value = Math.max(h < 15 ? solarOn : 0, evening);
    green.uniforms.dir.value = h > 17 ? -1 : 1;
    M.led.emissiveIntensity = Math.max(solarOn, evening) * 2.5;
    const lvl = e.battery / 100;
    bar.scale.y = Math.max(lvl, 0.02); bar.position.y = barBase + 0.9 * bar.scale.y;
    M.bar.emissive.copy(C(0xf2b544)).lerp(C(0x7bd389), lvl); M.bar.emissiveIntensity = lerp(1.4, 3, toNight);
    glowMat.opacity = lerp(0.04, 0.5, toNight);
    const t = tAt(p);
    const pos = posCurve.getPoint(t), at = atCurve.getPoint(t);
    if (aspect < 1.1) { const k = lerp(1.0, 1.5, clamp((1.1 - aspect) / 0.6, 0, 1)); pos.sub(at).multiplyScalar(k).add(at); }
    camera.position.copy(pos); camera.lookAt(at);
    state = { p, hour: h, ...e };
    return state;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? 50 : aspect < 1.4 ? 42 : 34;
    camera.updateProjectionMatrix();
    set(state.p);
  }

  let raf = 0, running = false, last = 0, clock = 0;
  const minGap = mobile ? 1000 / 31 : 0;                                         // phones: 30 frames a second is plenty
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (now - last < minGap) return;
    clock += Math.min((now - last) / 1000, 0.05); last = now;
    flows.forEach((f) => { f.uniforms.t.value = clock; });
    renderer.render(scene, camera);
  };
  return {
    set, resize,
    render() { renderer.render(scene, camera); },
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    get state() { return state; },
  };
}
