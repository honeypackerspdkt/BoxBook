import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SIDE_CORNERS, type BoxSide, type Dims, type View } from '@honeypackers/box-core/box3d';

/**
 * The website's carton as a real 3D object (three.js), owner's choice 11 Nov 2026: the same box everywhere
 * (home hero, the box that follows you down the home page, promo / category / product tiles, product page, custom box).
 * A regular slotted carton: four walls, two short side flaps folded in first, two long flaps closed over them meeting
 * in the middle, brown tape along that join and down the short sides (and the same underneath). Clean kraft board,
 * no stains. Board, flutes and tape are drawn on canvases once (no image files); prints / customer artwork are
 * transparent pictures laid on the sides.
 *
 * Units: whatever the caller builds in (mm for products, CSS px for the hero). Axes as box-core's box3d:
 * x = length, y = height (up), z = width, front = +z.
 */

export const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
export const rnd = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export interface Palette {
  hi: string;
  base: string;
  lo: string;
  dark: string;
  ink: string;
  font: string;
}

/** Kraft board: base colour, soft blotches, paper grain and short fibres. Returns colour and relief canvases. */
function kraft(w: number, h: number, colour: string, p: Palette, seed: number, shade = 1): { map: HTMLCanvasElement; bump: HTMLCanvasElement } {
  const r = rnd(seed);
  const map = document.createElement('canvas');
  const bump = document.createElement('canvas');
  map.width = bump.width = w;
  map.height = bump.height = h;
  const c = map.getContext('2d')!;
  const b = bump.getContext('2d')!;
  c.fillStyle = colour;
  c.fillRect(0, 0, w, h);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, w, h);
  // blotches: uneven pulp
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, rad = (0.05 + r() * 0.2) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    const tone = r() > 0.5 ? p.hi : p.lo;
    g.addColorStop(0, tone);
    g.addColorStop(1, 'transparent');
    c.globalAlpha = 0.015 + r() * 0.02;
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fibres: short streaks, mostly along the machine direction
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = r() * w, y = r() * h, len = 4 + r() * 22, a = (r() - 0.5) * 0.5;
    const light = r() > 0.35;
    c.globalAlpha = 0.03 + r() * 0.05;
    c.strokeStyle = light ? p.hi : p.dark;
    c.lineWidth = 0.5 + r() * 0.9;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
    b.globalAlpha = 0.25;
    b.strokeStyle = light ? '#c8c8c8' : '#3a3a3a';
    b.lineWidth = c.lineWidth;
    b.beginPath();
    b.moveTo(x, y);
    b.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    b.stroke();
  }
  c.globalAlpha = 1;
  b.globalAlpha = 1;
  // grain
  const img = c.getImageData(0, 0, w, h);
  const bim = b.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 10;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] * shade + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * shade + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * shade + n * 0.8));
    const bn = bim.data[i] + (r() - 0.5) * 30;
    bim.data[i] = bim.data[i + 1] = bim.data[i + 2] = Math.max(0, Math.min(255, bn));
  }
  c.putImageData(img, 0, 0);
  b.putImageData(bim, 0, 0);
  // faint corrugation showing through the liner (flutes run across the panel)
  c.globalAlpha = 0.025;
  b.globalAlpha = 0.14;
  for (let x = 0; x < w; x += 9) {
    c.fillStyle = p.dark;
    c.fillRect(x, 0, 2, h);
    b.fillStyle = '#5a5a5a';
    b.fillRect(x, 0, 3, h);
  }
  c.globalAlpha = b.globalAlpha = 1;
  return { map, bump };
}

/** Cut edge of the board: two liners with the wavy fluting between them. */
function flutes(p: Palette): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 32;
  const c = cv.getContext('2d')!;
  c.fillStyle = p.lo;
  c.fillRect(0, 0, 64, 32);
  c.fillStyle = p.base;
  c.fillRect(0, 0, 64, 7);
  c.fillRect(0, 25, 64, 7);
  c.strokeStyle = p.hi;
  c.lineWidth = 4;
  c.beginPath();
  for (let x = 0; x <= 64; x++) c.lineTo(x, 16 + Math.sin((x / 64) * Math.PI * 4) * 9);
  c.stroke();
  return cv;
}


