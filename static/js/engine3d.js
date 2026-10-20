/* 3D-движок: процедурные модели корпуса и деталей на Three.js (r128). */
(function(){
'use strict';
const VS = window.VS = window.VS || {};

VS.createEngine = function(ctx){
  const {$, S, reduceMotion, build, evaluate, render, toast, esc, CAT_NAME} = ctx;
  const onInspect = ctx.onInspect || (() => {});
  const T = window.THREE;
  if (!T || !T.OrbitControls || !T.RoundedBoxGeometry) throw new Error('lib');
  const stage = $('#stage'), canvas = $('#scene');
  const small = matchMedia('(max-width: 960px)').matches;

  const renderer = new T.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new T.Scene();
  // мягкая «студия»: градиент + несколько софтбоксов умеренной яркости
  const envScene = new T.Scene();
  { const g = new T.SphereGeometry(50, 32, 16), col = [], p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = (p.getY(i)/50 + 1)/2, v = 0.03 + 0.32*Math.pow(k, 1.8); col.push(v, v*1.02, v*1.06); }
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    envScene.add(new T.Mesh(g, new T.MeshBasicMaterial({side:T.BackSide, vertexColors:true})));
    const box = (w, h, x, y, z, k) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({color:new T.Color(k, k, k), side:T.DoubleSide})); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
    box(30, 20, 34, 26, -26, 3.2);
    box(10, 40, -38, 8, 28, 0.7);
    box(36, 8, 0, 44, 0, 1.0);
    box(20, 14, 10, 4, -44, 1.6); }
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  pm.dispose();

  const camera = new T.PerspectiveCamera(30, 1, 1, 3000);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 22; controls.maxDistance = 320;
  const POLAR_MAX = Math.PI * 0.64;
  controls.minPolarAngle = 0.12; controls.maxPolarAngle = POLAR_MAX;
  controls.autoRotate = S.spin; controls.autoRotateSpeed = 0.6; controls.rotateSpeed = 0.7;

  scene.add(new T.HemisphereLight(0xffffff, 0x6a7488, 0.42));
  const key = new T.DirectionalLight(0xffffff, 1.45);
  key.position.set(60, 95, -45); key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  Object.assign(key.shadow.camera, {near:20, far:260, left:-46, right:46, top:46, bottom:-46});
  scene.add(key, key.target);
  const rim = new T.DirectionalLight(0xdfe8ff, 0.5); rim.position.set(-70, 35, 60); scene.add(rim);
  const glowA = new T.PointLight(0xff7a2f, 0, 45, 2), glowB = new T.PointLight(0xff7a2f, 0, 45, 2);
  const fillIn = new T.PointLight(0xfff4e8, 0.55, 70, 2);
  scene.add(glowA, glowB, fillIn);

  const lin = h => new T.Color(h).convertSRGBToLinear();
  function mkMat(o){
    const p = Object.assign({roughness:0.5, metalness:0.1}, o);
    if (p.envMapIntensity == null) p.envMapIntensity = p.metalness >= 0.8 ? 1.25 : 0.45;
    for (const k of ['color','emissive']) if (typeof p[k] === 'number') p[k] = lin(p[k]);
    return new T.MeshStandardMaterial(p);
  }
  let bag = [];
  const mat = o => { const m = mkMat(o); bag.push(m); return m; };
  function ctex(w, h, draw, o = {}){
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = o.linear ? T.LinearEncoding : T.sRGBEncoding;
    t.anisotropy = ANISO;
    if (o.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    if (!o.keep) bag.push(t);
    return t;
  }
  function rep(tex, rx, ry){ const t = tex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); bag.push(t); return t; }
  const hex6 = n => '#' + n.toString(16).padStart(6, '0');

  /* геометрия: кэш на всю сессию */
  const GC = new Map();
  const geo = (k, make) => { let g = GC.get(k); if (!g) { g = make(); GC.set(k, g); } return g; };
  const f2 = v => (+v).toFixed(2);
  const boxG = (w, h, d) => geo(`b${f2(w)},${f2(h)},${f2(d)}`, () => new T.BoxGeometry(w, h, d));
  const rboxG = (w, h, d, r) => geo(`r${f2(w)},${f2(h)},${f2(d)},${f2(r)}`, () => new T.RoundedBoxGeometry(w, h, d, 2, Math.max(0.005, Math.min(r, w/2 - 0.004, h/2 - 0.004, d/2 - 0.004))));
  const cylG = (r1, r2, h, s) => geo(`c${f2(r1)},${f2(r2)},${f2(h)},${s}`, () => new T.CylinderGeometry(r1, r2, h, s));
  const planeG = (w, h) => geo(`p${f2(w)},${f2(h)}`, () => new T.PlaneGeometry(w, h));
  const torusG = (r, tb, s) => geo(`t${f2(r)},${f2(tb)},${s}`, () => new T.TorusGeometry(r, tb, 8, s));

  function mesh(g, m, x, y, z, parent){ const me = new T.Mesh(g, m); me.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(me); return me; }
  const box = (w, h, d, m, x, y, z, p) => mesh(boxG(w, h, d), m, x, y, z, p);
  const rbox = (w, h, d, r, m, x, y, z, p) => mesh(rboxG(w, h, d, r), m, x, y, z, p);
  function cyl(r, h, m, axis, x, y, z, p, seg, r2){
    const me = mesh(cylG(r, r2 == null ? r : r2, h, seg || 20), m, x, y, z, p);
    if (axis === 'x') me.rotation.z = -Math.PI/2; else if (axis === 'z') me.rotation.x = Math.PI/2;
    return me;
  }
  function plane(w, h, m, face, x, y, z, p){
    const me = mesh(planeG(w, h), m, x, y, z, p);
    if (face === '+x') me.rotation.y = Math.PI/2;
    else if (face === '-x') me.rotation.y = -Math.PI/2;
    else if (face === '+y') me.rotation.x = -Math.PI/2;
    else if (face === '-y') me.rotation.x = Math.PI/2;
    else if (face === '-z') me.rotation.y = Math.PI;
    return me;
  }
  function own(g){ bag.push(g); return g; }
  function mergeG(list){
    let vc = 0, ic = 0;
    for (const g of list) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(vc*3), nor = new Float32Array(vc*3), uv = new Float32Array(vc*2), idx = new Uint32Array(ic);
    let vo = 0, io = 0;
    for (const g of list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo*3); nor.set(g.attributes.normal.array, vo*3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, vo*2);
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
      else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
      vo += n; g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.setIndex(new T.BufferAttribute(idx, 1));
    return own(out);
  }
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const curve = pts => new T.CatmullRomCurve3(pts, false, 'centripetal');
  const tubeG = (pts, r, seg, rs) => new T.TubeGeometry(curve(pts), seg || 48, r, rs || 8, false);
  function inst(g, m, n, fn, parent){
    const im = new T.InstancedMesh(g, m, n), d = new T.Object3D();
    for (let i = 0; i < n; i++) { d.position.set(0,0,0); d.rotation.set(0,0,0); d.scale.set(1,1,1); fn(d, i); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; parent.add(im); return im;
  }
  function roundRect(s, x, y, w, h, r){
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
  }
  const rectPath = (x0, y0, x1, y1) => { const p = new T.Path(); p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0); return p; };
  const circPath = (cx, cy, r) => { const p = new T.Path(); p.absarc(cx, cy, r, 0, Math.PI*2, true); return p; };

  /* постоянные текстуры */
  const PERF = {};
  PERF.round = ctex(64, 64, (x) => { x.fillStyle = '#fff'; x.fillRect(0,0,64,64); x.fillStyle = '#000'; for (const [a,b] of [[0,0],[64,0],[0,64],[64,64],[32,32]]) { x.beginPath(); x.arc(a, b, 17, 0, 7); x.fill(); } }, {linear:true, keep:true});
  PERF.fine = PERF.round;
  PERF.hex = ctex(64, 111, (x) => {
    x.fillStyle = '#fff'; x.fillRect(0,0,64,111); x.fillStyle = '#000';
    const hx = (cx, cy, r) => { x.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI/6 + i*Math.PI/3; x.lineTo(cx + r*Math.cos(a), cy + r*Math.sin(a)); } x.closePath(); x.fill(); };
    for (const [a,b] of [[0,0],[64,0],[32,55.5],[0,111],[64,111]]) hx(a, b, 26);
  }, {linear:true, keep:true});
  PERF.slot = ctex(64, 32, (x) => { x.fillStyle = '#fff'; x.fillRect(0,0,64,32); x.fillStyle = '#000'; x.beginPath(); roundRect(x, 5, 9, 54, 14, 7); x.fill(); }, {linear:true, keep:true});
  PERF.vent = ctex(64, 16, (x) => { x.fillStyle = '#fff'; x.fillRect(0,0,64,16); x.fillStyle = '#000'; x.fillRect(4, 5, 56, 6); }, {linear:true, keep:true});
  const PITCH = {round:0.55, fine:0.36, hex:0.62, slot:1.5, vent:1};
  const braidTex = ctex(32, 32, (x) => {
    x.fillStyle = '#2a2b2f'; x.fillRect(0,0,32,32); x.strokeStyle = '#0d0e10'; x.lineWidth = 3;
    for (let i = -32; i < 64; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 32, 32); x.stroke(); x.beginPath(); x.moveTo(i + 32, 0); x.lineTo(i, 32); x.stroke(); }
  }, {keep:true, repeat:[1,1]});
  const hubTex = ctex(128, 128, (x) => {
    x.fillStyle = '#1b1c20'; x.fillRect(0,0,128,128);
    x.strokeStyle = '#3a3c42'; x.lineWidth = 3; x.beginPath(); x.arc(64, 64, 52, 0, 7); x.stroke();
    x.strokeStyle = '#2b2d32'; x.lineWidth = 2; x.beginPath(); x.arc(64, 64, 30, 0, 7); x.stroke();
    x.fillStyle = '#34363b'; x.beginPath(); x.arc(64, 64, 10, 0, 7); x.fill();
  }, {keep:true});
  const radTex = ctex(64, 64, (x) => {
    x.fillStyle = '#1e2023'; x.fillRect(0,0,64,64);
    for (let i = 0; i < 64; i += 4) { x.fillStyle = i % 8 ? '#2d3034' : '#141518'; x.fillRect(0, i, 64, 2); }
    x.fillStyle = '#0c0d0f'; x.fillRect(0, 0, 3, 64); x.fillRect(32, 0, 3, 64);
  }, {keep:true});
  const ventDecal = ctex(64, 32, (x) => { x.clearRect(0,0,64,32); x.fillStyle = 'rgba(0,0,0,.85)'; x.beginPath(); roundRect(x, 6, 10, 52, 12, 6); x.fill(); }, {keep:true});

  const PM = {
    plastic: mkMat({color:0x18191c, roughness:0.55, metalness:0.05}),
    blade: mkMat({color:0x1f2024, roughness:0.45, metalness:0.05, side:T.DoubleSide}),
    white: mkMat({color:0xeeeeec, roughness:0.55}),
    whiteBlade: mkMat({color:0xe9eaec, roughness:0.45, side:T.DoubleSide}),
    grey: mkMat({color:0x8b9097, roughness:0.55}),
    rubber: mkMat({color:0x101113, roughness:0.95}),
    hole: mkMat({color:0x050506, roughness:1}),
    alu: mkMat({color:0xc8ccd1, roughness:0.28, metalness:0.95}),
    fin: mkMat({color:0xd3d6da, roughness:0.3, metalness:0.95, side:T.DoubleSide}),
    finDark: mkMat({color:0x34373c, roughness:0.4, metalness:0.85, side:T.DoubleSide}),
    nickel: mkMat({color:0xdcdee1, roughness:0.16, metalness:1}),
    copper: mkMat({color:0xcf8a5a, roughness:0.22, metalness:1}),
    gold: mkMat({color:0xe0b84a, roughness:0.25, metalness:1}),
    steel: mkMat({color:0xa3a8ae, roughness:0.35, metalness:0.9}),
    chip: mkMat({color:0x0e0f11, roughness:0.4, metalness:0.15}),
    choke: mkMat({color:0x4f5359, roughness:0.45, metalness:0.7}),
    capAlu: mkMat({color:0x9a9fa6, roughness:0.3, metalness:0.9}),
    capGold: mkMat({color:0xc9a43a, roughness:0.35, metalness:0.7}),
    usb: mkMat({color:0x2459d6, roughness:0.5}),
    led: mkMat({color:0xffffff, emissive:0xffffff, emissiveIntensity:1.4}),
    frit: mkMat({color:0x070708, roughness:0.15, metalness:0.2}),
    glass: mkMat({color:0xc4d2de, roughness:0.05, metalness:0, transparent:true, opacity:0.07, envMapIntensity:0.6, depthWrite:false, side:T.FrontSide}),
    rgb: new T.MeshBasicMaterial({color:lin(0xff7a2f), toneMapped:false}),
    diff: mkMat({color:0xffffff, emissive:0xff7a2f, emissiveIntensity:2.6, roughness:0.6}),
    rgbBlade: mkMat({color:0xf2f4f6, emissive:0xff7a2f, emissiveIntensity:1.0, roughness:0.4, transparent:true, opacity:0.62, side:T.DoubleSide, depthWrite:false}),
    hubCap: mkMat({color:0xffffff, map:hubTex, roughness:0.5}),
    rad: mkMat({color:0xffffff, map:radTex, roughness:0.6, metalness:0.4}),
    decal: mkMat({color:0xffffff, map:ventDecal, transparent:true, roughness:0.8, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2}),
  };
  const glassEdge = new T.LineBasicMaterial({color:lin(0x9aa6b4), transparent:true, opacity:0.4});
  const perfMat = (pattern, color, w, h) => mat({color, roughness:0.5, metalness:0.4, alphaMap:rep(PERF[pattern], w/PITCH[pattern], h/PITCH[pattern]), alphaTest:0.5, side:T.DoubleSide});
  function sleeveMat(len){ return mat({color:0x1c1d20, roughness:0.72, map:rep(braidTex, Math.max(4, Math.round(len*2.2)), 1)}); }

  /* вентилятор */
  const spinners = [];
  const frameG = s => geo('ff' + s, () => {
    const h = s/2, sh = roundRect(new T.Shape(), -h, -h, s, s, s*0.09);
    sh.holes.push(circPath(0, 0, s*0.47));
    for (const [a, b] of [[1,1],[-1,1],[-1,-1],[1,-1]]) sh.holes.push(circPath(a*(h - s*0.075), b*(h - s*0.075), s*0.024));
    const g = new T.ExtrudeGeometry(sh, {depth:2.4, bevelEnabled:true, bevelThickness:0.05, bevelSize:0.05, bevelSegments:1, curveSegments:32});
    g.translate(0, 0, -1.2); return g;
  });
  const bladeG = (s, n) => geo(`bl${s},${n}`, () => {
    const r0 = s*0.165, r1 = s*0.455, sweep = 0.5, N = 14;
    const w = t => (Math.PI*2/n)*0.8*(0.82 + 0.32*t), fL = t => sweep*Math.pow(t, 1.25);
    const pts = [];
    for (let i = 0; i <= N; i++) { const t = i/N, r = r0 + (r1 - r0)*t, a = fL(t); pts.push(new T.Vector2(r*Math.cos(a), r*Math.sin(a))); }
    for (let i = 1; i <= 4; i++) { const a = fL(1) - w(1)*i/4; pts.push(new T.Vector2(r1*Math.cos(a), r1*Math.sin(a))); }
    for (let i = N - 1; i >= 0; i--) { const t = i/N, r = r0 + (r1 - r0)*t, a = fL(t) - w(t); pts.push(new T.Vector2(r*Math.cos(a), r*Math.sin(a))); }
    for (let i = 3; i >= 1; i--) { const a = -w(0)*i/4; pts.push(new T.Vector2(r0*Math.cos(a), r0*Math.sin(a))); }
    const g = new T.ShapeGeometry(new T.Shape(pts), 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y), t = Math.min(1, Math.max(0, (r - r0)/(r1 - r0)));
      const c = (Math.atan2(y, x) - (fL(t) - w(t)/2)) * r;
      p.setZ(i, -c * Math.tan(0.78 - 0.32*t) * 0.5);
    }
    g.computeVertexNormals(); return g;
  });
  function makeFan(s, o = {}){
    const g = new T.Group(), n = o.n || (s >= 14 ? 9 : 7), fm = o.frame || PM.plastic;
    if (!o.frameless) {
      mesh(frameG(s), fm, 0, 0, 0, g);
      const r0 = s*0.165, r1 = s*0.47, L = r1 - r0;
      for (let i = 0; i < 4; i++) { const a = Math.PI/4 + i*Math.PI/2; const st = box(L, 0.3, 0.3, fm, Math.cos(a)*(r0 + L/2), Math.sin(a)*(r0 + L/2), -1.05, g); st.rotation.z = a; }
      if (o.pads) for (const [a, b] of [[1,1],[-1,1],[-1,-1],[1,-1]]) for (const z of [1.27, -1.27]) rbox(s*0.15, s*0.15, 0.16, 0.05, PM.rubber, a*(s/2 - s*0.075), b*(s/2 - s*0.075), z, g);
      if (o.rgb) for (const z of [1.3, -1.3]) mesh(torusG(s*0.468, 0.2, 56), PM.diff, 0, 0, z, g);
    }
    const rot = new T.Group(); g.add(rot);
    const hr = s*0.165;
    cyl(hr, 1.9, o.hub || o.blade || PM.blade, 'z', 0, 0, 0, rot, 28);
    mesh(geo('cap' + f2(hr), () => new T.CircleGeometry(hr*0.93, 28)), PM.hubCap, 0, 0, 0.96, rot);
    inst(bladeG(s, n), o.rgb ? PM.rgbBlade : (o.blade || PM.blade), n, (d, i) => { d.rotation.z = i/n*Math.PI*2; }, rot);
    if (o.rim) mesh(torusG(s*0.458, 0.08, 56), o.blade || PM.blade, 0, 0, 0, rot);
    spinners.push({obj:rot, speed:(o.speed || 1) * (0.85 + Math.random()*0.3)});
    return g;
  }
  function orient(g, axis){ if (axis === 'y') g.rotation.x = -Math.PI/2; else if (axis === '-y') g.rotation.x = Math.PI/2; else if (axis === 'x') g.rotation.y = Math.PI/2; return g; }

  /* сцена */
  const shadowMat = new T.ShadowMaterial({opacity:0.22});
  const ground = new T.Mesh(new T.PlaneGeometry(400, 400), shadowMat);
  ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);
  const blobTex = ctex(256, 256, (x) => { const gr = x.createRadialGradient(128,128,8,128,128,128); gr.addColorStop(0,'rgba(0,0,0,.42)'); gr.addColorStop(.5,'rgba(0,0,0,.14)'); gr.addColorStop(1,'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0,0,256,256); }, {keep:true});
  const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({map:blobTex, transparent:true, depthWrite:false}));
  blob.rotation.x = -Math.PI/2; scene.add(blob);
  const root = new T.Group(); scene.add(root);

  let explodables = [], pickables = [], groups = {}, hideOnExplode = [], fitDist = 120, fitting = false, explodeK = 0;
  let glassGroup = null, lastIssues = [], lastCase = null;
  let anchors = {};  // категория -> точки для режима «Осмотр»: {name, desc, val, group, local, inside}
  function anc(cat, group, x, y, z, name, desc, o = {}){ (anchors[cat] = anchors[cat] || []).push(Object.assign({cat, group, local:V(x, y, z), name, desc}, o)); }

  function reg(group, cat, ex, opts = {}){
    group.userData.cat = cat; group.userData.base = group.position.clone(); group.userData.ex = ex || V(0,0,0); group.userData.hide = !!opts.hide;
    explodables.push(group); root.add(group);
    if (opts.hide) hideOnExplode.push(group);
    if (cat) { (groups[cat] = groups[cat] || []).push(group); group.traverse(o => { if (o.isMesh) pickables.push(o); }); }
    return group;
  }
  function disposeAll(){
    for (const m of bag) m.dispose && m.dispose();
    bag = []; spinners.length = 0; explodables = []; pickables = []; groups = {}; hideOnExplode = []; anchors = {};
    while (root.children.length) root.remove(root.children[0]);
  }

  /* текстуры деталей */
  function pcbTexture(mb, bh, bw, L){
    const S = 36, Wp = Math.round(bw*S), Hp = Math.round(bh*S);
    return ctex(Wp, Hp, (x) => {
      x.fillStyle = hex6(mb.pcb); x.fillRect(0, 0, Wp, Hp);
      let seed = [...mb.id].reduce((a, c) => (a*31 + c.charCodeAt(0)) >>> 0, 7);
      const rnd = () => (seed = (seed*1664525 + 1013904223) >>> 0) / 4294967296;
      x.strokeStyle = 'rgba(255,255,255,0.05)'; x.lineWidth = 1.3;
      for (let i = 0; i < 320; i++) { let px = rnd()*Wp, py = rnd()*Hp; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 4; k++) { if (rnd() < 0.5) px += (rnd() - 0.5)*180; else py += (rnd() - 0.5)*180; x.lineTo(px, py); } x.stroke(); }
      x.fillStyle = 'rgba(255,255,255,0.07)'; for (let i = 0; i < 700; i++) { x.beginPath(); x.arc(rnd()*Wp, rnd()*Hp, 1.4, 0, 7); x.fill(); }
      const X = r => r*S, Y = t => t*S;
      x.strokeStyle = 'rgba(235,238,242,0.35)'; x.lineWidth = 1.5;
      x.strokeRect(X(L.sockRear - 3.3), Y(L.sockTop - 3.3), 6.6*S, 6.6*S);
      x.fillStyle = 'rgba(235,238,242,0.62)'; x.font = `600 ${Math.round(S*0.3)}px monospace`;
      const t = (s, r, tp) => x.fillText(s, X(r), Y(tp));
      const dd = mb.ram;
      const names = mb.slots === 4 ? ['A1','A2','B1','B2'] : ['A','B'];
      names.forEach((n, i) => { x.save(); x.translate(X(L.ramRear + i*0.85 + 0.15), Y(L.ramTop + 14.0)); x.rotate(-Math.PI/2); x.fillText(`${dd}_${n}`, 0, 0); x.restore(); });
      t('CPU_FAN', L.sockRear - 1.5, L.sockTop - 4.4);
      t('CPU_PWR1', 1.4, 1.9);
      t('PCIEX16_1', 10.5, L.pcieTop + 1.2);
      t('M2_1', L.m2Rear + 4.4, L.m2Top - 1.4);
      t('ATX_PWR', bw - 2.6, bh*0.33 - 3.2);
      if (bh > 20) { t('SATA', bw - 2.6, bh - 4.6); t('F_PANEL', bw - 5.5, bh - 0.5); t('USB3_1', bw - 9.5, bh - 0.5); t('SYS_FAN1', 6.5, bh - 0.5); t('AUDIO', 1.0, bh - 0.5); t('BIOS', bw*0.5, bh - 7.4); }
      const holes = bh > 20
        ? [[0.9,1.4],[0.9,bw*0.62],[0.9,bw - 0.7],[bh*0.48,1.4],[bh*0.48,bw*0.62],[bh*0.48,bw - 0.7],[bh - 0.9,1.4],[bh - 0.9,bw*0.62],[bh - 0.9,bw - 0.7]]
        : [[0.9,1.0],[0.9,bw - 0.7],[bh - 0.9,1.0],[bh - 0.9,bw - 0.7]];
      for (const [tp, rr] of holes) { x.fillStyle = '#bfc4cb'; x.beginPath(); x.arc(X(rr), Y(tp), S*0.36, 0, 7); x.fill(); x.fillStyle = '#26282c'; x.beginPath(); x.arc(X(rr), Y(tp), S*0.18, 0, 7); x.fill(); }
    });
  }
  function ihsTexture(cpu){
    return ctex(256, 256, (x) => {
      const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, '#d9dce0'); g.addColorStop(0.5, '#c4c8cd'); g.addColorStop(1, '#d6d9dd');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      x.fillStyle = 'rgba(40,44,50,0.55)'; x.font = '600 18px monospace'; x.textAlign = 'center';
      x.fillText(`${cpu.cores}C / ${cpu.threads}T`, 128, 112);
      x.font = '500 13px monospace'; x.fillText(cpu.socket, 128, 136); x.fillText('2445  SAMPLE', 128, 156);
      x.font = '600 14px monospace'; x.fillText(cpu.name.replace(/^(AMD|Intel) /, ''), 128, 88);
    });
  }
  function labelTexture(lines, w, h, o = {}){
    return ctex(w, h, (x) => {
      x.fillStyle = o.bg || '#f2f3f4'; x.fillRect(0, 0, w, h);
      if (o.band) { x.fillStyle = o.band; x.fillRect(0, 0, w, h*0.18); }
      x.fillStyle = o.fg || '#15171a'; x.textBaseline = 'middle';
      lines.forEach(([txt, size, yy, align, weight]) => { x.font = `${weight || 600} ${size}px Arial, Helvetica, sans-serif`; x.textAlign = align || 'left'; x.fillText(txt, align === 'center' ? w/2 : w*0.06, yy); });
      if (o.grid) { x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1.5; const [gx, gy, gw, gh, cols, rows] = o.grid; x.strokeRect(gx, gy, gw, gh); for (let i = 1; i < cols; i++) { x.beginPath(); x.moveTo(gx + gw*i/cols, gy); x.lineTo(gx + gw*i/cols, gy + gh); x.stroke(); } for (let i = 1; i < rows; i++) { x.beginPath(); x.moveTo(gx, gy + gh*i/rows); x.lineTo(gx + gw, gy + gh*i/rows); x.stroke(); } }
    });
  }
  function ioTexture(hcm){
    const S = 40, w = 4.4*S, h = Math.round(hcm*S);
    return ctex(w, h, (x) => {
      x.fillStyle = '#2b2e33'; x.fillRect(0, 0, w, h);
      let y = 12;
      const port = (pw, ph, col, inner) => { x.fillStyle = '#0b0c0e'; x.fillRect((w - pw)/2, y, pw, ph); if (col) { x.fillStyle = col; x.fillRect((w - pw)/2 + 6, y + ph*0.35, pw - 12, ph*0.3); } if (inner) inner((w - pw)/2, y, pw, ph); y += ph + 9; };
      port(70, 30, null, (px, py, pw, ph) => { x.fillStyle = '#d9a32a'; x.fillRect(px + 8, py + 8, 10, 14); x.fillStyle = '#ffffff'; x.fillRect(px + pw - 18, py + 8, 10, 14); });
      for (let i = 0; i < 4; i++) port(60, 22, i < 2 ? '#2459d6' : '#c8212f');
      for (let i = 0; i < 2; i++) port(60, 22, '#1b1c1f');
      port(64, 54, null, (px, py) => { x.fillStyle = '#d9a32a'; x.fillRect(px + 10, py + 6, 44, 6); });
      for (let i = 0; i < 2; i++) port(60, 22, '#2459d6');
      port(48, 22, null);
      ['#62b94a','#3a8bd6','#e07ab0','#222','#e8b33a','#888'].forEach((c, i) => { const cx = w/2 + (i % 2 ? 16 : -16), cy = y + 14 + Math.floor(i/2)*30; x.fillStyle = c; x.beginPath(); x.arc(cx, cy, 11, 0, 7); x.fill(); x.fillStyle = '#0b0c0e'; x.beginPath(); x.arc(cx, cy, 5, 0, 7); x.fill(); });
      [[40, h - 34], [w - 40, h - 34]].forEach(([cx, cy]) => { x.fillStyle = '#c9a43a'; x.beginPath(); x.arc(cx, cy, 13, 0, 7); x.fill(); x.fillStyle = '#4a3a10'; x.beginPath(); x.arc(cx, cy, 5, 0, 7); x.fill(); });
    });
  }
  function gpuIoTexture(wcm, hcm){
    const S = 40, w = Math.round(wcm*S), h = Math.round(hcm*S);
    return ctex(w, h, (x) => {
      x.fillStyle = '#6d7279'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1a1b1e';
      for (let i = 0; i < 4; i++) { const px = 30 + i*58, py = h*0.62 - 14; if (i === 3) { x.beginPath(); x.moveTo(px, py); x.lineTo(px + 46, py); x.lineTo(px + 46, py + 20); x.lineTo(px + 40, py + 26); x.lineTo(px + 6, py + 26); x.lineTo(px, py + 20); x.closePath(); x.fill(); } else { x.beginPath(); x.moveTo(px, py); x.lineTo(px + 44, py); x.lineTo(px + 44, py + 26); x.lineTo(px + 8, py + 26); x.lineTo(px, py + 18); x.closePath(); x.fill(); } }
      for (let cx = 290; cx < w - 20; cx += 16) for (let cy = 14; cy < h - 10; cy += 14) { x.beginPath(); x.arc(cx + ((cy/14) % 2 ? 8 : 0), cy, 5, 0, 7); x.fill(); }
    });
  }
  function psuTextures(psu){
    const label = labelTexture([
      ['POWER SUPPLY', 26, 30, 'left', 700],
      [`${psu.watt} W`, 54, 92, 'left', 700],
      ['AC INPUT 100–240V~ 10A 50/60Hz', 15, 150, 'left', 500],
      ['DC OUTPUT   +3.3V   +5V   +12V   −12V   +5Vsb', 14, 186, 'left', 600],
      [`MAX LOAD    20A     20A   ${(psu.watt/12).toFixed(1)}A  0.3A  3A`, 14, 214, 'left', 500],
      [psu.cert.replace('80+ ', '').toUpperCase() + ' · 80 PLUS', 16, 272, 'left', 700],
    ], 560, 300, {bg:'#e9eaec', grid:[30, 168, 500, 64, 5, 2]});
    const rear = ctex(240, 140, (x) => {
      x.fillStyle = '#1b1c1f'; x.fillRect(0, 0, 240, 140); x.fillStyle = '#050506';
      for (let cy = 10; cy < 132; cy += 11) for (let cx = 12; cx < 150; cx += 12) { x.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI/6 + i*Math.PI/3; x.lineTo(cx + ((cy - 10)/11 % 2 ? 6 : 0) + 5*Math.cos(a), cy + 5*Math.sin(a)); } x.closePath(); x.fill(); }
      x.fillStyle = '#0a0a0b'; x.fillRect(168, 28, 52, 38); x.fillStyle = '#2b2c30'; x.fillRect(176, 36, 36, 22);
      x.fillStyle = '#0a0a0b'; x.fillRect(178, 84, 32, 22); x.fillStyle = '#c8212f'; x.fillRect(184, 88, 20, 14);
    });
    const front = ctex(240, 140, (x) => {
      x.fillStyle = '#1b1c1f'; x.fillRect(0, 0, 240, 140); x.fillStyle = '#060607';
      if (!psu.modular) {   // кабели несъёмные: из корпуса прямо выходят жгуты
        x.fillRect(22, 26, 196, 88);
        [50, 100, 150, 198].forEach((cx, i) => { x.fillStyle = '#2a2b2f'; x.beginPath(); x.arc(cx, 70, i % 2 ? 19 : 24, 0, 7); x.fill(); x.strokeStyle = '#0d0e10'; x.lineWidth = 2; for (let k = -24; k <= 24; k += 6) { x.beginPath(); x.moveTo(cx + k, 46); x.lineTo(cx + k, 94); x.stroke(); } });
        return;
      }
      const sock = (sx, sy, cols, rows) => { x.fillRect(sx, sy, cols*9 + 6, rows*9 + 6); x.fillStyle = '#1e1f22'; for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) x.fillRect(sx + 4 + i*9, sy + 4 + j*9, 6, 6); x.fillStyle = '#060607'; };
      sock(14, 18, 9, 2); sock(118, 18, 4, 2); sock(170, 18, 4, 2); sock(14, 60, 4, 2); sock(64, 60, 4, 2); sock(118, 60, 4, 2); sock(170, 60, 4, 2); sock(14, 100, 6, 2); sock(90, 100, 6, 2);
    });
    const grille = ctex(256, 256, (x) => {
      x.strokeStyle = '#050506'; x.lineWidth = 5;
      for (let r = 18; r < 120; r += 13) { x.beginPath(); x.arc(128, 128, r, 0, 7); x.stroke(); }
      for (let i = 0; i < 4; i++) { const a = i*Math.PI/2 + Math.PI/4; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + 125*Math.cos(a), 128 + 125*Math.sin(a)); x.stroke(); }
    });
    return {label, rear, front, grille};
  }

  /* ───── сборка сцены ───── */
  function rebuild(fit){
    disposeAll();
    const b = build();
    const C = b.case, white = S.color === 'white';
    const W = C.dims[0]/10, H = C.dims[1]/10, D = C.dims[2]/10, t = 0.6;
    const tower = C.style === 'mesh', pano = C.style === 'panorama', itx = C.style === 'itx';
    const bfx = (W/2 - 0.45) - C.coolerMax/10 - 0.3;
    const trayX = bfx - 0.96;
    const mb = b.mb, form = mb.form;
    const [bh, bw] = {ATX:[30.5, 24.4], mATX:[24.4, 24.4], ITX:[17, 17]}[form];
    const L = form === 'ITX'
      ? {sockTop:6.5, sockRear:7.2, ramRear:12.4, ramTop:1.2, pcieTop:15.4, m2Top:11.4, m2Rear:5.8}
      : {sockTop:8.2, sockRear:10.2, ramRear:16.2, ramTop:1.5, pcieTop:16.6, m2Top:13.1, m2Rear:7.2};
    const yTop = H - (itx ? 2 : 4.5), zRear = D/2 - t - 1.6;
    const P = (top, rear) => [yTop - top, zRear - rear];
    const zFrontB = zRear - bw;
    const sh = tower ? 10 : 0;
    const cool = b.cooler;
    const frontRad = cool.type === 'aio' && !itx && C.radTop < cool.rad && C.radFront >= cool.rad;
    const bottomRad = cool.type === 'aio' && itx;
    const frontDepth = frontRad ? 5.8 : 3.2;
    const zFrontSh = -D/2 + 1.2 + frontDepth;
    const psuD = b.psu.form === 'SFX' ? [12.5, 6.35, 10] : [15, 8.6, 14];
    const midX = (trayX + W/2) / 2;
    const slotY = yTop - L.pcieTop;
    const nSlots = C.slots;
    const gpuSlots = b.gpu.id === 'none' ? 0 : Math.ceil(b.gpu.slots - 0.05);
    const bodyM = mat({color: white ? 0xe9eaec : 0x1c1e22, roughness:0.45, metalness:0.45});
    const innerM = mat({color: white ? 0xdfe2e5 : 0x17191c, roughness:0.7, metalness:0.3});
    const caseCol = white ? 0xe9eaec : 0x1c1e22;
    const fanFrame = white ? mat({color:0xf1f2f3, roughness:0.55}) : PM.plastic;
    const fanBlade = white ? PM.whiteBlade : PM.blade;

    /* ── корпус ── */
    const shell = new T.Group();
    if (itx) {
      for (const [y0, y1] of [[t, t + 1.2], [H - t - 1.2, H - t]]) rbox(t, y1 - y0, D - 2*t, 0.2, bodyM, -W/2 + t/2, (y0 + y1)/2, 0, shell);
      plane(D - 2*t, H - 2*t - 2.4, perfMat(C.perf, caseCol, D - 2*t, H - 2*t - 2.4), '-x', -W/2 + t/2, H/2, 0, shell);
    } else rbox(t, H, D - 2*t, 0.25, bodyM, -W/2 + t/2, H/2, 0, shell);
    rbox(W, t, D, 0.28, bodyM, 0, t/2, 0, shell);
    { const fe = new T.Group(); for (const a of [-1, 1]) for (const c of [-1, 1]) rbox(Math.min(5, W*0.24), 0.9, 3.4, 0.35, PM.rubber, a*(W/2 - Math.min(5, W*0.24)/2 - 0.6), -0.45, c*(D/2 - 3.4), fe); shell.add(fe); }
    // верх: сплошная полоса спереди + перфорация
    const zt0 = -D/2 + 6, zt1 = D/2 - 1.5;
    rbox(W, t, 6, 0.28, bodyM, 0, H - t/2, -D/2 + 3, shell);
    rbox(W, t, 1.5, 0.28, bodyM, 0, H - t/2, D/2 - 0.75, shell);
    for (const a of [-1, 1]) rbox(1.2, t, zt1 - zt0, 0.2, bodyM, a*(W/2 - 0.6), H - t/2, (zt0 + zt1)/2, shell);
    plane(W - 2.4, zt1 - zt0, perfMat(C.perf, caseCol, W - 2.4, zt1 - zt0), '+y', 0, H - t/2, (zt0 + zt1)/2, shell);
    // кнопки и порты на верхней панели
    { const y = H + 0.005, z = -D/2 + 3.1, x0 = W/2 - 3.2;
      cyl(0.72, 0.3, bodyM, 'y', x0, H + 0.15, z, shell, 32);
      mesh(torusG(0.8, 0.07, 40), PM.led, x0, H + 0.04, z, shell).rotation.x = Math.PI/2;
      for (let i = 0; i < 2; i++) { box(1.25, 0.05, 0.52, PM.hole, x0 - 2.6 - i*1.8, y, z, shell); box(1.0, 0.06, 0.16, PM.usb, x0 - 2.6 - i*1.8, y, z - 0.08, shell); }
      rbox(0.9, 0.05, 0.32, 0.1, PM.hole, x0 - 6.1, y, z, shell);
      cyl(0.2, 0.05, PM.hole, 'y', x0 - 7.4, y, z, shell, 16); }
    // задняя стенка с вырезами
    const ioBot = yTop - (form === 'ITX' ? 14.4 : 15.6), ioTop = yTop - 0.3;
    const slotCY = i => slotY - 0.4 - i*2.03;
    const fanS = C.fans.rear ? C.fans.rear[1] : 0;
    const yFan = H - (itx ? 2 : 4.5) - fanS/2 - 0.6;
    const fanX = Math.max(midX, bfx + 4.7 + fanS*0.46);
    let psuX, psuY, psuZ, psuDims = psuD.slice();
    if (pano) { psuDims = [8.6, 15, 14]; psuX = (-W/2 + t + trayX)/2; psuY = t + 0.6 + 7.5; psuZ = D/2 - t - 0.1 - psuDims[2]/2; }
    else if (itx) { psuX = Math.min(1.5, W/2 - 0.6 - psuD[0]/2); psuY = H - t - 0.4 - psuD[1]/2; psuZ = -D/2 + t + 1.2 + psuD[2]/2; }
    else { psuX = -W/2 + t + 0.4 + psuD[0]/2; psuY = t + 0.3 + psuD[1]/2; psuZ = D/2 - t - 0.1 - psuD[2]/2; }
    { const s = new T.Shape(); s.moveTo(-W/2 + t, t); s.lineTo(W/2, t); s.lineTo(W/2, H - t); s.lineTo(-W/2 + t, H - t); s.lineTo(-W/2 + t, t);
      if (fanS) s.holes.push(circPath(fanX, yFan, fanS*0.46));
      s.holes.push(rectPath(bfx - 0.3, ioBot, bfx + 4.3, ioTop));
      const sTop = slotCY(0) + 1.0, sBot = slotCY(nSlots - 1) - 1.0;
      s.holes.push(rectPath(bfx + 0.6, sBot, bfx + 11.8, sTop));
      if (!itx) s.holes.push(rectPath(psuX - psuDims[0]/2 + 0.3, psuY - psuDims[1]/2 + 0.3, psuX + psuDims[0]/2 - 0.3, psuY + psuDims[1]/2 - 0.3));
      const g = own(new T.ExtrudeGeometry(s, {depth:t, bevelEnabled:false, curveSegments:32}));
      mesh(g, bodyM, 0, 0, D/2 - t, shell);
      if (fanS) plane(fanS*0.94, fanS*0.94, perfMat('hex', caseCol, fanS*0.94, fanS*0.94), '+z', fanX, yFan, D/2 - t/2, shell);
      plane(4.4, ioTop - ioBot, mat({map:ioTexture(ioTop - ioBot), roughness:0.6, metalness:0.3}), '+z', bfx + 2.0, (ioTop + ioBot)/2, D/2 - t*0.5, shell);
      for (let i = gpuSlots; i < nSlots; i++) plane(11.0, 1.75, perfMat('vent', 0x2d3035, 11.0, 1.75), '+z', bfx + 6.2, slotCY(i), D/2 - t*0.5, shell);
      for (let i = 0; i < nSlots; i++) cyl(0.32, 0.4, PM.steel, 'z', bfx + 12.6, slotCY(i), D/2 + 0.15, shell, 6);
    }
    // передняя панель
    const front = new T.Group();
    if (pano) {
      box(W - t, H - 2*t, 0.4, PM.glass, t/2, H/2, -D/2 + 0.2, front).castShadow = false;
      for (const y of [t + 0.7, H - t - 0.7]) box(W - t - 0.2, 1.4, 0.05, PM.frit, t/2, y, -D/2 + 0.43, front);
    } else {
      const s = new T.Shape(); s.moveTo(-W/2, t); s.lineTo(W/2, t); s.lineTo(W/2, H - t); s.lineTo(-W/2, H - t); s.lineTo(-W/2, t);
      const fx0 = -W/2 + 1.4, fx1 = W/2 - 1.4, fy0 = t + (itx ? 1.4 : 2.6), fy1 = H - t - (itx ? 1.2 : 2.0);
      s.holes.push(rectPath(fx0, fy0, fx1, fy1));
      const g = own(new T.ExtrudeGeometry(s, {depth:1.0, bevelEnabled:true, bevelThickness:0.12, bevelSize:0.12, bevelSegments:2}));
      mesh(g, bodyM, 0, 0, -D/2 + 0.1, front);
      plane(fx1 - fx0, fy1 - fy0, perfMat(C.perf, caseCol, fx1 - fx0, fy1 - fy0), '-z', 0, (fy0 + fy1)/2, -D/2 + 0.55, front);
    }
    // боковое стекло
    const gg = new T.Group();
    const gz0 = pano ? -D/2 + 0.4 : -D/2 + t, gz1 = D/2 - t, gL = gz1 - gz0, gzc = (gz0 + gz1)/2;
    const pane = box(0.4, H - 2*t, gL, PM.glass, W/2 - 0.2, H/2, gzc, gg);
    pane.castShadow = false;
    const edge = new T.LineSegments(own(new T.EdgesGeometry(boxG(0.4, H - 2*t, gL))), glassEdge); edge.position.copy(pane.position); gg.add(edge);
    for (const y of [t + 0.7, H - t - 0.7]) box(0.05, 1.4, gL - 0.2, PM.frit, W/2 - 0.43, y, gzc, gg);
    box(0.05, H - 2*t - 2.8, 1.4, PM.frit, W/2 - 0.43, H/2, gz1 - 0.8, gg);
    if (!pano) box(0.05, H - 2*t - 2.8, 1.4, PM.frit, W/2 - 0.43, H/2, gz0 + 0.8, gg);
    if (tower) for (const y of [t + 2.5, H - t - 2.5]) for (const z of [gz0 + 2.5, gz1 - 2.5]) { cyl(0.55, 0.45, PM.steel, 'x', W/2 + 0.22, y, z, gg, 18); cyl(0.4, 0.12, PM.rubber, 'x', W/2 - 0.04, y, z, gg, 14); }
    glassGroup = gg;

    // лоток платы, кожух
    const inner = new T.Group();
    if (trayX - (-W/2 + t) > 0.5) {
      rbox(0.3, H - 2*t, D - 2*t - (pano ? 0.4 : 0), 0.1, innerM, trayX - 0.15, H/2, pano ? 0.2 : 0, inner);
      const zg = zFrontB - 1.9;
      const gy0 = Math.max(sh + 1.5, yTop - bh + 1), gy1 = yTop - 1;
      const nG = 3, gh = (gy1 - gy0 - (nG - 1)*1.2)/nG;
      for (let i = 0; i < nG; i++) { const yc = gy0 + gh/2 + i*(gh + 1.2); rbox(0.14, gh, 1.9, 0.6, PM.rubber, trayX + 0.03, yc, zg, inner); box(0.15, gh - 0.9, 0.12, PM.hole, trayX + 0.06, yc, zg, inner); }
      rbox(0.14, 1.5, 7.5, 0.5, PM.rubber, trayX + 0.03, yTop + (H - t - yTop)/2, zRear - 6.5, inner);
    }
    if (tower) {
      const x0 = -W/2 + t, x1 = W/2 - 0.45, Ls = D/2 - t - zFrontSh;
      rbox(x1 - x0, 0.5, Ls, 0.15, innerM, (x0 + x1)/2, sh, (zFrontSh + D/2 - t)/2, inner);
      const zw = D/2 - t - psuD[2] - 2.5;
      const Lc = zw - zFrontSh;
      if (Lc > 1) { rbox(0.5, sh - t, Lc, 0.12, innerM, W/2 - 1.0, (t + sh)/2, (zFrontSh + zw)/2, inner); plane(Math.min(14, Lc - 2), 1.1, PM.decal, '+x', W/2 - 0.74, sh - 2.2, (zFrontSh + zw)/2, inner); plane(Math.min(14, Lc - 2), 1.1, PM.decal, '+x', W/2 - 0.74, sh - 3.8, (zFrontSh + zw)/2, inner); }
    }
    shell.add(inner);
    reg(shell, 'case');
    reg(front, 'case', V(0, 0, -14));
    reg(gg, null, V(30, 0, 0));
    { // точки для режима «Осмотр»
      anc('case', gg, W/2 + 0.25, H - 4, gz0 + 5, 'Закалённое стекло', 'Боковая панель из закалённого стекла. Через неё видно начинку и подсветку. Снимается, чтобы добраться до деталей.');
      anc('case', front, 0, H*0.62, -D/2 + 0.55, pano ? 'Стеклянная передняя панель' : 'Передняя панель', pano ? 'У панорамных корпусов стекло стоит и спереди, и сбоку, поэтому внутренности видны с двух сторон.' : 'Перфорированная панель: воздух проходит сквозь отверстия к передним вентиляторам.');
      { const bx = W/2 - 3.2, bz = -D/2 + 3.1;
        anc('case', shell, bx, H + 0.32, bz, 'Кнопка питания', 'Включает компьютер. Вокруг кнопки светодиодное кольцо.');
        anc('case', shell, bx - 4.4, H + 0.08, bz, 'USB и аудио', 'Порты на верхней панели: два USB-A, USB-C и совмещённый разъём для наушников.', {val:'2×USB-A · USB-C · аудио'}); }
      anc('case', shell, bfx + 2.0, (ioTop + ioBot)/2, D/2 + 0.02, 'Окно для портов платы', 'Вырез в задней стенке: сюда выходят USB, сеть, звук и видеовыходы материнской платы.');
      anc('case', shell, bfx + 6.2, slotCY(Math.floor(nSlots/2)), D/2 + 0.02, 'Слоты расширения', 'Отсеки под заднюю планку видеокарты и других плат. Свободные закрыты вентилируемыми заглушками.', {val:`${nSlots} слотов`});
      if (trayX - (-W/2 + t) > 0.5) anc('case', shell, trayX + 0.14, (Math.max(sh + 1.5, yTop - bh + 1) + yTop - 1)/2, zFrontB - 1.9, 'Окна для кабелей', 'Резиновые окна в лотке платы. Кабели блока питания уходят в них на обратную сторону и возвращаются точно к нужному разъёму.');
      if (tower) anc('case', shell, 0, sh + 0.3, (zFrontSh + D/2 - t)/2, 'Кожух блока питания', 'Перегородка скрывает блок питания и лишние кабели, поэтому внутри остаётся аккуратно.');
      anc('case', shell, W/2 - Math.min(5, W*0.24)/2 - 0.6, -0.5, -(D/2 - 3.4), 'Резиновые ножки', 'Приподнимают корпус над столом, гасят вибрацию и оставляют зазор для воздуха снизу.');
    }

    // вентиляторы корпуса
    const fansNote = C.fansIncluded ? '' : ' В комплекте вентиляторов нет, на модели показаны рекомендуемые.';
    const caseFanOpt = {rgb: C.rgbFans || !C.fansIncluded, frame: fanFrame, blade: fanBlade, pads: !C.rgbFans && C.fansIncluded};
    if (C.fans.front && !frontRad) {
      const [n, s] = C.fans.front, fgp = new T.Group();
      for (let i = 0; i < n; i++) { const f = makeFan(s, caseFanOpt); f.position.set(0.3, 2.2 + s/2 + i*(s + 0.5), -D/2 + 1.25 + 1.3); fgp.add(f); }
      reg(fgp, 'case', V(0, 0, -9));
      anc('case', fgp, 0.3, 2.2 + s/2 + (n - 1)*(s + 0.5)/2, -D/2 + 2.55, 'Передние вентиляторы', 'Забирают воздух снаружи и гонят его через корпус к процессору и видеокарте.' + fansNote, {val:`${n} × ${s*10} мм`});
    }
    if (C.fans.rear) {
      const [, s] = C.fans.rear, rg = new T.Group();
      const f = makeFan(s, caseFanOpt); f.position.set(fanX, yFan, D/2 - t - 1.3); rg.add(f);
      reg(rg, 'case', V(0, 0, 9));
      anc('case', rg, fanX, yFan, D/2 - t - 1.3, 'Задний вентилятор', 'Выдувает нагретый воздух наружу, к процессору с кулером.' + fansNote, {val:`${C.fans.rear[1]*10} мм`});
    }
    if (C.fans.bottom && !bottomRad) {
      const [n, s] = C.fans.bottom, bg = new T.Group();
      for (let i = 0; i < n; i++) { const f = orient(makeFan(s, caseFanOpt), 'y'); f.position.set(midX, t + 1.35, D/2 - t - 1.5 - s/2 - i*(s + 0.5)); bg.add(f); }
      reg(bg, 'case', V(0, -8, 0));
      anc('case', bg, midX, t + 1.35, D/2 - t - 1.5 - s/2 - (n - 1)*(s + 0.5)/2, 'Нижние вентиляторы', 'Забирают воздух снизу и обдувают видеокарту.' + fansNote, {val:`${n} × ${s*10} мм`});
    }

    /* ── материнская плата ── */
    const mg = new T.Group();
    const pcbM = mat({map:pcbTexture(mb, bh, bw, L), roughness:0.55, metalness:0.15});
    const pcbEdge = mat({color:mb.pcb, roughness:0.7});
    box(0.16, bh, bw, [pcbM, pcbEdge, pcbEdge, pcbEdge, pcbEdge, pcbEdge], bfx - 0.08, yTop - bh/2, zRear - bw/2, mg);
    const accM = mat({color:mb.acc, roughness:0.32, metalness:0.85});
    const accDark = mat({color:0x16171a, roughness:0.4, metalness:0.6});
    let y, z;
    // винты крепления
    const holes = bh > 20 ? [[0.9,1.4],[0.9,bw - 0.7],[bh*0.48,bw - 0.7],[bh - 0.9,1.4],[bh - 0.9,bw*0.62],[bh - 0.9,bw - 0.7]] : [[0.9,1.0],[bh - 0.9,1.0],[bh - 0.9,bw - 0.7]];
    for (const [tp, rr] of holes) { [y, z] = P(tp, rr); cyl(0.33, 0.22, PM.steel, 'x', bfx + 0.11, y, z, mg, 14); }
    // сокет
    [y, z] = P(L.sockTop, L.sockRear);
    const yS = y, zS = z;
    const intel = b.cpu.socket.startsWith('LGA');
    box(0.25, 5.6, 5.6, PM.plastic, bfx + 0.12, yS, zS, mg);
    if (intel) {
      rbox(0.3, 5.8, 1.0, 0.1, PM.steel, bfx + 0.4, yS, zS + 2.9, mg); rbox(0.3, 5.8, 1.0, 0.1, PM.steel, bfx + 0.4, yS, zS - 2.9, mg);
      rbox(0.3, 1.0, 5.6, 0.1, PM.steel, bfx + 0.4, yS + 2.9, zS, mg); rbox(0.3, 1.0, 5.6, 0.1, PM.steel, bfx + 0.4, yS - 2.9, zS, mg);
      cyl(0.12, 6.4, PM.steel, 'y', bfx + 0.45, yS, zS - 3.7, mg, 8);
    } else if (b.cpu.socket === 'AM5') {
      rbox(0.35, 6.0, 0.8, 0.1, PM.steel, bfx + 0.4, yS, zS + 3.1, mg); rbox(0.35, 6.0, 0.8, 0.1, PM.steel, bfx + 0.4, yS, zS - 3.1, mg);
      cyl(0.12, 6.2, PM.steel, 'y', bfx + 0.45, yS, zS - 3.75, mg, 8);
      for (const yy of [-4.2, 4.2]) rbox(0.9, 1.0, 7.6, 0.2, PM.plastic, bfx + 0.45, yS + yy, zS, mg);
    } else {
      for (const yy of [-4.0, 4.0]) rbox(1.1, 1.2, 7.2, 0.25, PM.plastic, bfx + 0.55, yS + yy, zS, mg);
      cyl(0.1, 5.4, PM.steel, 'y', bfx + 0.35, yS, zS - 3.1, mg, 8);
    }
    // радиаторы VRM (гребёнка)
    const combG = (len, wid, hgt, fins) => geo(`comb${f2(len)},${f2(wid)},${f2(hgt)},${fins}`, () => {
      const s = new T.Shape(), base = hgt*0.28, fw = wid/(fins*2 - 1);
      s.moveTo(-wid/2, 0); s.lineTo(wid/2, 0); s.lineTo(wid/2, base);
      for (let i = fins - 1; i >= 0; i--) { const x1 = -wid/2 + i*2*fw + fw, x0 = -wid/2 + i*2*fw; s.lineTo(x1, base); s.lineTo(x1, hgt); s.lineTo(x0, hgt); s.lineTo(x0, base); }
      s.lineTo(-wid/2, 0);
      const g = new T.ExtrudeGeometry(s, {depth:len, bevelEnabled:true, bevelThickness:0.04, bevelSize:0.03, bevelSegments:1});
      g.translate(0, 0, -len/2); g.rotateZ(-Math.PI/2); return g;
    });
    const vrmTop = mesh(combG(7.8, 1.9, 1.9, 6), accM, bfx + 0.02, yS + 4.6 + (b.cpu.socket === 'AM5' ? 0.4 : 0), zS - 0.6, mg);
    vrmTop.rotation.x = 0;
    const vrmRear = mesh(combG(8.6, 1.9, 1.9, 6), accM, bfx + 0.02, yS - 0.4, zS + 4.9, mg);
    vrmRear.rotation.x = Math.PI/2;
    rbox(0.18, 0.8, 7.9, 0.06, accDark, bfx + 1.95, vrmTop.position.y + 0.55, zS - 0.6, mg);
    rbox(0.18, 8.7, 0.8, 0.06, accDark, bfx + 1.95, yS - 0.4, zS + 5.45, mg);
    inst(boxG(0.45, 0.62, 0.62), PM.choke, 10, (d, i) => { d.position.set(bfx + 0.24, yS + 3.35, zS - 4.0 + i*0.72); }, mg);
    inst(boxG(0.45, 0.62, 0.62), PM.choke, 10, (d, i) => { d.position.set(bfx + 0.24, yS + 3.5 - i*0.78, zS + 3.65); }, mg);
    // кожух I/O
    { const ioH = form === 'ITX' ? 7.5 : 10, ioy = yTop - 0.3 - ioH/2;
      rbox(3.6, ioH, 2.4, 0.25, accDark, bfx + 1.8, ioy, zRear - 1.1, mg);
      rbox(0.12, ioH - 1.2, 1.4, 0.05, mb.rgbIO ? PM.rgb : accM, bfx + 3.62, ioy, zRear - 1.1, mg);
      rbox(1.2, ioH*0.9, 0.35, 0.08, accM, bfx + 2.8, ioy, zRear - 2.35, mg); }
    // слоты памяти
    for (let i = 0; i < mb.slots; i++) {
      [y, z] = P(L.ramTop + 6.65, L.ramRear + i*0.85);
      box(0.75, 13.6, 0.58, PM.plastic, bfx + 0.38, y, z, mg);
      box(0.95, 0.8, 0.64, i % 2 ? PM.grey : PM.white, bfx + 0.5, y + 7.1, z, mg);
      box(0.5, 0.4, 0.62, PM.plastic, bfx + 0.28, y - 7.0, z, mg);
    }
    // PCIe
    [y, z] = P(L.pcieTop, 1.2 + 4.45);
    rbox(1.1, 0.95, 8.9, 0.08, PM.steel, bfx + 0.55, y, z - 0.0, mg);
    box(0.6, 0.98, 0.7, PM.white, bfx + 0.62, y, z - 4.9, mg);
    if (form !== 'ITX') {
      const extra = form === 'ATX' ? [[4.06, 2.5], [8.12, 8.9], [12.2, 2.5]] : [[4.06, 2.5], [8.12, 8.9]];
      for (const [dy, len] of extra) { [y, z] = P(L.pcieTop + dy, 1.2 + len/2); if (y > yTop - bh + 0.8) box(0.85, 0.75, len, PM.plastic, bfx + 0.42, y, z, mg); }
      // нижние радиаторы M.2 и чипсета
      [y, z] = P(L.pcieTop + 2.1, 6.5); rbox(0.55, 2.6, 9.0, 0.1, accM, bfx + 0.28, y, z, mg);
      [y, z] = P(bh - 6.0, bw - 6.6); rbox(0.9, 6.0, 6.6, 0.2, accM, bfx + 0.45, y, z, mg); rbox(0.08, 4.6, 5.2, 0.05, accDark, bfx + 0.92, y, z, mg);
      // SATA, разъёмы снизу, батарейка, конденсаторы звука
      for (let i = 0; i < 4; i++) { [y, z] = P(bh - 2.0 - i*0.75, bw - 0.55); box(0.9, 0.6, 1.1, PM.plastic, bfx + 0.45, y, z, mg); }
      for (const [rr, w2, m] of [[bw - 5.0, 2.0, PM.plastic], [bw - 9.0, 2.2, PM.usb], [bw - 12.6, 1.2, PM.white], [5.8, 0.9, PM.white], [3.0, 1.3, PM.plastic]]) { [y, z] = P(bh - 0.55, rr); box(0.85, 0.7, w2, m, bfx + 0.42, y, z, mg); }
      [y, z] = P(bh - 9.0, bw*0.52); cyl(1.0, 0.32, PM.nickel, 'x', bfx + 0.2, y, z, mg, 32); cyl(1.1, 0.12, PM.plastic, 'x', bfx + 0.06, y, z, mg, 32);
      for (let i = 0; i < 6; i++) { [y, z] = P(bh - 3.0 - (i % 3)*1.0, 2.2 + Math.floor(i/3)*1.0); cyl(0.33, 0.9, PM.capGold, 'x', bfx + 0.45, y, z, mg, 16); }
    }
    // 24-pin и 8-pin EPS
    const z24 = zFrontB + 0.65, y24 = yTop - bh*0.33;
    rbox(1.35, 5.4, 1.0, 0.06, PM.plastic, bfx + 0.68, y24, z24, mg);
    [y, z] = P(0.9, 3.2);
    const yEPS = y, zEPS = z;
    rbox(1.35, 0.95, 1.9, 0.06, PM.plastic, bfx + 0.68, yEPS, zEPS, mg);
    // мелкие конденсаторы у сокета
    inst(cylG(0.24, 0.24, 0.7, 12), PM.capAlu, 8, (d, i) => { d.rotation.z = -Math.PI/2; d.position.set(bfx + 0.35, yS - 3.6, zS - 3.0 + i*0.6); }, mg);
    // слот M.2 (стойка)
    [y, z] = P(L.m2Top, L.m2Rear);
    box(0.45, 2.3, 0.5, PM.plastic, bfx + 0.22, y, z + 4.1, mg);
    cyl(0.25, 0.4, PM.gold, 'x', bfx + 0.2, y, z - 4.0, mg, 10);
    if (form !== 'ITX') {
      // чип BIOS (SOIC-8) и контакты разъёмов на нижнем краю платы
      [y, z] = P(bh - 6.6, bw*0.5 + 1.5);
      box(0.12, 0.72, 0.92, PM.chip, bfx + 0.14, y, z, mg);
      cyl(0.07, 0.02, PM.white, 'x', bfx + 0.21, y + 0.22, z - 0.3, mg, 10);
      inst(boxG(0.04, 0.1, 0.18), PM.steel, 8, (d, i) => { d.position.set(bfx + 0.1, y + (i < 4 ? -0.4 : 0.4), z - 0.33 + (i % 4)*0.22); }, mg);
      for (const [rr] of [[bw - 5.0], [bw - 9.0]]) {
        const [py, pz] = P(bh - 0.55, rr);
        inst(boxG(0.05, 0.1, 0.1), PM.gold, 10, (d, i) => { d.position.set(bfx + 0.87, py + (i < 5 ? -0.13 : 0.13), pz - 0.4 + (i % 5)*0.2); }, mg);
      }
    }
    reg(mg, 'mb', V(6, 0, 0));
    { // точки для режима «Осмотр»
      const intelS = mb.socket.startsWith('LGA');
      anc('mb', mg, bfx + 0.5, yS, zS, `Сокет ${mb.socket}`, intelS ? 'Гнездо под процессор. Контакты находятся в самом сокете (LGA): процессор просто ложится на них, сверху его прижимает рамка с рычагом.' : mb.socket === 'AM5' ? 'Гнездо под процессор AMD. Контакты в самом сокете (LGA), а процессор прижимает рамка с рычагом.' : 'Гнездо под процессор AMD. Здесь отверстия: ножки у самого процессора, поэтому его нельзя ронять на плату или гнуть контакты.', {val:`${mb.socket} · ${mb.form}`});
      anc('mb', mg, bfx + 1.0, yS + 4.9, zS - 0.6, 'Радиатор VRM', 'Под ним силовые каскады питания. Они превращают 12 В от блока питания в напряжение, которое нужно процессору.');
      [y, z] = P(0.9, 3.2);
      anc('mb', mg, bfx + 1.4, y, z, 'Питание процессора', 'Отдельный разъём EPS: сюда подключается кабель 4+4 pin от блока питания, чтобы кормить процессор.', {val:'8-pin EPS'});
      [y, z] = P(L.ramTop + 6.65, L.ramRear + 0.85*(mb.slots - 1)/2);
      anc('mb', mg, bfx + 0.8, y + 1.5, z, 'Слоты памяти', 'Сюда защёлкиваются модули оперативной памяти. Фиксаторы на торцах держат модуль.', {val:`${mb.slots} × ${mb.ram}`});
      [y, z] = P(L.pcieTop, 1.2 + 4.45);
      anc('mb', mg, bfx + 1.15, y, z + 1.2, 'Слот PCIe x16', 'Сюда ставится видеокарта. Самый длинный слот, он подключён напрямую к процессору.');
      [y, z] = P(L.m2Top, L.m2Rear);
      anc('mb', mg, bfx + 0.6, y, z, 'Слот M.2', 'Для SSD формата M.2 (NVMe). Накопитель ставится прямо на плату, без кабелей.');
      anc('mb', mg, bfx + 1.15, y24, z24, 'Питание платы', 'Главный разъём 24-pin. Сюда идёт самый толстый кабель от блока питания.', {val:'24-pin ATX'});
      if (form !== 'ITX') {
        [y, z] = P(bh - 6.0, bw - 6.6);
        anc('mb', mg, bfx + 0.95, y, z, 'Радиатор чипсета', 'Чипсет распределяет линии для USB, SATA, дополнительных M.2 и сети. Прячется под радиатором.');
        [y, z] = P(bh - 3.5, bw - 0.55);
        anc('mb', mg, bfx + 0.95, y, z, 'Порты SATA', 'Для 2,5-дюймовых SSD и жёстких дисков, если захочешь добавить ещё накопитель.', {val:'4 порта'});
        [y, z] = P(bh - 9.0, bw*0.52);
        anc('mb', mg, bfx + 0.38, y, z, 'Батарейка CR2032', 'Хранит часы и настройки BIOS, пока компьютер выключен.');
        [y, z] = P(bh - 6.6, bw*0.5 + 1.5);
        anc('mb', mg, bfx + 0.22, y, z, 'Микросхема BIOS', 'Здесь записана программа, которая запускает плату и находит остальные детали при включении.');
        [y, z] = P(bh - 0.55, bw - 5.0);
        anc('mb', mg, bfx + 0.9, y, z, 'Выводы на корпус', 'Нижний край платы: кнопка питания и светодиоды корпуса (F_PANEL), USB-разъёмы передней панели, звук и разъёмы для вентиляторов.');
      }
      { const ioH = form === 'ITX' ? 7.5 : 10;
        anc('mb', mg, bfx + 3.7, yTop - 0.3 - ioH/2, zRear - 1.1, 'Панель портов', 'Задние порты: USB, сеть, звук и видеовыходы. Выходят наружу через окно в задней стенке корпуса.'); }
    }

    /* ── процессор ── */
    const cpg = new T.Group();
    { const am5 = b.cpu.socket === 'AM5', am4 = !intel && !am5, cpu = b.cpu;
      const A = intel ? [1.8, 1.55] : am5 ? [1.9, 1.9] : [1.75, 1.75];   // половина крышки: по высоте и по глубине
      const sy = intel ? 4.5 : 4.4, sz = intel ? 3.75 : 4.4;               // размер подложки
      const subTop = bfx + 0.34, capX = subTop + 0.06;
      box(0.13, sy, sz, mat({color:0x2f6a3a, roughness:0.6}), bfx + 0.275, yS, zS, cpg);
      let shape; const notches = [];
      if (am5) {
        // крышка AM5: срезанные углы и по два выреза на каждой стороне, в вырезах стоят конденсаторы
        const a = 1.9, c = 0.5, nd = 0.42, nw = 0.8, off = 0.95;
        const side = [[-a + c, -a], [-off - nw/2, -a], [-off - nw/2, -a + nd], [-off + nw/2, -a + nd], [-off + nw/2, -a], [off - nw/2, -a], [off - nw/2, -a + nd], [off + nw/2, -a + nd], [off + nw/2, -a], [a - c, -a], [a, -a + c]];
        const pts = [];
        for (let k = 0; k < 4; k++) {
          const cs = Math.cos(k*Math.PI/2), sn = Math.sin(k*Math.PI/2);
          for (const [px, py] of side) pts.push([px*cs - py*sn, px*sn + py*cs]);
          for (const o of [-off, off]) { const qx = o, qy = -a + nd/2; notches.push([qx*cs - qy*sn, qx*sn + qy*cs, k % 2]); }
        }
        shape = new T.Shape(); pts.forEach(([px, py], i) => i ? shape.lineTo(px, py) : shape.moveTo(px, py)); shape.closePath();
      } else shape = roundRect(new T.Shape(), -A[1], -A[0], 2*A[1], 2*A[0], intel ? 0.22 : 0.3);
      const g = own(new T.ExtrudeGeometry(shape, {depth:0.3, bevelEnabled:true, bevelThickness:0.04, bevelSize:0.04, bevelSegments:2}));
      g.rotateY(Math.PI/2);
      const tx = ihsTexture(cpu); tx.repeat.set(0.25, 0.25); tx.offset.set(0.5, 0.5);
      mesh(g, [mat({map:tx, roughness:0.32, metalness:0.95}), PM.nickel], bfx + 0.33, yS, zS, cpg);
      // мелкие SMD-конденсаторы на подложке
      const smd = mat({color:0x4a3b25, roughness:0.45, metalness:0.35});
      if (am5) for (const [px, py, odd] of notches) box(0.12, odd ? 0.5 : 0.24, odd ? 0.24 : 0.5, smd, capX, yS + py, zS - px, cpg);
      else for (let i = 0; i < 6; i++) box(0.12, 0.24, 0.5, smd, capX, yS - (A[0] + 0.28), zS - 1.4 + i*0.56, cpg);
      // золотой треугольник: метка первого контакта
      const keyY = yS + (sy/2 - 0.3), keyZ = zS + (sz/2 - 0.3);
      cyl(0.26, 0.03, PM.gold, 'x', subTop + 0.015, keyY, keyZ, cpg, 3);
      // снизу: у LGA плоские золотые площадки, у AM4 ножки
      if (am4) {
        const pts = []; for (let i = 0; i < 25; i++) for (let j = 0; j < 25; j++) if (!(i > 7 && i < 17 && j > 7 && j < 17)) pts.push([i - 12, j - 12]);
        inst(cylG(0.035, 0.035, 0.22, 5), PM.gold, pts.length, (d, i) => { d.rotation.z = -Math.PI/2; d.position.set(bfx + 0.115, yS + pts[i][0]*0.15, zS + pts[i][1]*0.15); }, cpg);
      } else {
        const padTex = ctex(256, 256, (x) => {
          x.fillStyle = '#2f6a3a'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#c9a43a';
          for (let i = 6; i < 250; i += 6) for (let j = 6; j < 250; j += 6) { if (i > 90 && i < 166 && j > 70 && j < 186) continue; x.beginPath(); x.arc(i, j, 1.9, 0, 7); x.fill(); }
        });
        plane(sz - 0.3, sy - 0.3, mat({map:padTex, roughness:0.5, metalness:0.6}), '-x', bfx + 0.204, yS, zS, cpg);
      }
      anc('cpu', cpg, bfx + 0.7, yS + 1.15, zS, 'Крышка процессора (IHS)', 'Металлическая крышка. Тепло от кристалла уходит через неё в кулер. На крышке напечатана маркировка.', {val:cpu.name.replace(/^(AMD|Intel) /, '')});
      anc('cpu', cpg, bfx + 0.5, yS - 0.45, zS + 0.35, 'Ядра', `Сам кристалл спрятан под крышкой. ${cpu.cores} ядер и ${cpu.threads} потоков, частота ${cpu.clock}. Под нагрузкой процессор потребляет до ≈${cpu.power} Вт.${cpu.igpu ? ' Есть встроенная графика.' : ''}`, {inside:true, val:`${cpu.cores} ядер / ${cpu.threads} потоков`});
      anc('cpu', cpg, bfx + 0.4, yS - (A[0] + 0.28), zS, 'Подложка и конденсаторы', 'Зелёный текстолит с крошечными конденсаторами. Они сглаживают питание, чтобы процессор работал стабильно.');
      anc('cpu', cpg, subTop + 0.04, keyY, keyZ, 'Ключ: золотой треугольник', 'Метка первого контакта. Совпадает с меткой на сокете платы, чтобы процессор лёг правильной стороной.');
      anc('cpu', cpg, bfx + 0.2, yS - 0.8, zS - sz/2 + 0.2, am4 ? 'Ножки (PGA)' : 'Контактные площадки', am4 ? 'С обратной стороны торчат тонкие ножки. Они входят в отверстия сокета, поэтому процессор AMD с AM4 легко погнуть при неосторожной установке.' : 'С обратной стороны плоские золотые площадки. Они прижимаются к подпружиненным контактам сокета на плате.', {inside:true});
    }
    reg(cpg, 'cpu', V(6 + 8, 0, 0));

    /* ── SSD ── */
    const sg = new T.Group();
    [y, z] = P(L.m2Top, L.m2Rear);
    { const x0 = bfx + 0.55;
      box(0.08, 2.2, 8.0, mat({color:0x101114, roughness:0.6}), x0, y, z, sg);
      box(0.06, 0.85, 0.5, PM.gold, x0, y - 0.55, z + 3.75, sg); box(0.06, 0.8, 0.5, PM.gold, x0, y + 0.6, z + 3.75, sg);   // между ними вырез-ключ
      cyl(0.2, 0.07, PM.steel, 'x', x0 + 0.06, y, z - 3.82, sg, 14);
      box(0.16, 1.3, 1.3, PM.chip, x0 + 0.1, y, z + 2.6, sg);
      box(0.16, 1.4, 1.5, PM.chip, x0 + 0.1, y, z + 0.6, sg);
      box(0.16, 1.4, 1.5, PM.chip, x0 + 0.1, y, z - 1.2, sg);
      const lbl = labelTexture([['NVMe  M.2  2280', 30, 40, 'left', 700], [`${b.ssd.cap.replace(' ТБ', ' TB')}  ·  PCIe 4.0 x4`, 26, 84, 'left', 500]], 512, 128, {bg:'#1b1c20', fg:'#d6d9de'});
      plane(5.2, 1.7, mat({map:lbl, roughness:0.5}), '+x', x0 + 0.19, y, z - 0.3, sg);
    }
    reg(sg, 'ssd', V(6 + 7, 0, 0));
    { const x0 = bfx + 0.55; [y, z] = P(L.m2Top, L.m2Rear); const sd = b.ssd;
      anc('ssd', sg, x0 + 0.22, y + 0.45, z - 0.3, 'Наклейка', `${sd.cap}, ${sd.iface}. Под наклейкой прячутся микросхемы памяти.`, {val:`${sd.cap} · ${sd.iface}`});
      anc('ssd', sg, x0 + 0.18, y, z - 1.2, 'Флеш-память NAND', 'Здесь физически хранятся данные: чипы флеш-памяти. Они не боятся ударов, потому что в SSD нет движущихся частей.', {inside:true});
      anc('ssd', sg, x0 + 0.18, y, z + 2.6, 'Контроллер', 'Управляет записью и чтением, распределяет износ ячеек. От него зависит скорость диска.', {inside:true, val:`чтение до ${sd.speed}`});
      anc('ssd', sg, x0 + 0.03, y + 0.6, z + 3.75, 'Контакты M.2', 'Золотые контакты входят в разъём на плате. Вырез (ключ) не даёт вставить диск неправильно.');
      anc('ssd', sg, x0 + 0.1, y, z - 3.82, 'Крепёжный винт', 'Один винт прижимает накопитель к стойке. Сам разъём диск не фиксирует.'); }

    /* ── память ── */
    const rg2 = new T.Group();
    const slotIdx = b.ram.sticks >= 4 ? [0,1,2,3] : (mb.slots === 4 ? [1,3] : [0,1]);
    const prof = b.ram.profile;
    const sprM = mat({color:b.ram.color, roughness: b.ram.color > 0x808080 ? 0.28 : 0.45, metalness: b.ram.color > 0x808080 ? 0.9 : 0.55});
    const bandM = mat({color:0x18191c, roughness:0.35, metalness:0.6});
    const ramPcb = mat({color:0x1b3b2a, roughness:0.6});
    const sprG = geo('ram' + prof, () => {
      const s = new T.Shape(), Lr = 13.3;
      const hgt = prof === 'flat' ? 3.3 : prof === 'tall' ? 3.9 : 3.6;
      s.moveTo(0, 0.4); s.lineTo(Lr, 0.4);
      if (prof === 'flat') { s.lineTo(Lr, hgt - 0.4); s.lineTo(Lr - 0.4, hgt); s.lineTo(0.4, hgt); s.lineTo(0, hgt - 0.4); }
      else if (prof === 'tall') { s.lineTo(Lr, hgt - 0.2); s.lineTo(Lr - 1.2, hgt); s.lineTo(1.2, hgt); s.lineTo(0, hgt - 0.2); }
      else { s.lineTo(Lr, hgt - 0.6); s.lineTo(Lr - 2.0, hgt); s.lineTo(6.0, hgt); s.lineTo(5.4, hgt - 0.35); s.lineTo(0.6, hgt - 0.35); s.lineTo(0, hgt - 0.8); }
      s.lineTo(0, 0.4);
      const g = new T.ExtrudeGeometry(s, {depth:0.16, bevelEnabled:true, bevelThickness:0.03, bevelSize:0.03, bevelSegments:1});
      g.rotateZ(-Math.PI/2); return g;
    });
    const ramSticker = labelTexture([[`${b.ram.size/b.ram.sticks} GB`, 56, 70, 'left', 700], [`${b.ram.type}  ${b.ram.speed.replace('МТ/с', 'MT/s')}`, 30, 130, 'left', 600], ['KIT ' + (b.ram.sticks > 1 ? `${b.ram.sticks}×${b.ram.size/b.ram.sticks} GB` : `${b.ram.size} GB`), 24, 180, 'left', 500]], 512, 200, {bg:'#e8e9eb', band:'#2b2d31'});
    for (const i of slotIdx.slice(0, Math.max(mb.slots, b.ram.sticks))) {
      [y, z] = P(L.ramTop + 6.65, L.ramRear + i*0.85);
      const stick = new T.Group(); stick.position.set(bfx + 0.8, y + 6.65, z);
      box(3.4, 13.3, 0.12, ramPcb, 1.7, -6.65, 0, stick);
      { const yN = -13.3*(b.ram.type === 'DDR5' ? 0.46 : 0.535);   // вырез-ключ: у DDR5 и DDR4 в разных местах
        box(0.4, -0.35 - (yN + 0.15) + 0.0, 0.14, PM.gold, -0.05, (-0.35 + yN + 0.15)/2, 0, stick);
        box(0.4, (yN - 0.15) + 12.95, 0.14, PM.gold, -0.05, (yN - 0.15 - 12.95)/2, 0, stick); }
      plane(7.4, 2.3, mat({map:ramSticker, roughness:0.45}), '-z', 1.9, -6.65, -0.36, stick).rotation.z = Math.PI/2;
      for (const zz of [0.08, -0.24]) mesh(sprG, sprM, 0, 0, zz, stick);
      if (prof === 'tall') for (const zz of [0.26, -0.28]) box(1.4, 9.0, 0.03, bandM, 1.8, -6.65, zz, stick);
      if (b.ram.rgb) {
        const top = prof === 'tall' ? 3.9 : 3.6;
        rbox(0.75, prof === 'tall' ? 10.9 : 12.4, 0.5, 0.18, PM.diff, top + 0.35, -6.65, 0, stick);
      }
      rg2.add(stick);
    }
    reg(rg2, 'ram', V(6 + 14, 0, 0));
    { const i0 = slotIdx[0]; [y, z] = P(L.ramTop + 6.65, L.ramRear + i0*0.85);
      const yT = y + 6.65, xT = bfx + 0.8 + (prof === 'tall' ? 3.9 : 3.6), r = b.ram;
      anc('ram', rg2, xT + 0.02, yT - 2.6, z - 0.1, 'Радиатор модуля', 'Алюминиевая накладка. Забирает тепло у микросхем памяти и защищает плату. На модели показан тип ' + (prof === 'flat' ? 'низкопрофильный' : prof === 'tall' ? 'высокий, с подсвечиваемой верхушкой' : 'ступенчатый') + '.');
      anc('ram', rg2, bfx + 2.7, yT - 6.65, z - 0.38, 'Наклейка с параметрами', `Размер модуля, тип и скорость: ${r.size/r.sticks} ГБ, ${r.type}, ${r.speed}.`, {val:`${r.size} ГБ · ${r.type}`});
      anc('ram', rg2, bfx + 2.6, yT - 10.0, z, 'Микросхемы памяти', 'Чипы, в которых хранятся данные, пока компьютер включён. Они с двух сторон платы под радиатором.', {inside:true});
      anc('ram', rg2, bfx + 0.75, yT - 12.7, z, 'Контакты и вырез', 'Золотые контакты входят в слот. Вырез смещён от центра, поэтому память ' + r.type + ' не вставить в слот другого поколения.', {inside:true});
      [y, z] = P(L.ramTop + 6.65, L.ramRear + i0*0.85);
      anc('ram', rg2, bfx + 0.5, y + 7.1, z, 'Защёлка слота', 'Фиксатор на торце слота. Он сам защёлкивается, когда модуль вставлен до конца.');
      if (r.rgb) anc('ram', rg2, xT + 0.73, yT - 6.65, z, 'Подсветка', 'Светящаяся полоса сверху модуля. Цвет задаёт кнопка RGB на стенде.');
      if (r.sticks > 1) { const [y2, z2] = P(L.ramTop + 6.65, L.ramRear + slotIdx[1]*0.85);
        anc('ram', rg2, xT + 0.02, y2 + 6.65 - 8.6, z2 - 0.1, `Комплект из ${r.sticks} модулей`, 'Одинаковые модули работают в двухканальном режиме: данные идут по двум каналам сразу, поэтому память быстрее.'); } }

    /* ── видеокарта ── */
    let gpuConn = null;
    if (b.gpu.id !== 'none') {
      const G = b.gpu, Lg = G.length/10, th = G.slots*2.0, cardH = 12.6;
      const zB = D/2 - t - 0.3;
      const gpg = new T.Group(); gpg.position.set(bfx + 0.45, slotY + 0.6, zB);
      const shroudM = mat({color:G.body, roughness:0.48, metalness:0.3});
      const bpM = mat({color:0x2a2d32, roughness:0.62, metalness:0.3});
      // бэкплейт
      rbox(cardH, 0.22, Lg - 0.3, 0.08, bpM, cardH/2, -0.11, -(Lg - 0.3)/2 - 0.15, gpg);
      plane(cardH*0.45, Lg*0.55, PM.decal, '+y', cardH*0.55, 0.005, -Lg*0.45, gpg);
      // плата и контакты
      box(cardH - 0.8, 0.16, Lg*0.72, mat({color:0x0f1316, roughness:0.6}), cardH/2 - 0.2, -0.38, -0.3 - Lg*0.36, gpg);
      box(0.9, 0.12, 8.0, PM.gold, -0.4, -0.38, -5.2, gpg);
      // радиатор
      const fy = th - 1.35, fh = cardH - 1.0;
      const nf = Math.floor((Lg - 1.6)/0.17);
      inst(planeG(fh, fy), PM.fin, nf, (d, i) => { d.position.set(cardH/2 - 0.1, -0.55 - fy/2, -0.8 - i*0.17); }, gpg);
      // тепловые трубки, выходящие на торец
      for (let k = 0; k < 4; k++) {
        const yp = -0.9 - k*Math.min(0.75, (th - 2)/4), za = -Lg*0.22 - k*0.15;
        const pts = [V(cardH - 3, yp, za), V(cardH - 0.4, yp, za - 0.2), V(cardH + 0.45, yp, za - 1.2), V(cardH + 0.55, yp, za - 2.6), V(cardH + 0.45, yp, za - 4.0), V(cardH - 0.4, yp, za - 5.0), V(cardH - 3, yp, za - 5.2)];
        mesh(own(tubeG(pts, 0.3, 40, 10)), PM.nickel, 0, 0, 0, gpg);
      }
      // кожух снизу с вырезами под вентиляторы
      const nfans = G.fans, fs = Math.min(9.6, (Lg - 1.6)/nfans - 0.35);
      { const s = roundRect(new T.Shape(), 0, 0, cardH, Lg, 0.6);
        for (let i = 0; i < nfans; i++) s.holes.push(circPath(cardH/2 + 0.1, 0.8 + (Lg - 1.6)*(i + 0.5)/nfans, fs/2 + 0.12));
        const g = own(new T.ExtrudeGeometry(s, {depth:0.4, bevelEnabled:true, bevelThickness:0.08, bevelSize:0.08, bevelSegments:2, curveSegments:40}));
        g.rotateX(-Math.PI/2);
        mesh(g, shroudM, 0, -th + 0.05, 0, gpg); }
      // боковые кромки кожуха
      rbox(0.45, 1.9, Lg - 0.2, 0.15, shroudM, cardH - 0.22, -th + 1.15, -Lg/2, gpg);
      rbox(0.45, 1.9, Lg - 0.2, 0.15, shroudM, 0.22, -th + 1.15, -Lg/2, gpg);
      rbox(0.35, 0.45, Lg - 0.4, 0.1, shroudM, cardH - 0.2, -0.62, -Lg/2, gpg);
      rbox(cardH, th - 0.35, 0.35, 0.12, shroudM, cardH/2, -th/2 - 0.12, -Lg + 0.18, gpg);
      // акцент/подсветка
      if (G.acc === 'rgb') rbox(0.12, 0.35, Lg*0.62, 0.05, PM.rgb, cardH + 0.02, -th + 1.4, -Lg*0.42, gpg);
      else { rbox(0.1, 0.22, Lg*0.55, 0.04, mat({color:G.acc, roughness:0.35, metalness:0.6}), cardH + 0.02, -th + 0.75, -Lg*0.42, gpg); rbox(0.1, 0.18, Lg*0.18, 0.04, PM.led, cardH + 0.02, -th + 1.5, -Lg*0.62, gpg); }
      // вентиляторы
      for (let i = 0; i < nfans; i++) {
        const f = makeFan(fs, {frameless:true, rim:true, n:11, blade:PM.blade, speed:0.75});
        orient(f, '-y'); f.position.set(cardH/2 + 0.1, -th + 0.45, -(0.8 + (Lg - 1.6)*(i + 0.5)/nfans)); gpg.add(f);
      }
      // разъём питания
      const conn16 = G.conn === '16-pin', nConn = G.conn === '2×8-pin' ? 2 : 1;
      const zc = -Lg*0.58;
      for (let k = 0; k < nConn; k++) rbox(0.85, 0.85, conn16 ? 1.95 : 2.15, 0.06, PM.plastic, cardH + 0.25, -1.1, zc - k*2.5, gpg);
      gpuConn = {x:bfx + 0.45 + cardH + 0.7, y:slotY + 0.6 - 1.1, z:zB + zc - (nConn - 1)*1.25, wires: conn16 ? 12 : 8*nConn, span:(conn16 ? 1.95 : 2.15) + (nConn - 1)*2.5};
      // планка
      box(12.0, Math.max(th, 3.6), 0.12, [PM.steel, PM.steel, PM.steel, PM.steel, mat({map:gpuIoTexture(12, Math.max(th, 3.6)), roughness:0.4, metalness:0.8}), PM.steel], 5.6, -Math.max(th, 3.6)/2 + 0.4, 0.45, gpg);
      // винты вокруг GPU на бэкплейте
      inst(cylG(0.17, 0.17, 0.07, 12), PM.steel, 6, (d, i) => { d.position.set(cardH*0.5 + (i % 3 - 1)*1.1, 0.03, -Lg*0.3 + (i < 3 ? 0.9 : -0.9)); }, gpg);
      reg(gpg, 'gpu', V(6 + 16, -7, 0));
      { const vend = G.vendor === 'nv' ? 'NVIDIA' : 'AMD', pw = nConn > 1 ? 'Два разъёма PCIe 8-pin: ' : conn16 ? 'Один разъём 12V-2x6: ' : 'Разъём PCIe 8-pin: ';
        anc('gpu', gpg, cardH/2 + 0.1, -th + 0.2, -(0.8 + (Lg - 1.6)*0.5/nfans), 'Вентиляторы', 'Продувают радиатор видеокарты. Смотрят вниз, потому что карта лежит горизонтально.', {val:`${nfans} шт.`, view:[0.25, -0.85, -0.45]});
        anc('gpu', gpg, cardH + 0.03, -th + 1.15, -Lg*0.82, 'Кожух', 'Пластиковый кожух направляет воздух от вентиляторов через рёбра радиатора.');
        anc('gpu', gpg, cardH + 0.6, -1.4, -Lg*0.22 - 2.6, 'Радиатор и тепловые трубки', 'Никелированные трубки выходят на торец карты. Они разносят тепло от чипа по всей стопке алюминиевых рёбер.');
        anc('gpu', gpg, cardH*0.5, -1.2, -Lg*0.3, 'Графический процессор', `Главный чип ${vend}, он считает картинку. Спрятан под радиатором.`, {inside:true, val:G.label});
        anc('gpu', gpg, cardH*0.74, -1.2, -Lg*0.3 - 3.2, 'Видеопамять', 'Чипы памяти вокруг процессора. В них лежат текстуры и готовые кадры.', {inside:true, val:`${G.vram} ГБ`});
        anc('gpu', gpg, cardH + 0.7, -1.1, zc, 'Разъём питания', pw + (conn16 ? 'питание подаётся от блока питания напрямую или через переходник из комплекта карты.' : 'кабели от блока питания.'), {val:G.conn, view:[1, 0.1, -0.35]});
        anc('gpu', gpg, -0.4, -0.38, -5.2, 'Контакты PCIe x16', 'Золотые контакты входят в верхний слот платы. По ним идут данные и до 75 Вт питания.', {inside:true});
        anc('gpu', gpg, cardH*0.56, 0.06, -Lg*0.45, 'Бэкплейт', 'Металлическая пластина на обратной стороне платы. Не даёт карте прогибаться и отводит часть тепла.', {view:[0.2, 0.9, -0.4]});
        anc('gpu', gpg, 5.6, -Math.max(th, 3.6)/2 + 0.4, 0.55, 'Планка с портами', 'Задняя планка: сюда подключаются мониторы. Три DisplayPort и один HDMI, остальное вентиляционные отверстия.', {view:[0.3, 0.1, 1]});
        if (G.acc !== 'rgb') anc('gpu', gpg, cardH + 0.08, -th + 1.5, -Lg*0.62, 'Светящаяся вставка', 'Небольшой светодиод на торце, виден через стекло корпуса.');
        else anc('gpu', gpg, cardH + 0.08, -th + 1.4, -Lg*0.42, 'Светящаяся полоса', 'RGB-подсветка на торце карты. Цвет задаёт кнопка RGB.'); }
    }

    /* ── охлаждение ── */
    const cg2 = new T.Group(); cg2.position.set(bfx, yS, zS);
    if (cool.type === 'tower') {
      const hgt = cool.height/10, finY = cool.fan === 14 ? 13.6 : 12.4, td = cool.towers === 2 ? 4.6 : 5.0;
      const capM = mat({color:cool.cap, roughness:0.45, metalness:0.4});
      rbox(1.0, 4.2, 4.6, 0.1, PM.nickel, 1.2, 0, 0, cg2);
      for (const zz of [-2.9, 2.9]) rbox(0.35, 7.6, 0.8, 0.1, PM.steel, 0.75, 0, zz, cg2);
      const x0 = cool.towers === 2 ? 4.6 : 3.3, x1 = hgt - 0.55;
      const towerZ = cool.towers === 2 ? [-(td/2 + 1.45), td/2 + 1.45] : [0];
      const finG = geo(`fin${f2(td)},${f2(finY)}`, () => {
        const s = new T.Shape(), hz = td/2, hy = finY/2, tooth = 0.25;
        s.moveTo(-hz, -hy); s.lineTo(hz, -hy);
        for (let i = 0; i < 8; i++) { const y0 = -hy + i*finY/8; s.lineTo(hz - (i % 2 ? tooth : 0), y0 + finY/16); s.lineTo(hz, y0 + finY/8); }
        s.lineTo(-hz, hy); s.lineTo(-hz, -hy);
        const g = new T.ShapeGeometry(s); g.rotateY(-Math.PI/2); return g;
      });
      const nfin = Math.floor((x1 - x0)/0.19);
      for (const tz of towerZ) {
        inst(finG, PM.fin, nfin, (d, i) => { d.position.set(x0 + i*0.19, 0, tz); }, cg2);
        rbox(0.5, finY + 0.2, td + 0.2, 0.12, capM, hgt - 0.25, 0, tz, cg2);
        for (const zz of [-td/2 + 0.6, td/2 - 0.6]) rbox(0.08, finY*0.8, 0.12, 0.03, PM.alu, hgt + 0.01, 0, tz + zz, cg2);
      }
      const np = cool.pipes, ys = Array.from({length:np}, (_, i) => -finY*0.38 + finY*0.76*i/Math.max(1, np - 1));
      const pipes = [];
      ys.forEach((yy, i) => {
        let za, zb;
        if (cool.towers === 2) { za = towerZ[0] + (i % 2 ? 0.8 : -0.8); zb = towerZ[1] + (i % 2 ? -0.8 : 0.8); }
        else { za = -td*0.28; zb = td*0.28; }
        const pts = [V(hgt + 0.15, yy, za), V(x0, yy, za), V(2.0, yy, za*0.8), V(1.1, yy, za*0.35), V(1.1, yy, zb*0.35), V(2.0, yy, zb*0.8), V(x0, yy, zb), V(hgt + 0.15, yy, zb)];
        pipes.push(tubeG(pts, 0.3, 64, 10));
        for (const zz of [za, zb]) cyl(0.3, 0.12, PM.nickel, 'x', hgt + 0.2, yy, zz, cg2, 10);
      });
      mesh(mergeG(pipes), PM.nickel, 0, 0, 0, cg2);
      const fsz = cool.fan || 12;
      const fanZs = cool.towers === 2 ? [0, towerZ[1] + td/2 + 1.35] : [td/2 + 1.35];
      for (const fz of fanZs) { const f = makeFan(fsz, {frame:PM.plastic, blade:PM.blade, pads:true}); f.position.set(x0 + (x1 - x0)/2 + 0.2, 0, fz); cg2.add(f); }
      for (const fz of fanZs) for (const yy of [fsz/2 - 0.3, -fsz/2 + 0.3]) mesh(own(tubeG([V(x0 + 1, yy, fz - 1.3), V(x0 + (x1 - x0)/2, yy + Math.sign(yy)*0.4, fz - 1.4), V(x1 - 1, yy, fz - 1.3)], 0.05, 16, 5)), PM.steel, 0, 0, 0, cg2);
      { const za0 = cool.towers === 2 ? towerZ[0] - 0.8 : -td*0.28;
        anc('cooler', cg2, x0 + (x1 - x0)/2, finY*0.3, towerZ[0] - td/2, cool.towers === 2 ? 'Две башни радиатора' : 'Радиатор', 'Стопка тонких алюминиевых пластин. Тепло от трубок растекается по ним, а вентилятор продувает воздух сквозь.', {val:`до ${cool.tdp} Вт`});
        anc('cooler', cg2, 2.0, ys[0], za0*0.8, 'Тепловые трубки', `${np} медных трубок с каплей жидкости внутри. Она испаряется у основания, несёт тепло вверх и конденсируется на пластинах.`, {val:`${np} шт.`});
        anc('cooler', cg2, 1.2, -1.0, 2.3, 'Основание', 'Никелированная пластина. Прижимается к крышке процессора через слой термопасты и забирает тепло.', {inside:true});
        anc('cooler', cg2, x0 + (x1 - x0)/2 + 0.2, fsz/2 - 0.1, fanZs[0], fanZs.length > 1 ? 'Вентиляторы' : 'Вентилятор', 'Гонит воздух сквозь пластины радиатора. Закреплён на башне двумя проволочными скобами.', {val:`${fanZs.length} × ${fsz*10} мм`});
        anc('cooler', cg2, hgt + 0.05, 0, towerZ[0], 'Верхняя крышка', 'Закрывает торцы пластин и трубок. Она же даёт кулеру законченный вид.');
        anc('cooler', cg2, 0.95, 3.8, -2.9, 'Скоба крепления', 'Прижимает основание к процессору и закручивается винтами через плату.'); }
    } else if (cool.type === 'low') {
      rbox(0.8, 4.0, 4.4, 0.1, PM.copper, 1.1, 0, 0, cg2);
      inst(planeG(2.8, 9.6), PM.fin, 52, (d, i) => { d.rotation.x = Math.PI/2; d.position.set(2.9, -4.7 + i*0.185, 0); }, cg2);
      const pipes = [];
      for (let k = 0; k < cool.pipes; k++) { const zz = -2.0 + k*1.0; pipes.push(tubeG([V(1.3, -4.6, zz), V(1.6, -1.5, zz), V(1.4, 0, zz), V(1.6, 1.5, zz), V(1.3, 4.6, zz)], 0.27, 32, 8)); }
      mesh(mergeG(pipes), PM.nickel, 0, 0, 0, cg2);
      const f = orient(makeFan(12, {frame:PM.plastic, blade:PM.blade}), 'x'); f.position.set(5.6, 0, 0); cg2.add(f);
      anc('cooler', cg2, 2.9, 4.8, 1.4, 'Радиатор', 'Низкий блок алюминиевых пластин. Подходит для небольших корпусов: не упирается в боковую стенку.', {val:`до ${cool.tdp} Вт`});
      anc('cooler', cg2, 1.6, 1.5, 0.2, 'Тепловые трубки', `${cool.pipes} медных трубок отводят тепло от основания к пластинам.`, {val:`${cool.pipes} шт.`});
      anc('cooler', cg2, 1.1, 0, 2.2, 'Основание', 'Медная пластина. Прижимается к крышке процессора через слой термопасты.', {inside:true});
      anc('cooler', cg2, 5.9, 5.9, 0, 'Вентилятор', 'Дует вдоль платы и обдувает не только радиатор, но и соседние элементы питания.', {val:'120 мм'});
    } else {
      const big = cool.rad === 360;
      const headM = mat({color:0x141517, roughness:0.35, metalness:0.5});
      if (big) {
        rbox(3.0, 7.2, 7.2, 1.2, headM, 2.2, 0, 0, cg2);
        rbox(0.2, 6.0, 6.0, 1.0, mat({color:0x050506, roughness:0.05, metalness:0.9}), 3.75, 0, 0, cg2);
        for (let k = 0; k < 4; k++) { const r = 2.5 - k*0.32; const m = mesh(torusG(r, 0.06, 60), k === 0 ? PM.rgb : PM.diff, 3.72 - k*0.18, 0, 0, cg2); m.rotation.y = Math.PI/2; }
      } else {
        rbox(2.6, 6.0, 8.0, 0.9, headM, 2.0, 0, 0, cg2);
        rbox(0.15, 4.6, 6.4, 0.6, mat({color:0x0c0d0f, roughness:0.25, metalness:0.7}), 3.32, 0, 0, cg2);
        const f = makeFan(3.6, {frameless:true, n:7}); f.position.set(2.0, 0, -4.2); cg2.add(f);
        rbox(0.1, 0.25, 5.0, 0.05, PM.rgb, 3.4, -1.8, 0.4, cg2);
      }
      for (const yy of [-1.3, 1.3]) { cyl(0.62, 1.4, PM.steel, 'z', 2.0, yy, big ? 3.9 : 4.3, cg2, 18); }
      anc('cooler', cg2, big ? 3.9 : 3.4, 0, 0, 'Помпа и водоблок', 'Сидит на процессоре: внутри помпа гоняет жидкость, а медная пластина снизу забирает тепло. Экран можно подсвечивать.', {val:big ? 'СЖО 360 мм' : 'СЖО 240 мм'});
      anc('cooler', cg2, 2.0, 1.3, big ? 4.3 : 4.7, 'Патрубки', 'Сюда подключаются шланги. Поворотные, чтобы шланги можно было направить в нужную сторону.', {inside:false});
    }
    reg(cg2, 'cooler', V(6 + 22, 0, 0));

    if (cool.type === 'aio') {
      const len = cool.rad === 360 ? 39.5 : 27.5, n = cool.rad/120;
      const rg3 = new T.Group();
      const tankM = mat({color:0x17181b, roughness:0.45, metalness:0.5});
      const fanO = {rgb:true, frame:fanFrame, blade:fanBlade};
      let pa, ex;
      const aioAnc = (rx, ry, rz, fp) => {
        anc('cooler', rg3, rx + 6.15, ry, rz, 'Радиатор', 'Узкие каналы с жидкостью и тонкие пластины между ними. Сюда приходит тёплая жидкость, а вентиляторы её остужают.', {val:`${cool.rad} мм`});
        anc('cooler', rg3, fp.x + 6.1, fp.y, fp.z, 'Вентиляторы радиатора', `${n} вентилятор${n > 1 ? 'а' : ''} по 120 мм обдувают радиатор. Забирают воздух снаружи корпуса и вытесняют тёплый.`, {val:`${n} × 120 мм`});
      };
      const core = (w, h2, d2, x, y2, z2) => { const ft = rep(radTex, 5, Math.max(w, d2)/1.4); const fm = mat({color:0xffffff, map:ft, roughness:0.6, metalness:0.4}); box(w, h2, d2, fm, x, y2, z2, rg3); };
      if (bottomRad) {
        const rx = midX, ry = t + 0.4 + 1.35, rz = D/2 - t - 1.2 - len/2;
        core(12.0, 2.7, len - 3.2, rx, ry, rz);
        for (const zz of [rz + len/2 - 0.8, rz - len/2 + 0.8]) rbox(12.4, 3.0, 1.6, 0.3, tankM, rx, ry, zz, rg3);
        for (let i = 0; i < n; i++) { const f = orient(makeFan(12, fanO), 'y'); f.position.set(rx, ry + 1.35 + 1.3, rz + len/2 - 1.75 - 12*(i + 0.5)); rg3.add(f); }
        pa = V(rx - 3.5, ry + 1.6, rz + len/2 - 0.8); ex = V(0, -10, 0);
        aioAnc(rx, ry, rz, V(rx, ry + 2.65, rz + len/2 - 1.75 - 6));
      } else if (frontRad) {
        const rx = 0.3, rz = -D/2 + 1.2 + 1.35, ry = t + 1.0 + len/2;
        core(12.0, len - 3.2, 2.7, rx, ry, rz);
        for (const yy of [ry + len/2 - 0.8, ry - len/2 + 0.8]) rbox(12.4, 1.6, 3.0, 0.3, tankM, rx, yy, rz, rg3);
        for (let i = 0; i < n; i++) { const f = makeFan(12, fanO); f.position.set(rx, ry - len/2 + 1.75 + 12*(i + 0.5), rz + 1.35 + 1.3); rg3.add(f); }
        pa = V(rx - 3.5, ry + len/2 - 0.8, rz + 1.6); ex = V(0, 0, -14);
        aioAnc(rx, ry, rz, V(rx, ry - len/2 + 1.75 + 6, rz + 2.65));
      } else {
        const rx = Math.min(bfx + 11.5, W/2 - 0.45 - 6.4), ry = H - t - 0.2 - 1.35;
        const rz = len > D - 2*t - 1 ? 0 : -D/2 + t + 0.4 + len/2;
        core(12.0, 2.7, len - 3.2, rx, ry, rz);
        for (const zz of [rz + len/2 - 0.8, rz - len/2 + 0.8]) rbox(12.4, 3.0, 1.6, 0.3, tankM, rx, ry, zz, rg3);
        for (let i = 0; i < n; i++) { const f = orient(makeFan(12, fanO), 'y'); f.position.set(rx, ry - 1.35 - 1.3, rz + len/2 - 1.75 - 12*(i + 0.5)); rg3.add(f); }
        pa = V(rx - 3.5, ry - 1.5, rz + len/2 - 0.8); ex = V(0, 14, 0);
        aioAnc(rx, ry, rz, V(rx, ry - 2.65, rz + len/2 - 1.75 - 6));
      }
      reg(rg3, 'cooler', ex);
      const tg = new T.Group(), tubes = [];
      const big = cool.rad === 360;
      [-1.3, 1.3].forEach((yy, k) => {
        const a = V(bfx + 2.0, yS + yy, zS + (big ? 4.6 : 5.0));
        const e = pa.clone().add(V(k*1.6, 0, 0));
        const m1 = V(a.x + 3.5, a.y + 2, a.z + 3);
        const m2 = V((m1.x + e.x)/2 + 2, (m1.y + e.y)/2 + 3, (m1.z + e.z)/2);
        tubes.push(tubeG([a, V(a.x + 1, a.y, a.z + 1.5), m1, m2, V(e.x, e.y + (e.y > a.y ? -2.5 : 2.5), e.z), e], 0.5, 64, 12));
        if (k === 0) anc('cooler', tg, m1.x, m1.y, m1.z, 'Шланги', 'Две оплётки: по одной жидкость идёт к радиатору, по другой возвращается к помпе. Оплётка защищает от перегибов.');
        cyl(0.62, 1.2, PM.steel, 'y', e.x, e.y + (e.y > a.y ? -0.6 : 0.6), e.z, tg, 18);
      });
      const tLen = 30;
      mesh(mergeG(tubes), sleeveMat(tLen), 0, 0, 0, tg);
      reg(tg, 'cooler', V(0,0,0), {hide:true});
    }

    /* ── блок питания ── */
    const pg = new T.Group();
    const pt = psuTextures(b.psu);
    const pb = mat({color:0x17181b, roughness:0.5, metalness:0.45});
    const [pw, ph, pd] = psuDims;
    rbox(pw, pano ? ph : ph - 0.3, pd, 0.25, pb, psuX, pano ? psuY : psuY + 0.15, psuZ, pg);
    if (pano) {
      plane(ph*0.9, pw*0.8, mat({map:pt.rear, roughness:0.5}), '+z', psuX, psuY, psuZ + pd/2 + 0.01, pg).rotation.z = Math.PI/2;
    } else {
      plane(Math.min(pd - 2, 11), Math.min(ph - 1.6, 6), mat({map:pt.label, roughness:0.55}), '+x', psuX + pw/2 + 0.005, psuY, psuZ, pg);
      plane(pw*0.9, ph*0.85, mat({map:pt.rear, roughness:0.5}), itx ? '-z' : '+z', psuX, psuY, itx ? psuZ - pd/2 - 0.005 : psuZ + pd/2 + 0.005, pg);
      plane(pw*0.9, ph*0.85, mat({map:pt.front, roughness:0.5}), itx ? '+z' : '-z', psuX, psuY, itx ? psuZ + pd/2 + 0.005 : psuZ - pd/2 - 0.005, pg);
      { // нижняя крышка с круглым окном, вентилятор и защитная решётка
        const fs = Math.min(pw, pd)*0.8, yB = psuY - ph/2;
        const sh = roundRect(new T.Shape(), -pw/2, -pd/2, pw, pd, 0.5); sh.holes.push(circPath(0, 0, fs*0.5));
        const pl = own(new T.ExtrudeGeometry(sh, {depth:0.3, bevelEnabled:false, curveSegments:40}));
        pl.rotateX(-Math.PI/2);
        mesh(pl, pb, psuX, yB, psuZ, pg);
        const f = orient(makeFan(fs, {frameless:true, blade:PM.blade, n:9, speed:0.7}), '-y'); f.position.set(psuX, yB + 0.15, psuZ); pg.add(f);
        for (let r = 1.4; r < fs*0.5; r += 1.25) mesh(torusG(r, 0.05, 48), PM.steel, psuX, yB - 0.04, psuZ, pg).rotation.x = Math.PI/2;
        for (let k = 0; k < 4; k++) box(fs, 0.08, 0.08, PM.steel, psuX, yB - 0.04, psuZ, pg).rotation.y = k*Math.PI/4;
        const Q = b.psu, rz = itx ? -1 : 1, ez = itx ? psuZ - pd/2 - 0.02 : psuZ + pd/2 + 0.02, fz = itx ? psuZ + pd/2 + 0.02 : psuZ - pd/2 - 0.02;
        anc('psu', pg, psuX + pw/2 + 0.02, psuY + ph*0.28, psuZ - Math.min(pd - 2, 11)*0.38, `Блок питания ${Q.watt} Вт`, 'Наклейка с характеристиками: мощность и допустимые токи по линиям. Сертификат 80 PLUS показывает КПД: чем выше уровень, тем меньше энергии уходит в тепло.', {val:`${Q.watt} Вт · ${Q.cert} · ${Q.form}`});
        anc('psu', pg, psuX + rz*0.31*pw*0.9, psuY + 0.16*ph*0.85, ez, 'Розетка 220 В', 'Сюда вставляется сетевой шнур. Находится на задней стенке корпуса компьютера.');
        anc('psu', pg, psuX + rz*0.31*pw*0.9, psuY - 0.17*ph*0.85, ez, 'Выключатель', 'Полностью обесточивает блок. Перед тем как лезть внутрь компьютера, выключи его здесь и вытащи вилку из розетки.');
        anc('psu', pg, psuX, psuY - ph/2 - 0.1, psuZ, 'Вентилятор', 'Продувает блок насквозь. При небольшой нагрузке многие блоки останавливают вентилятор и работают беззвучно.');
        anc('psu', pg, psuX, psuY, fz, Q.modular ? 'Разъёмы для кабелей' : 'Несъёмные кабели', Q.modular ? 'Модульный блок: сюда подключаются только нужные кабели, поэтому в корпусе меньше лишней проводки.' : 'У этого блока кабели припаяны и выходят прямо из корпуса. Лишние убрать нельзя, их придётся аккуратно прятать.', {view:[0.2, 0.15, -1]}); }
    }
    reg(pg, 'psu', pano ? V(-24, 0, 0) : itx ? V(0, 16, 0) : V(28, -2, 0));
    if (pano) anc('psu', pg, psuX, psuY, psuZ + psuDims[2]/2 + 0.02, `Блок питания ${b.psu.watt} Вт`, 'В панорамном корпусе блок стоит вертикально у задней стенки. Здесь розетка 220 В и выключатель.', {val:`${b.psu.watt} Вт · ${b.psu.cert} · ${b.psu.form}`, view:[0.3, 0.1, 1]});

    /* ── кабели ── */
    const cg3 = new T.Group();
    const wireR = 0.2, pitch = 0.42;
    function bundle(rows, cols, path, lenGuess){
      const list = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) list.push(tubeG(path(r - (rows - 1)/2, c - (cols - 1)/2), wireR, 40, 6));
      mesh(mergeG(list), sleeveMat(lenGuess), 0, 0, 0, cg3);
    }
    // 24-pin: из разъёма к ближней прорези в лотке
    { const xc = bfx + 1.4, zg = zFrontB - 1.9;
      bundle(12, 2, (r, c) => {
        const yy = y24 + r*pitch, zz = z24 + c*pitch;
        return [V(xc, yy, zz), V(xc + 1.1, yy, zz), V(xc + 2.4 - c*pitch, yy, zz - 1.0), V(xc + 2.0 - c*pitch, yy, zg + 0.9), V(trayX + 0.9, yy, zg - c*pitch*0.5), V(trayX - 1.2, yy, zg - c*pitch*0.5)];
      }, 8);
      rbox(0.9, 5.4, 1.0, 0.06, PM.plastic, bfx + 1.8, y24, z24, cg3);
    }
    // EPS: вверх через верхнюю прорезь
    { const xc = bfx + 1.4, ytop = yTop + (H - t - yTop)/2;
      bundle(2, 4, (r, c) => {
        const yy = yEPS + r*pitch, zz = zEPS + c*pitch;
        return [V(xc, yy, zz), V(xc + 1.0, yy, zz), V(xc + 1.6 - r*pitch, yEPS + 1.4, zz), V(xc + 1.0 - r*pitch, ytop, zz), V(trayX + 0.8, ytop + r*0.2, zz), V(trayX - 1.2, ytop + r*0.2, zz)];
      }, 6);
      rbox(0.9, 0.95, 1.9, 0.06, PM.plastic, bfx + 1.8, yEPS, zEPS, cg3);
    }
    // питание видеокарты
    if (gpuConn) {
      const c = gpuConn, cols = c.wires/2;
      const xs = Math.min(W/2 - 1.6, c.x + 2.2);
      let sink;
      if (tower) sink = V(W/2 - 3.2, sh + 0.3, Math.min(D/2 - t - psuD[2] - 4, Math.max(zFrontSh + 2.5, c.z)));
      else if (pano) sink = V(trayX + 0.3, Math.max(4, slotY - 12), c.z);
      else sink = V(psuX, psuY - psuD[1]/2 - 0.2, psuZ);
      bundle(2, cols, (r, cc) => {
        const yy = c.y + r*pitch, zz = c.z + cc*(c.span/cols);
        const p = [V(c.x - 0.3, yy, zz), V(c.x + 0.8, yy, zz), V(xs - r*pitch, yy - 1.6, zz), V(xs - r*pitch, (yy + sink.y)/2, (zz + sink.z)/2)];
        if (tower) p.push(V(sink.x + 0.5 - r*pitch, sink.y + 2.0, sink.z + cc*0.2), V(sink.x + 0.5 - r*pitch, sink.y - 1.5, sink.z + cc*0.2));
        else if (pano) p.push(V(sink.x + 1.5, sink.y, sink.z + cc*0.25), V(sink.x - 1.5, sink.y, sink.z + cc*0.25));
        else p.push(V(sink.x + r*pitch, sink.y + 0.6, sink.z + cc*0.25 - 1), V(sink.x + r*pitch, sink.y + 0.1, sink.z + cc*0.25 - 1));
        return p;
      }, 6);
      if (tower) rbox(3.0, 0.08, 4.4, 0.6, PM.hole, sink.x + 0.4, sh + 0.27, sink.z + 0.4, cg3);
    }
    reg(cg3, 'psu', V(0, 0, 0), {hide:true});

    /* финал */
    root.traverse(o => { if (o.isMesh) { const m = Array.isArray(o.material) ? o.material[0] : o.material; o.castShadow = !(m && m.transparent); o.receiveShadow = true; } });
    root.position.y = -H/2;
    ground.position.y = -H/2 - 0.9; blob.position.y = -H/2 - 0.88;
    blob.scale.set(Math.max(W, D)*2.4, Math.max(W, D)*2.4, 1);
    glowA.position.set(0, H*0.2, -D/2 + 4); glowB.position.set(midX, H*0.25, D/2 - 5);
    fillIn.position.set(W/2 + 6, H*0.62, -2);
    fitDist = Math.max(H*1.15, D*1.1, W*1.5) * 2.3;
    if (fit || C.id !== lastCase) fitting = true;
    lastCase = C.id;
    lastIssues = evaluate(b);
    updateErrorHelpers();
    highlightOpenInner();
    applyRgbInner();
    refreshOverlays();
  }

  /* подсветка выбранного */
  const mkHelper = (color, op) => { const h = new T.BoxHelper(new T.Object3D(), color); h.material.depthTest = false; h.material.transparent = true; h.material.opacity = op; h.renderOrder = 10; h.visible = false; scene.add(h); return h; };
  const hoverH = mkHelper(0xe48b4f, 1), openH = mkHelper(0xe48b4f, 0.55);
  let errH = [];
  const tmpBox = new T.Box3();
  function setHelper(h, cat){
    const gs = cat ? (groups[cat] || []).filter(g => !hideOnExplode.includes(g)) : [];
    if (!gs.length || (cat === 'case' && h !== hoverH)) { h.visible = false; h.userData.target = null; return; }
    h.userData.target = gs; h.visible = true; updateHelper(h);
  }
  function updateHelper(h){
    const gs = h.userData.target; if (!gs) return;
    tmpBox.makeEmpty(); for (const g of gs) tmpBox.expandByObject(g);
    const pos = h.geometry.attributes.position, a = pos.array, mn = tmpBox.min, mx = tmpBox.max;
    const c = [[mx.x,mx.y,mx.z],[mn.x,mx.y,mx.z],[mn.x,mn.y,mx.z],[mx.x,mn.y,mx.z],[mx.x,mx.y,mn.z],[mn.x,mx.y,mn.z],[mn.x,mn.y,mn.z],[mx.x,mn.y,mn.z]];
    for (let i = 0; i < 8; i++) { a[i*3] = c[i][0]; a[i*3+1] = c[i][1]; a[i*3+2] = c[i][2]; }
    pos.needsUpdate = true; h.geometry.computeBoundingSphere();
  }
  function updateErrorHelpers(){
    for (const h of errH) { scene.remove(h); h.geometry.dispose(); h.material.dispose(); }
    errH = [];
    const marks = new Set(lastIssues.filter(i => i.level === 'error' && i.mark).map(i => i.mark));
    for (const cat of marks) { const h = mkHelper(0xf05a48, 0.95); setHelper(h, cat); errH.push(h); }
  }
  function highlightOpenInner(){ setHelper(openH, S.open); }

  function applyRgbInner(){
    const v = S.rgb;
    if (v === 'off') {
      PM.rgb.color.copy(lin(0x2a2d32)); PM.diff.emissive.setRGB(0,0,0); PM.rgbBlade.emissive.setRGB(0,0,0); glowA.intensity = glowB.intensity = 0;
    } else if (v !== 'rainbow') {
      const c = lin(v); PM.rgb.color.copy(c); PM.diff.emissive.copy(c); PM.rgbBlade.emissive.copy(c);
      glowA.color.set(v); glowB.color.set(v); glowA.intensity = glowB.intensity = 1.3;
    } else glowA.intensity = glowB.intensity = 1.3;
  }


  /* ───── осмотр: номера на деталях, легенда, подписи ───── */
  const pinsEl = $('#pins'), legendEl = $('#legend'), legendList = $('#legendList');
  // с какой стороны смотреть на деталь и что оставить на сцене, пока она в осмотре
  const INSPECT_VIEW = {case:[0.78, 0.40, -0.48], cpu:[0.92, 0.28, -0.28], mb:[1, 0.22, -0.22], cooler:[0.9, 0.28, -0.38], ram:[0.92, 0.25, -0.3], gpu:[0.62, 0.42, -0.66], ssd:[0.95, 0.3, -0.25], psu:[0.7, 0.22, -0.68]};
  const INSPECT_SHOW = {case:['case'], mb:['mb'], cpu:['mb', 'cpu'], ram:['mb', 'ram'], ssd:['mb', 'ssd'], gpu:['gpu'], cooler:['mb', 'cpu', 'cooler'], psu:['psu']};
  const occRay = new T.Raycaster();
  const _w = new T.Vector3(), _p = new T.Vector3(), _d = new T.Vector3();
  let inspecting = null, showSet = new Set(), inspectAnchors = [], pinNodes = [], tagNodes = [], labelsOn = false, fly = null, frameNo = 0, visCache = [];
  const isVis = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const anchorWorld = (a, out) => { a.group.updateWorldMatrix(true, false); return a.group.localToWorld(out.copy(a.local)); };
  const easeIO = k => k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;

  function occluded(a, ignoreOwn){
    anchorWorld(a, _w);
    _d.copy(_w).sub(camera.position); const dist = _d.length(); _d.divideScalar(dist);
    occRay.set(camera.position, _d); occRay.near = 0; occRay.far = Math.max(0, dist - 0.2);
    for (const h of occRay.intersectObjects(visCache, false)) {
      const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      if (m && m.alphaTest > 0) continue;
      if (ignoreOwn) { let o = h.object, mine = false; while (o) { if (o === a.group) { mine = true; break; } o = o.parent; } if (mine) continue; }
      return true;
    }
    return false;
  }
  function overview(cat){
    root.updateMatrixWorld(true);
    const bx = new T.Box3();
    for (const g of groups[cat] || []) if (!g.userData.hide || cat === 'cooler') bx.expandByObject(g);
    if (bx.isEmpty()) return null;
    const diag = bx.getSize(new T.Vector3()).length(), half = T.MathUtils.degToRad(camera.fov/2);
    // подбираем расстояние так, чтобы деталь влезла в свободную часть окна (без легенды и панели кнопок)
    const r = stage.getBoundingClientRect(), mob = matchMedia('(max-width: 960px)').matches;
    let fw = r.width - 16, fh = r.height - 100;
    if (inspecting || cat) { if (mob) fh -= r.height*0.4; else fw -= Math.min(280, r.width*0.46) + 24; }
    // масштаб на экране: пикселей на см = высота окна / (2·d·tan(половина угла)); деталь (шар радиуса R) должна влезть в свободный квадрат
    const dist = diag*0.5*0.95*r.height/(Math.tan(half)*Math.max(120, Math.min(fw, fh)));
    return {center:bx.getCenter(new T.Vector3()), diag, dist:Math.max(10, dist)};
  }
  function flyTo(center, dist, dir){
    const off = camera.position.clone().sub(controls.target), d0 = off.length(), u0 = off.clone().normalize();
    const u1 = dir ? V(dir[0], dir[1], dir[2]).normalize() : u0.clone();
    fly = {k:0, dur:reduceMotion ? 0.001 : 0.85, t0:controls.target.clone(), t1:center.clone(), d0, d1:dist, u0, q:new T.Quaternion().setFromUnitVectors(u0, u1)};
    fitting = false;
  }
  function stepFly(dt){
    if (!fly) return;
    fly.k = Math.min(1, fly.k + dt/fly.dur);
    const e = easeIO(fly.k);
    controls.target.lerpVectors(fly.t0, fly.t1, e);
    const dir = fly.u0.clone().applyQuaternion(new T.Quaternion().slerp(fly.q, e));
    camera.position.copy(controls.target).addScaledVector(dir, fly.d0 + (fly.d1 - fly.d0)*e);
    if (fly.k >= 1) fly = null;
  }

  // пока открыта легенда, модель сдвигается в свободную часть окна
  let viewShiftX = 0, viewShiftY = 0;
  function updateViewShift(dt){
    let tx = 0, ty = 0;
    if (inspecting && !legendEl.hidden) { if (matchMedia('(max-width: 960px)').matches) ty = legendEl.offsetHeight/2 + 6; else tx = legendEl.offsetWidth/2 + 10; }
    const k = Math.min(1, dt*7);
    viewShiftX += (tx - viewShiftX)*k; viewShiftY += (ty - viewShiftY)*k;
    if (!tx && !ty && Math.abs(viewShiftX) + Math.abs(viewShiftY) < 0.4) {
      if (viewShiftX || viewShiftY || (camera.view && camera.view.enabled)) { viewShiftX = viewShiftY = 0; camera.clearViewOffset(); }
    } else { const r = stage.getBoundingClientRect(); camera.setViewOffset(r.width, r.height, viewShiftX, viewShiftY, r.width, r.height); }
  }
  function clearPins(){ for (const n of pinNodes) n.el.remove(); pinNodes = []; }
  function clearTags(){ for (const n of tagNodes) n.el.remove(); tagNodes = []; }
  function setHot(i){
    pinNodes.forEach((n, k) => { n.el.dataset.hot = String(k === i); });
    legendList.querySelectorAll('li').forEach((li, k) => { li.dataset.hot = String(k === i); });
  }
  function buildPins(){
    clearPins();
    inspectAnchors.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'pin'; el.textContent = String(i + 1); el.title = a.name;
      if (a.inside) el.dataset.inside = 'true';
      el.addEventListener('pointerenter', () => setHot(i));
      el.addEventListener('pointerleave', () => setHot(-1));
      el.addEventListener('click', () => focusAnchor(i));
      pinsEl.appendChild(el); pinNodes.push({el, a});
    });
  }
  function renderLegend(){
    const p = build()[inspecting];
    $('#legendCat').textContent = CAT_NAME[inspecting];
    $('#legendTitle').textContent = p.name;
    legendList.innerHTML = inspectAnchors.map((a, i) => `<li data-i="${i}"><span class="n">${i + 1}</span><div><strong>${esc(a.name)}</strong><span class="d">${esc(a.desc)}</span>${a.val ? `<span class="v">${esc(a.val)}</span>` : ''}</div></li>`).join('');
    legendEl.hidden = false;
  }
  legendList.addEventListener('click', e => { const li = e.target.closest('li'); if (li) focusAnchor(+li.dataset.i); });
  legendList.addEventListener('pointerover', e => { const li = e.target.closest('li'); if (li) setHot(+li.dataset.i); });
  legendList.addEventListener('pointerleave', () => setHot(-1));
  function focusAnchor(i){
    const a = inspectAnchors[i]; if (!a) return;
    const o = overview(inspecting);
    anchorWorld(a, _w);
    flyTo(_w.clone(), a.zoom || Math.min(40, Math.max(7, (o ? o.diag : 30)*0.4)), a.view || INSPECT_VIEW[inspecting]);
    setHot(i);
  }
  function buildTags(){
    clearTags();
    if (!labelsOn || inspecting) return;
    const bb = build();
    for (const cat of Object.keys(CAT_NAME)) {
      const a = (anchors[cat] || [])[0]; if (!a) continue;
      const el = document.createElement('div');
      el.className = 'ptag';
      el.innerHTML = `${esc(CAT_NAME[cat])}<small>${esc(bb[cat].label || bb[cat].name)}</small>`;
      el.addEventListener('click', () => { S.open = cat; render(); highlightOpenInner(); });
      pinsEl.appendChild(el); tagNodes.push({el, a, cat});
    }
  }
  function refreshOverlays(){
    if (inspecting) {
      if (!anchors[inspecting] || !groups[inspecting]) {
        inspecting = null; stage.classList.remove('inspecting'); showSet = new Set(); inspectAnchors = []; clearPins(); legendEl.hidden = true; controls.minDistance = 22; controls.maxPolarAngle = POLAR_MAX; onInspect(null);
      } else { inspectAnchors = anchors[inspecting]; buildPins(); renderLegend(); }
    }
    buildTags();
  }
  function inspect(cat){
    const list = anchors[cat];
    if (!groups[cat] || !list || !list.length) {
      toast(`«${CAT_NAME[cat]}»: в этой сборке осматривать нечего`);
      if (inspecting) exitInspect(); else onInspect(null);
      return;
    }
    const first = inspecting !== cat;
    S.explode = false; explodeK = 0;
    for (const g of explodables) g.position.copy(g.userData.base);
    inspecting = cat; stage.classList.add('inspecting'); showSet = new Set(INSPECT_SHOW[cat] || [cat]);
    inspectAnchors = list; clearTags(); buildPins(); renderLegend();
    controls.minDistance = 3; controls.maxPolarAngle = Math.PI * 0.9;
    if (first) { const o = overview(cat); if (o) flyTo(o.center, o.dist, INSPECT_VIEW[cat]); }
    onInspect(cat);
  }
  function exitInspect(){
    if (!inspecting) return;
    inspecting = null; stage.classList.remove('inspecting'); showSet = new Set(); inspectAnchors = [];
    clearPins(); legendEl.hidden = true; controls.minDistance = 22; controls.maxPolarAngle = POLAR_MAX;
    flyTo(V(0, 0, 0), fitDist*(S.explode ? 1.3 : 1), null);
    buildTags(); onInspect(null);
  }
  function setLabels(on){ labelsOn = !!on; buildTags(); }

  // номера и подписи каждый кадр прикрепляются к деталям; перекрытие считается раз в несколько кадров
  function updateOverlay(){
    if (!pinNodes.length && !tagNodes.length) return;
    const r = stage.getBoundingClientRect(), w = r.width, h = r.height;
    const doOcc = frameNo++ % 6 === 0;
    if (doOcc) visCache = pickables.filter(isVis);
    for (const n of pinNodes) {
      anchorWorld(n.a, _w); _p.copy(_w).project(camera);
      const x = (_p.x*0.5 + 0.5)*w, y = (-_p.y*0.5 + 0.5)*h;
      const vis = _p.z < 1 && x > -30 && x < w + 30 && y > -30 && y < h + 30;
      n.el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      n.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      if (doOcc) n.el.dataset.on = String(!occluded(n.a, !!n.a.inside));
    }
    const shown = [];
    for (const n of tagNodes) {
      anchorWorld(n.a, _w); _p.copy(_w).project(camera);
      const x = (_p.x*0.5 + 0.5)*w + 14, y = (-_p.y*0.5 + 0.5)*h - 18;
      const vis = _p.z < 1 && x > -10 && x < w - 40 && y > 0 && y < h;
      if (doOcc) n.occ = occluded(n.a, true);
      const on = vis && !n.occ;
      n.el.style.display = vis ? '' : 'none';
      n.el.dataset.on = String(on);
      if (on) shown.push({n, x, y});
      else if (vis) n.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
    shown.sort((a, b) => a.y - b.y);
    for (let i = 1; i < shown.length; i++) {
      for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) if (Math.abs(shown[i].y - shown[j].y) < 40 && Math.abs(shown[i].x - shown[j].x) < 200) { shown[i].y = shown[j].y + 40; moved = true; }
        if (!moved) break;
      }
    }
    for (const s of shown) s.n.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`;
  }

  /* взаимодействие */
  const ray = new T.Raycaster(), ptr = new T.Vector2();
  const tip = $('#tip');
  let hoverCat = null, down = null;
  function pick(ev){
    const r = canvas.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(pickables.filter(isVis), false);
    for (const hit of hits) {
      const m = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
      if (m && m.alphaTest > 0) continue;
      let o = hit.object; while (o && !o.userData.cat) o = o.parent;
      if (o) return o.userData.cat;
    }
    return null;
  }
  canvas.addEventListener('pointermove', ev => {
    if (ev.pointerType !== 'mouse' || ev.buttons) { tip.hidden = true; return; }
    const cat = pick(ev);
    if (cat !== hoverCat) { hoverCat = cat; setHelper(hoverH, cat); }
    canvas.style.cursor = cat ? 'pointer' : 'grab';
    if (cat) {
      const bb = build(), r = stage.getBoundingClientRect();
      tip.innerHTML = `<small>${CAT_NAME[cat]}</small>${esc(bb[cat].name)}`;
      tip.hidden = false;
      tip.style.left = Math.min(ev.clientX - r.left, r.width - 280) + 'px';
      tip.style.top = Math.min(ev.clientY - r.top, r.height - 70) + 'px';
    } else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { hoverCat = null; setHelper(hoverH, null); tip.hidden = true; });
  canvas.addEventListener('pointerdown', ev => { down = {x:ev.clientX, y:ev.clientY}; fitting = false; fly = null; });
  canvas.addEventListener('wheel', () => { fitting = false; fly = null; }, {passive:true});
  canvas.addEventListener('pointerup', ev => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y); down = null;
    if (moved > 6) return;
    const cat = pick(ev);
    if (!cat) return;
    S.open = cat; render(); highlightOpenInner();
    const el = document.getElementById('cat-' + cat);
    if (el && matchMedia('(min-width: 961px)').matches) el.scrollIntoView({block:'nearest', behavior: reduceMotion ? 'auto' : 'smooth'});
    else toast(`Открыл «${CAT_NAME[cat]}» в списке ниже`);
  });

  function resetView(){
    if (inspecting) { const o = overview(inspecting); if (o) flyTo(o.center, o.dist, INSPECT_VIEW[inspecting]); return; }
    const d = fitDist * (S.explode ? 1.3 : 1);
    camera.position.set(d*0.70, d*0.30, -d*0.65);
    controls.target.set(0, 0, 0); controls.update();
  }
  function resize(){
    const r = stage.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.fov = camera.aspect < 0.9 ? 38 : 30;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);

  rebuild(true); resize(); resetView();

  let last = performance.now();
  const ease = k => k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;
  function loop(now){
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const target = S.explode ? 1 : 0;
    explodeK += (target - explodeK) * Math.min(1, dt * (reduceMotion ? 30 : 4.5));
    if (Math.abs(target - explodeK) < 0.001) explodeK = target;
    const e = ease(explodeK);
    for (const g of explodables) {
      g.position.copy(g.userData.base).addScaledVector(g.userData.ex, e);
      let vis = true;
      if (g.userData.hide) vis = explodeK < 0.04;
      if (g === glassGroup) vis = S.glass && explodeK < 0.3 && (!inspecting || inspecting === 'case');
      else if (inspecting) { const c = g.userData.cat; vis = vis && !!c && showSet.has(c) && !(g.userData.hide && inspecting !== 'cooler'); }
      g.visible = vis;
    }
    const sp = reduceMotion ? 1.5 : 9;
    for (const s of spinners) s.obj.rotation.z += sp * s.speed * dt;
    if (S.rgb === 'rainbow') {
      const h = (now / 6000) % 1, c = new T.Color().setHSL(h, 1, 0.55);
      glowA.color.copy(c); glowB.color.copy(c); c.convertSRGBToLinear();
      PM.rgb.color.copy(c); PM.diff.emissive.copy(c); PM.rgbBlade.emissive.copy(c);
    }
    stepFly(dt);
    updateViewShift(dt);
    if (fitting && !inspecting) {
      const want = fitDist * (S.explode ? 1.3 : 1), cur = camera.position.length();
      const nd = cur + (want - cur) * Math.min(1, dt * 4);
      camera.position.setLength(nd);
      if (Math.abs(nd - want) < 0.5) fitting = false;
    }
    controls.autoRotate = S.spin && !inspecting && !fly;
    controls.update();
    if (inspecting) openH.visible = false; else if (openH.userData.target) openH.visible = true;
    for (const h of [hoverH, openH, ...errH]) if (h.visible) updateHelper(h);
    renderer.render(scene, camera);
    updateOverlay();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { rebuild, applyRgb: applyRgbInner, highlightOpen: highlightOpenInner, resetView, fitAfterExplode(){ fitting = true; },
    setLabels, inspect, exitInspect, busy(){ return !!fly || fitting; } };
};
})();
