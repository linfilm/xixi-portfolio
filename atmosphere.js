"use strict";

(() => {
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");

  // Both surfaces sleep outside the viewport. Reduced motion draws one still on resize.
  function animateSurface(canvas, initialize, fps) {
    let renderer, visible = false, request = 0, previous = null, failed = false;
    function frame(now) {
      request = 0;
      if (!visible || document.hidden || failed) return;
      if (!renderer) {
        renderer = initialize(canvas);
        if (!renderer) { failed = true; return; }
      }
      if (previous === null || now - previous >= 1000 / fps - 1) {
        const dt = previous === null ? 0 : Math.min((now - previous) / 1000, .1);
        previous = now;
        renderer(dt, motionPreference.matches);
      }
      if (!motionPreference.matches) request = requestAnimationFrame(frame);
    }
    function restart() {
      cancelAnimationFrame(request);
      previous = null;
      if (visible && !document.hidden && !failed) request = requestAnimationFrame(frame);
    }
    // A canvas touching the viewport edge can intersect with zero visible pixels.
    new IntersectionObserver(([entry]) => {
      visible = entry.intersectionRatio >= .01;
      restart();
    },{threshold:.01}).observe(canvas);
    new ResizeObserver(restart).observe(canvas);
    document.addEventListener("visibilitychange",restart);
    motionPreference.addEventListener("change",restart);
    window.addEventListener("pageshow",restart);
    canvas.addEventListener("webglcontextlost",event => {
      event.preventDefault();
      failed = true;
      applyStillSky(canvas);
      canvas.parentElement.classList.remove("is-rendering");
      restart();
    });
    canvas.addEventListener("webglcontextrestored",() => { renderer = null; failed = false; restart(); });
  }

  function rain(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const streetFrame = canvas.parentElement.querySelector(".street-frame");
    const portrait = matchMedia("(max-aspect-ratio:1/1)");
    const wideLamps = [[.17,.36],[.448,.32],[.808,.19]];
    const tallLamps = [[.14,.51],[.51,.50],[.84,.49]];
    // Rain at a similar depth and distance from a lamp can share one stroke.
    const brushes = Array.from({length:20},(_,index) => {
      const depth = Math.floor(index / 5) / 3, light = index % 5 / 4;
      return {width:.64+.48*depth, color:`rgba(${Math.round(192+61*light)},217,${Math.round(237-60*light)},${.17+.19*depth+.26*light})`};
    });
    // Most drops are short and distant. A few brighter streaks pass close to the lens.
    const drops = Array.from({length:570}, () => {
      const depth = Math.pow(Math.random(),1.5);
      return {
        x:Math.random(), y:Math.random(), brushOffset:Math.round(depth*3)*5,
        length:4 + depth * 17 + Math.random() * 3,
        speed:140 + depth * 360 + Math.random() * 35,
        slant:.09 + depth * .08 + Math.random() * .045
      };
    });
    return (dt, still) => {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(devicePixelRatio || 1,2);
      const pixelsX = Math.round(width * ratio), pixelsY = Math.round(height * ratio);
      if (canvas.width !== pixelsX || canvas.height !== pixelsY) { canvas.width = pixelsX; canvas.height = pixelsY; }
      ctx.setTransform(pixelsX / width,0,0,pixelsY / height,0,0);
      ctx.clearRect(0,0,width,height);
      if (still) return;
      const street = streetFrame.getBoundingClientRect(), view = canvas.getBoundingClientRect();
      const lamps = portrait.matches ? tallLamps : wideLamps;
      const count = Math.min(drops.length,Math.max(88,Math.round(width * height / 3200)));
      const paths = new Array(brushes.length);
      for (let i = 0; i < count; i++) {
        const drop = drops[i];
        drop.x = (drop.x + 1 - dt * drop.speed * drop.slant / (width + 6)) % 1;
        drop.y = (drop.y + dt * drop.speed / (height + drop.length)) % 1;
        const x = drop.x * (width + 6), y = drop.y * (height + drop.length) - drop.length;
        const photoX = (x + view.left - street.left) / street.width;
        const photoY = (y + view.top - street.top) / street.height;
        let light = 0;
        for (const [lx,ly] of lamps) {
          const below = photoY - ly;
          if (below < 0 || below > .24) continue;
          const across = Math.abs(photoX - lx) / (.018 + below * .36);
          light = Math.max(light,(1 - across) * (1 - below / .24));
        }
        const index = drop.brushOffset + Math.round(light*4);
        const path = paths[index] ??= new Path2D();
        path.moveTo(x,y);
        path.lineTo(x - drop.length * drop.slant,y + drop.length);
      }
      paths.forEach((path,index) => {
        ctx.lineWidth = brushes[index].width;
        ctx.strokeStyle = brushes[index].color;
        ctx.stroke(path);
      });
    };
  }

  // The Galaxy depth cycle, seeded positions, twinkle, repulsion and click warp
  // run per star. Only the small area around a star needs a fragment shader.
  const vertexSource = `#version 300 es
    precision highp float;
    uniform vec2 uResolution, uMouse;
    uniform float uTime, uDepth, uAngle, uActive, uWarp, uReveal, uPixelRatio;
    out vec3 vTint;
    out float vRadius, vBrightness, vFlare, vFootprint;
    out vec2 vRadial;
    float Hash21(vec2 p) {
      p = fract(p * vec2(123.34,456.21));
      p += dot(p,p + 45.32);
      return fract(p.x * p.y);
    }
    void main() {
      vec2 id = vec2(gl_VertexID % 127,gl_VertexID / 127);
      vec2 ray = (vec2(Hash21(id+1.0),Hash21(id+3.0))-.5)*1.9;
      float seed = Hash21(id+5.0);
      bool dust = seed < .34;
      if (dust) ray.y = .40*ray.x + ray.y*.30 + .08*sin(ray.x*5.0);
      float layer = float(gl_VertexID % 4)*.25;
      float depth = fract(uDepth+layer+Hash21(id+8.0)*.25);
      mat2 rotation = mat2(cos(uAngle),-sin(uAngle),sin(uAngle),cos(uAngle));
      vec2 extent = uResolution/uResolution.y;
      vec2 pos = (rotation*ray)*mix(.76,1.58,depth)*extent;
      vec2 away = pos-(uMouse-.5)*extent;
      float dist = length(away);
      pos += away/max(dist,.001)*(.065*uActive*exp(-dist*dist/.025));
      vRadial = pos/max(length(pos),.0001);
      gl_Position = vec4(2.0*pos/extent,0.0,1.0);

      float magnitude = pow(Hash21(id+11.0),2.4);
      float highlight = smoothstep(.78,.98,magnitude);
      vRadius = dust ? mix(.40,.72,magnitude) : .49+.75*magnitude+.24*depth;
      vFlare = dust ? 0.0 : highlight;
      float twinkle = .91+.09*sin(uTime*(.45+seed)+seed*60.0);
      float fade = smoothstep(0.0,.08,depth)*(1.0-smoothstep(.90,1.0,depth));
      vBrightness = (dust ? .27+.30*magnitude : .37+.60*magnitude)*twinkle*fade*uReveal;
      float color = Hash21(id+19.0);
      vTint = mix(vec3(.59,.75,1.0),vec3(.95,.97,1.0),color);
      if (color>.89) vTint = vec3(1.0,.88,.74);
      float reach = max(vRadius*(1.0+2.8*uWarp)+1.8,1.7+4.6*vFlare);
      gl_PointSize = ceil(2.0*reach*uPixelRatio);
      vFootprint = gl_PointSize/uPixelRatio;
    }`;

  const fragmentSource = `#version 300 es
    precision highp float;
    uniform float uWarp, uPixelRatio;
    in vec3 vTint;
    in float vRadius, vBrightness, vFlare, vFootprint;
    in vec2 vRadial;
    out vec4 outColor;
    void main() {
      vec2 p = (gl_PointCoord-.5)*vFootprint;
      p.y = -p.y;
      float stretch = 1.0+2.8*uWarp;
      vec2 shaped = p-vRadial*dot(p,vRadial)*(1.0-1.0/stretch);
      float d = length(shaped);
      float aa = .58/uPixelRatio;
      float core = 1.0-smoothstep(vRadius-aa,vRadius+aa,d);
      vec2 axis = abs(p);
      float longAxis = max(axis.x,axis.y), shortAxis = min(axis.x,axis.y);
      float glint = vFlare*(1.0-smoothstep(.1,.55+aa,shortAxis))*
                    (1.0-smoothstep(.6,1.5+4.5*vFlare,longAxis));
      float rim = vFlare*.12*exp(-d*d/(2.0*vRadius*vRadius));
      float alpha = vBrightness*min(1.0,core+.62*glint+rim);
      outColor = vec4(vTint*alpha,alpha);
    }`;

  function trackGalaxy(section, canvas) {
    const pointer = {x:.5,y:.5,inside:false,boost:0};
    section.addEventListener("pointermove",event => {
      if (motionPreference.matches || event.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width;
      pointer.y = 1 - (event.clientY - rect.top) / rect.height;
      pointer.inside = true;
    },{passive:true});
    section.addEventListener("pointerleave",() => { pointer.inside = false; });
    section.addEventListener("click",event => {
      if (!motionPreference.matches && !event.target.closest("a,button,input,dialog,[popover]")) pointer.boost = 1;
    });
    return pointer;
  }

  function applyStillSky(canvas) {
    // Keep pinpoints crisp on devices with WebGL disabled or temporarily unavailable.
    const tile = document.createElement("canvas");
    const width = 571, height = 389, ratio = Math.min(devicePixelRatio || 1,2);
    tile.width = Math.round(width * ratio);
    tile.height = Math.round(height * ratio);
    const ctx = tile.getContext("2d");
    if (!ctx) return;
    ctx.scale(tile.width / width,tile.height / height);
    let seed = 1977;
    const random = () => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i=0; i<160; i++) {
      const x = random()*width, y = random()*height, size = Math.pow(random(),3);
      ctx.fillStyle = i%11 === 0 ? "#ffdfbc" : "#c9deff";
      ctx.globalAlpha = .22+.61*size;
      ctx.beginPath();
      ctx.arc(x,y,.45+.86*size,0,Math.PI*2);
      ctx.fill();
      if (size>.88) {
        ctx.globalAlpha *= .48;
        ctx.fillRect(x-3,y-.36,6,.72);
        ctx.fillRect(x-.36,y-3,.72,6);
      }
    }
    canvas.parentElement.style.setProperty("--still-stars","url("+tile.toDataURL()+")");
  }

  function galaxy(canvas, pointer) {
    const gl = canvas.getContext("webgl2",{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
    if (!gl) return null;
    const program = gl.createProgram();
    if (!program) return null;
    for (const [type,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]) {
      const shader = gl.createShader(type);
      if (!shader) { gl.deleteProgram(program); return null; }
      gl.shaderSource(shader,source);
      gl.compileShader(shader);
      gl.attachShader(program,shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,0);
    const u = {};
    for (const name of ["uTime","uResolution","uMouse","uAngle","uWarp","uDepth","uReveal","uPixelRatio","uActive"]) {
      u[name] = gl.getUniformLocation(program,name);
    }
    const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    let time = 0, depth = .16, x = .5, y = .5, active = 0;
    return (dt,still) => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const ratio = Math.min(devicePixelRatio || 1,2,maxViewport[0]/w,maxViewport[1]/h);
      const width = Math.max(1,Math.round(w*ratio)), height = Math.max(1,Math.round(h*ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      time += still ? 0 : dt;
      const intro = still ? 1 : Math.min(1,time/2.2);
      const warp = still ? 0 : Math.max(pointer.boost,.18*(1-intro)*(1-intro));
      pointer.boost *= Math.exp(-dt*2.8);
      depth += still ? 0 : dt*.007*(1+warp*14);
      const follow = 1 - Math.exp(-dt/.325);
      x += (pointer.x-x)*follow; y += (pointer.y-y)*follow;
      active += (Number(pointer.inside)-active)*follow;
      gl.viewport(0,0,width,height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uResolution,width,height);
      gl.uniform1f(u.uPixelRatio,ratio);
      gl.uniform2f(u.uMouse,x,y);
      gl.uniform1f(u.uActive,still ? 0 : active);
      gl.uniform1f(u.uWarp,warp);
      gl.uniform1f(u.uReveal,still ? 1 : Math.min(1,intro/.35));
      gl.uniform1f(u.uTime,time);
      gl.uniform1f(u.uDepth,depth);
      gl.uniform1f(u.uAngle,time*.004);
      const starCount = Math.min(24000,Math.max(320,Math.round(w*h/405)));
      gl.drawArrays(gl.POINTS,0,starCount);
      canvas.parentElement.classList.add("is-rendering");
    };
  }

  const rainCanvas = document.querySelector(".street-rain");
  if (rainCanvas) {
    const photo = document.querySelector(".street-still");
    const startRain = () => requestAnimationFrame(() => requestAnimationFrame(() => animateSurface(rainCanvas,rain,30)));
    if (!photo || photo.complete) startRain();
    else {
      photo.addEventListener("load",startRain,{once:true});
    }
  }
  const sky = document.querySelector(".galaxy-canvas");
  if (sky) {
    const pointer = trackGalaxy(sky.closest(".profile,.dossier"),sky);
    animateSurface(sky,canvas => {
      const render = galaxy(canvas,pointer);
      if (!render) applyStillSky(canvas);
      return render;
    },24);
  }
})();