export function palette(): Palette {
  return {
    hi: css('--carton-hi', '#f2d4a6'),
    base: css('--carton', '#d2a06b'),
    lo: css('--carton-lo', '#a6703f'),
    dark: css('--carton-dark', '#865630'),
    ink: css('--carton-ink', '#5e3a20'),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif',
  };
}

export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Ink on a transparent picture (for a printed side): `draw` paints the shapes, then a few tiny specks are taken out so
 * it reads as flexo print on board rather than a sticker.
 */
export function printLayer(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, seed: number, alpha = 0.88): HTMLCanvasElement {
  const r = rnd(seed);
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const l = layer.getContext('2d')!;
  draw(l);
  l.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (w * h) / 220; i++) {
    l.globalAlpha = r() * 0.15;
    l.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const o = out.getContext('2d')!;
  o.globalAlpha = alpha;
  o.drawImage(layer, 0, 0);
  return out;
}

export function canvasTexture(cv: HTMLCanvasElement | HTMLImageElement): Texture {
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ───────── shared materials (made once per page) ───────── */

const TILE = 168; // one kraft texture tile covers this many units
interface Kit {
  board: { map: Texture; bump: Texture };
  inside: { map: Texture; bump: Texture };
  flute: Texture;
  plain: MeshStandardMaterial;
  seam: MeshStandardMaterial;
  tape: MeshPhysicalMaterial;
  cache: Map<string, Material>;
}
let kit: Kit | null = null;

function repeatTex(cv: HTMLCanvasElement, srgb: boolean): Texture {
  const t = new CanvasTexture(cv);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function getKit(): Kit {
  if (kit) return kit;
  const p = palette();
  const b = kraft(504, 504, p.base, p, 11, 0.9);
  const i = kraft(504, 504, p.lo, p, 16, 0.82);
  const tapeCv = document.createElement('canvas');
  tapeCv.width = 64;
  tapeCv.height = 256;
  {
    const c = tapeCv.getContext('2d')!;
    c.fillStyle = '#808080';
    c.fillRect(0, 0, 64, 256);
    const r = rnd(5);
    for (let n = 0; n < 40; n++) {
      c.fillStyle = r() > 0.5 ? '#9a9a9a' : '#6a6a6a';
      c.fillRect(r() * 64, 0, 1, 256);
    }
  }
  kit = {
    board: { map: repeatTex(b.map, true), bump: repeatTex(b.bump, false) },
    inside: { map: repeatTex(i.map, true), bump: repeatTex(i.bump, false) },
    flute: repeatTex(flutes(p), true),
    plain: new MeshStandardMaterial({ color: new Color(p.lo).lerp(new Color(p.base), 0.5), roughness: 0.95 }),
    seam: new MeshStandardMaterial({ color: new Color(p.dark).multiplyScalar(0.6), roughness: 1 }),
    tape: new MeshPhysicalMaterial({
      color: new Color(p.lo).lerp(new Color(p.dark), 0.7),
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      transparent: true,
      opacity: 0.92,
      bumpMap: repeatTex(tapeCv, false),
      bumpScale: 0.25,
      envMapIntensity: 1.1,
    }),
    cache: new Map(),
  };
  return kit;
}

/** Board material for a face of u × v units (outside or inside liner); textures are shared, only the repeat differs. */
function boardMat(kind: 'out' | 'in', u: number, v: number): Material {
  const k = getKit();
  const key = `${kind}:${(u / TILE).toFixed(2)}:${(v / TILE).toFixed(2)}`;
  let m = k.cache.get(key);
  if (!m) {
    const src = kind === 'out' ? k.board : k.inside;
    const map = src.map.clone();
    const bump = src.bump.clone();
    map.repeat.set(u / TILE, v / TILE);
    bump.repeat.copy(map.repeat);
    m = new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.6, roughness: kind === 'out' ? 0.86 : 0.95, metalness: 0, envMapIntensity: kind === 'out' ? 0.22 : 0.3 });
    k.cache.set(key, m);
  }
  return m;
}

/** Cut edge of the board (the fluting shows), `len` units long. */
function edgeMat(len: number): Material {
  const k = getKit();
  const key = `edge:${Math.round(len / 8)}`;
  let m = k.cache.get(key);
  if (!m) {
    const map = k.flute.clone();
    map.repeat.set(Math.max(1, Math.round(len / 8)), 1);
    m = new MeshStandardMaterial({ map, roughness: 0.95, envMapIntensity: 0.3 });
    k.cache.set(key, m);
  }
  return m;
}

/* ───────── the carton ───────── */

export interface Carton {
  group: Group;
  /** 0 = closed … 1 = open: the long flaps swing open first, then the side flaps. */
  setOpen(t: number): void;
  /** A picture per side (transparent where there is no print); a side left out has none. */
  setArt(art: Partial<Record<BoxSide, Texture>>): void;
  dispose(): void;
}

/** A closed carton `L` long (x), `H` high (y) and `Wd` wide (z), centred on the origin. */
export function buildCarton(L: number, H: number, Wd: number, opts: { tape?: boolean } = {}): Carton {
  const k = getKit();
  const tape = opts.tape ?? true;
  const diag = Math.hypot(L, H, Wd);
  const T = Math.min(6, Math.max(2, diag * 0.011)); // board thickness
  const P = k.plain;
  const out = (u: number, v: number) => boardMat('out', u, v);
  const inn = (u: number, v: number) => boardMat('in', u, v);
  const geos: BufferGeometry[] = [];
  const mesh = (geo: BufferGeometry, mat: Material | Material[], shadow = true) => {
    geos.push(geo);
    const m = new Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  };
  const g = new Group();
  // board panels with softly rounded edges (a fold, not a sharp seam)
  const panel = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.45);

  // walls (face order: +x, -x, +y, -y, +z, -z); every face you can see from outside is the kraft liner, so the
  // corners and the folds into the flaps blend; only the cut edges show the fluting
  const sw = Wd - 2 * T;
  const front = mesh(panel(L, H, T), [out(T, H), out(T, H), edgeMat(L), out(L, T), out(L, H), inn(L, H)]);
  front.position.set(0, 0, Wd / 2 - T / 2);
  const back = mesh(panel(L, H, T), [out(T, H), out(T, H), edgeMat(L), out(L, T), inn(L, H), out(L, H)]);
  back.position.set(0, 0, -Wd / 2 + T / 2);
  const right = mesh(panel(T, H - T, sw), [out(sw, H), inn(sw, H), edgeMat(sw), out(T, sw), P, P]);
  right.position.set(L / 2 - T / 2, -T / 2, 0);
  const left = mesh(panel(T, H - T, sw), [inn(sw, H), out(sw, H), edgeMat(sw), out(T, sw), P, P]);
  left.position.set(-L / 2 + T / 2, -T / 2, 0);
  const bottom = mesh(panel(L - 2 * T, T, sw), [P, P, inn(L, Wd), out(L, Wd), P, P]);
  bottom.position.set(0, -H / 2 + T / 2, 0);
  const seam = mesh(new BoxGeometry(L - 2 * T, 0.1, Math.max(0.6, T * 0.3)), k.seam, false);
  seam.position.set(0, -H / 2 - 0.05, 0);
  g.add(front, back, right, left, bottom, seam);

  // short side flaps on the side walls
  const md = Math.min(Wd / 2, L / 2 - T);
  const minor = (s: 1 | -1) => {
    const pv = new Group();
    pv.position.set((s * L) / 2, H / 2 - T / 2, 0);
    // the fold (outer end) is kraft like the side wall below it; the free end is a cut edge
    const m = mesh(panel(md, T, sw), s > 0 ? [out(T, sw), edgeMat(sw), out(md, sw), inn(md, sw), P, P] : [edgeMat(sw), out(T, sw), out(md, sw), inn(md, sw), P, P]);
    m.position.x = (-s * md) / 2;
    pv.add(m);
    g.add(pv);
    return pv;
  };
  const minorR = minor(1);
  const minorL = minor(-1);

  // long flaps on the front and back, meeting in the middle with a small gap; each carries half the tape
  const tapeW = Math.min(48, Wd * 0.3);
  const fd = Wd / 2 - T * 0.2;
  const major = (s: 1 | -1) => {
    const pv = new Group();
    pv.position.set(0, H / 2 + T / 2, (s * Wd) / 2);
    // the fold (outer side) is kraft like the wall below it; the ends and the middle edge are cut edges
    const m = mesh(panel(L, T, fd), [edgeMat(fd), edgeMat(fd), out(L, fd), inn(L, fd), s > 0 ? out(L, T) : edgeMat(L), s > 0 ? edgeMat(L) : out(L, T)]);
    m.position.z = (-s * fd) / 2;
    pv.add(m);
    if (tape) {
      const t = mesh(new BoxGeometry(L + 1, 0.5, tapeW / 2), k.tape, false);
      t.position.set(0, T / 2 + 0.45, -s * (fd - tapeW / 4));
      pv.add(t);
    }
    g.add(pv);
    return pv;
  };
  const flapB = major(1);
  const flapA = major(-1);

  if (tape) {
    const drop = Math.min(H * 0.3, 65);
    for (const s of [1, -1]) {
      const top = mesh(new BoxGeometry(0.5, drop, tapeW), k.tape, false);
      top.position.set(s * (L / 2 + 0.45), H / 2 + T - drop / 2, 0);
      const bot = mesh(new BoxGeometry(0.5, drop, tapeW), k.tape, false);
      bot.position.set(s * (L / 2 + 0.45), -H / 2 + drop / 2, 0);
      g.add(top, bot);
    }
    const under = mesh(new BoxGeometry(L + 1, 0.5, tapeW), k.tape, false);
    under.position.set(0, -H / 2 - 0.45, 0);
    g.add(under);
  }

  // prints: one quad per side, just above the board (under the tape)
  const decals = new Group();
  g.add(decals);
  let current: Partial<Record<BoxSide, Texture>> = {};
  const corner = (i: number, side: BoxSide) => {
    const v = [(i & 1 ? 1 : -1) * (L / 2), (i & 2 ? 1 : -1) * (H / 2), (i & 4 ? 1 : -1) * (Wd / 2)];
    if (side === 'top') v[1] = H / 2 + T + 0.1;
    if (side === 'bottom') v[1] = -H / 2 - 0.15;
    if (side === 'front') v[2] = Wd / 2 + 0.1;
    if (side === 'back') v[2] = -Wd / 2 - 0.1;
    if (side === 'right') v[0] = L / 2 + 0.1;
    if (side === 'left') v[0] = -L / 2 - 0.1;
    return v;
  };
  const setArt = (art: Partial<Record<BoxSide, Texture>>) => {
    const sides = Object.keys(SIDE_CORNERS) as BoxSide[];
    if (sides.every((s) => art[s] === current[s])) return;
    current = { ...art };
    for (const c of [...decals.children] as Mesh[]) {
      c.geometry.dispose();
      (c.material as Material).dispose();
      decals.remove(c);
    }
    for (const s of sides) {
      const tex = art[s];
      if (!tex) continue;
      const sc = SIDE_CORNERS[s];
      const tl = corner(sc.tl, s), tr = corner(sc.tr, s), bl = corner(sc.bl, s);
      const br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1], tr[2] + bl[2] - tl[2]];
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array([...tl, ...tr, ...bl, ...br]), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
      geo.setIndex([0, 2, 1, 2, 3, 1]);
      geo.computeVertexNormals();
      const m = new Mesh(
        geo,
        new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.75, metalness: 0, envMapIntensity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: DoubleSide }),
      );
      m.receiveShadow = true;
      decals.add(m);
    }
  };

  const ease = (v: number) => v * v * (3 - 2 * v);
  const setOpen = (t: number) => {
    t = Math.min(1, Math.max(0, t));
    const a = ease(Math.min(1, t / 0.6)) * ((115 * Math.PI) / 180);
    const b = ease(Math.min(1, Math.max(0, (t - 0.4) / 0.6))) * ((100 * Math.PI) / 180);
    flapA.rotation.x = -a;
    flapB.rotation.x = a;
    minorR.rotation.z = -b;
    minorL.rotation.z = b;
  };

  return {
    group: g,
    setOpen,
    setArt,
    dispose() {
      setArt({});
      for (const geo of geos) geo.dispose();
    },
  };
}

/* ───────── renderer, light ───────── */

export function makeRenderer(canvas: HTMLCanvasElement, preserve = false): WebGLRenderer {
  const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
  r.outputColorSpace = SRGBColorSpace;
  r.toneMapping = ACESFilmicToneMapping;
  r.toneMappingExposure = 0.82;
  r.shadowMap.enabled = true;
  r.shadowMap.type = PCFSoftShadowMap;
  return r;
}

/** Studio light: soft room reflections, a warm key light from the top left that casts the shadow, a weak fill. `s` = scene scale. */
export function lightScene(scene: Scene, renderer: WebGLRenderer, s: number) {
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();
  const key = new DirectionalLight(0xfff1de, 2.4);
  key.position.set(-0.68 * s, 1.23 * s, 1 * s);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -0.84 * s;
  key.shadow.camera.right = key.shadow.camera.top = 0.84 * s;
  key.shadow.camera.near = 0.16 * s;
  key.shadow.camera.far = 3.9 * s;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.004 * s;
  const fill = new DirectionalLight(0xffe0c4, 0.28);
  fill.position.set(0.97 * s, 0.19 * s, 0.65 * s);
  scene.add(key, fill, new HemisphereLight(0xfff8ef, 0x6b4426, 0.3));
}

export function shadowFloor(y: number, size: number, opacity = 0.1): Mesh {
  const floor = new Mesh(new PlaneGeometry(size, size), new ShadowMaterial({ opacity }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = true;
  return floor;
}

/* ───────── a carton in the site's 360 × 290 box picture (same camera as box-core's project()) ───────── */

const VB_W = 360;
const VB_H = 290;
const RADIUS = 96; // box-svg.ts: the bounding sphere's radius in the picture
const DIST = 6; // box-core: camera distance in sphere radii

class CartonStage {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera((2 * Math.atan(VB_H / 2 / RADIUS / DIST) * 180) / Math.PI, VB_W / VB_H, 0.5, 30);
  root = new Group();
  carton: Carton | null = null;
  dimsKey = '';
  floor = shadowFloor(-1.02, 12, 0.14);
  bounds = new Box3();

  constructor(canvas: HTMLCanvasElement, preserve = false) {
    this.renderer = makeRenderer(canvas, preserve);
    lightScene(this.scene, this.renderer, 2.2);
    this.camera.position.set(0, 0, DIST);
    this.scene.add(this.floor, this.root);
  }

  show(d: Dims, view: View, art: Partial<Record<BoxSide, Texture>> = {}) {
    const key = `${d.length}x${d.width}x${d.height}`;
    if (key !== this.dimsKey || !this.carton) {
      this.dimsKey = key;
      if (this.carton) {
        this.root.remove(this.carton.group);
        this.carton.dispose();
      }
      this.carton = buildCarton(d.length, d.height, d.width);
      this.root.add(this.carton.group);
      this.root.scale.setScalar(2 / (Math.hypot(d.length, d.width, d.height) || 1));
    }
    this.carton.setArt(art);
    // box-core: yaw about the vertical axis, then pitch (positive looks down on the top)
    this.root.rotation.set(view.pitch, view.yaw, 0, 'XYZ');
    // the floor sits just under the box's lowest corner, so its shadow touches the box from any angle
    this.root.updateMatrixWorld(true);
    this.floor.position.y = this.bounds.setFromObject(this.carton.group).min.y - 0.004;
    this.renderer.render(this.scene, this.camera);
  }
}

/* still pictures for tiles: one hidden renderer draws each box once */

let snapStage: CartonStage | null | undefined;
let queue: Promise<unknown> = Promise.resolve();
const snaps = new Map<string, Promise<string | null>>();

/** A picture (blob URL, 360 × 290 at 2×) of a closed carton of these inside sizes, or null without WebGL. */
export function snapshot(d: Dims, view: View): Promise<string | null> {
  const key = `${d.length}x${d.width}x${d.height}@${view.yaw.toFixed(3)},${view.pitch.toFixed(3)}`;
  let p = snaps.get(key);
  if (p) return p;
  p = queue.then(
    () =>
      new Promise<string | null>((done) => {
        if (snapStage === undefined) {
          if (!webglOk()) snapStage = null;
          else {
            const cv = document.createElement('canvas');
            snapStage = new CartonStage(cv, true);
            snapStage.renderer.setPixelRatio(1);
            snapStage.renderer.setSize(VB_W * 2, VB_H * 2, false);
          }
        }
        if (!snapStage) return done(null);
        snapStage.show(d, view);
        snapStage.renderer.domElement.toBlob((b) => done(b ? URL.createObjectURL(b) : null), 'image/webp', 0.92);
      }),
  );
  queue = p.catch(() => null);
  snaps.set(key, p);
  return p;
}

/* a live carton behind a box picture's SVG (which keeps the size labels and takes the drag) */

export interface LiveCarton {
  set(d: Dims, view: View, art?: Partial<Record<BoxSide, string>>): void;
  /** Frees the WebGL context and removes the canvas (when the screen closes). */
  dispose(): void;
}

export function mountLive(svg: SVGSVGElement): LiveCarton | null {
  if (!webglOk()) return null;
  const host = svg.parentElement;
  if (!host) return null;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'bx-gl';
  Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '0' });
  host.insertBefore(canvas, svg);
  svg.style.position = 'relative';
  svg.style.zIndex = '1';
  const stage = new CartonStage(canvas);
  stage.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const loader = new TextureLoader();
  const textures = new Map<string, Texture>();
  let last: [Dims, View, Partial<Record<BoxSide, string>>] | null = null;

  const draw = () => {
    if (!last) return;
    const [d, view, urls] = last;
    const art: Partial<Record<BoxSide, Texture>> = {};
    for (const [side, url] of Object.entries(urls) as [BoxSide, string][]) {
      if (!url) continue;
      let t = textures.get(url);
      if (!t) {
        t = loader.load(url, () => draw());
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 8;
        textures.set(url, t);
      }
      if (t.image) art[side] = t;
    }
    // forget pictures no longer used
    const keep = new Set(Object.values(urls));
    for (const [url, t] of textures) {
      if (keep.has(url)) continue;
      t.dispose();
      textures.delete(url);
    }
    stage.show(d, view, art);
  };

  const fit = () => {
    const hr = host.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    if (!sr.width) return;
    // the SVG keeps its 360:290 picture centred (preserveAspectRatio meet)
    const s = Math.min(sr.width / VB_W, sr.height / VB_H);
    const w = VB_W * s, h = VB_H * s;
    Object.assign(canvas.style, {
      left: `${sr.left - hr.left - host.clientLeft + (sr.width - w) / 2}px`,
      top: `${sr.top - hr.top - host.clientTop + (sr.height - h) / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    stage.renderer.setSize(Math.round(w), Math.round(h), false);
    draw();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(svg);
  fit();

  return {
    set(d, view, art = {}) {
      last = [d, view, art];
      draw();
    },
    dispose() {
      ro.disconnect();
      last = null;
      for (const t of textures.values()) t.dispose();
      stage.carton?.dispose();
      stage.renderer.dispose();
      stage.renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
