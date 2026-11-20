"use strict";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setupStreet(street) {
  const scene = street.querySelector("#scene");
  const camera = street.querySelector(".street-camera");
  const handle = street.querySelector(".trail-handle");
  const routeStatus = street.querySelector("#route-status");
  const canvas = street.querySelector("#trail");
  const ctx = canvas.getContext("2d");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const portrait = window.matchMedia("(max-aspect-ratio: 1/1)");
  const doors = [...street.querySelectorAll("[data-door]")];
  const photoFrame = scene.querySelector(".street-frame");
  // Doorstep positions in the 960 × 540 landscape photograph.
  const doorsteps = {
    web:    {x:245, y:443},
    social: {x:426, y:359},
    motion: {x:745, y:393}
  };
  const routes = {};
  let forkX = 0, forkY = 0;
  let active = null;
  let journey = null;
  let armed = false;
  let travel = 0;
  let ignoreClick = false;
  let frame = 0;
  let onscreen = true;
  let entering = null;
  let transition = null;
  let roomStill = null;
  let paintWidth = 0, paintHeight = 0;
  let aimX = 0, aimY = 0, panX = 0, panY = 0;
  let restTimer;

  function centerCamera() {
    aimX = aimY = 0;
    wake();
  }
  function easePan(value, target) {
    return Math.abs(target - value) < .01 ? target : value + (target - value) * .22;
  }
  function measure() {
    paintWidth = scene.clientWidth;
    paintHeight = scene.clientHeight;
    if (!portrait.matches) {
      // Work inside the camera, before parallax or the entry animation is applied.
      const crop = new DOMMatrixReadOnly(getComputedStyle(photoFrame).transform);
      const photoLeft = photoFrame.offsetLeft + crop.e;
      const photoTop = photoFrame.offsetTop + crop.f;
      forkX = handle.offsetLeft;
      forkY = handle.offsetTop;
      for (const [name, step] of Object.entries(doorsteps)) {
        const x = photoLeft + step.x / 960 * photoFrame.clientWidth;
        const sill = photoTop + step.y / 540 * photoFrame.clientHeight;
        // A shallow window can crop out the doorstep. Aim into the same door opening.
        const visibleLimit = name === "social"
          ? forkY - Math.max(paintHeight * .13, Math.abs(x - forkX))
          : paintHeight * .93;
        const y = Math.min(sill, visibleLimit);
        routes[name] = {x,y};
      }
    }
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(paintWidth * pixelRatio);
    canvas.height = Math.round(paintHeight * pixelRatio);
    if (ctx) ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    wake();
  }
  function wake() {
    if (!frame && onscreen && !document.hidden) frame = requestAnimationFrame(paint);
  }
  function drawRoute(door, time, still) {
    const selected = active === door;
    const {x, y} = routes[door];
    const dx = x - forkX;
    const rise = forkY - y;
    const bendX = x - dx * .10;
    const bendY = y + Math.min(paintHeight * .065, Math.max(paintHeight * .026, rise * .65));
    const thickness = Math.max(1.5, Math.min(3.2, paintWidth / 580));
    ctx.beginPath();
    ctx.moveTo(forkX, forkY);
    ctx.bezierCurveTo(forkX + dx * .06, forkY - rise * .45, bendX, bendY, x, y);
    ctx.strokeStyle = selected ? "#fff2cc" : "rgba(255,222,166,.86)";
    ctx.lineWidth = selected ? thickness * 1.5 : thickness;
    ctx.lineCap = "round";
    ctx.shadowColor = "#ef9e48";
    ctx.shadowBlur = selected ? 11 : 6;
    ctx.stroke();
    if (selected && !still) {
      ctx.setLineDash([paintWidth * .026, paintWidth * .28]);
      ctx.lineDashOffset = -time * paintWidth * .00012;
      ctx.strokeStyle = "#fffaf0";
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const angle = Math.atan2(y - bendY, x - bendX);
    const tip = Math.max(5, thickness * 3.7);
    ctx.beginPath();
    for (const side of [-1,1]) {
      ctx.moveTo(x,y);
      ctx.lineTo(x - tip * Math.cos(angle + side * .49), y - tip * Math.sin(angle + side * .49));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  function paint(time) {
    frame = 0;
    if (!onscreen || document.hidden) return;
    const still = reducedMotion.matches;
    if (active !== (scene.dataset.preview || null)) {
      if (active) scene.dataset.preview = active;
      else delete scene.dataset.preview;
    }
    panX = still ? 0 : easePan(panX, aimX);
    panY = still ? 0 : easePan(panY, aimY);
    const zoom = still ? 0 : travel * .11 + Math.max(Math.abs(panX), Math.abs(panY)) * .009;
    camera.style.transform = zoom
      ? `perspective(1800px) translate(${panX * .16}%, ${panY * .12}%) rotateY(${-panX * .45}deg) scale(${1 + zoom})`
      : "";
    if (ctx && !portrait.matches && routes.web) {
      ctx.clearRect(0, 0, paintWidth, paintHeight);
      for (const door of doors) drawRoute(door.dataset.door, time, still);
    }
    if (!still && !portrait.matches && (active || panX !== aimX || panY !== aimY)) wake();
  }
  function activate(element) {
    if (entering || journey || armed) return;
    active = element?.dataset.door || null;
    wake();
  }
  function resetTrip() {
    if (transition) transition.cancel();
    transition = null;
    if (roomStill) roomStill.remove();
    roomStill = null;
    clearJourney();
    if (entering) entering.classList.remove("entering");
    entering = null; active = null;
    camera.style.removeProperty("--origin-x");
    camera.style.removeProperty("--origin-y");
    clearTimeout(restTimer);
    aimX = aimY = panX = panY = 0;
    wake();
  }
  function walkTo(link) {
    if (entering) return;
    // Save the real street position before zooming a focused door. Some
    // mobile browsers scroll to keep the transformed focus target visible.
    try {
      history.replaceState({...history.state,streetReturnY:window.scrollY},"");
      history.scrollRestoration = "manual";
    } catch { /* Sandboxed documents still have normal link navigation. */ }
    if (reducedMotion.matches || !camera.animate) { location.assign(link.href); return; }
    entering = link;
    active = link.dataset.door;
    entering.classList.add("entering");
    const room = link.getBoundingClientRect();
    const view = scene.getBoundingClientRect();
    const x = (room.left - view.left + room.width * .5) / view.width * 100;
    const y = (room.top - view.top + room.height * .66) / view.height * 100;
    camera.style.setProperty("--origin-x", x + "%");
    camera.style.setProperty("--origin-y", y + "%");
    roomStill = new Image();
    roomStill.alt = ""; roomStill.className = "threshold";
    roomStill.src = "assets/studio-" + active + ".webp";
    scene.append(roomStill);
    roomStill.animate([{opacity:0},{opacity:0,offset:.42},{opacity:1}], {duration:680,fill:"forwards"});
    transition = camera.animate([
      { transform:getComputedStyle(camera).transform, filter:"brightness(1)" },
      { transform:"scale(2.65)", filter:"brightness(.65)" }
    ], {duration:680,easing:"cubic-bezier(.55,.04,.68,.45)",fill:"forwards"});
    transition.finished.then(() => { if (entering === link) location.assign(link.href); }, () => {});
    wake();
  }
  function enter(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    walkTo(event.currentTarget);
  }
  function clearJourney() {
    const pointer = journey?.pointer;
    journey = null; travel = 0; armed = false;
    if (pointer != null && handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    handle.setAttribute("aria-pressed","false");
    doors.forEach(door => door.classList.remove("aimed"));
    if (!entering) active = null;
    camera.style.removeProperty("--origin-x"); camera.style.removeProperty("--origin-y");
    wake();
  }
  function selectPath(link) {
    if (active !== link.dataset.door) routeStatus.textContent = link.getAttribute("aria-label");
    active = link.dataset.door;
    doors.forEach(door=>door.classList.toggle("aimed", door === link));
    const target = routes[active];
    camera.style.setProperty("--origin-x",target.x+"px");
    camera.style.setProperty("--origin-y",target.y+"px");
    wake();
  }
  /* The fork is both a touch control and a keyboard selector. Snap the
     gesture to the closest actual path using direction and distance. */
  handle.addEventListener("pointerdown",event=>{
    if (entering || event.button !== 0 || !event.isPrimary) return;
    ignoreClick = false;
    journey = {pointer:event.pointerId,x:event.clientX,y:event.clientY,dragged:false};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove",event=>{
    if (!journey || journey.pointer !== event.pointerId) return;
    const dx=event.clientX-journey.x, dy=event.clientY-journey.y;
    const distance=Math.hypot(dx,dy);
    if (distance < 7 && !journey.dragged) return;
    journey.dragged = true;
    handle.setAttribute("aria-pressed","true");
    let target = null, best = .62, reach = 0;
    journey.ready = false;
    for (const door of doors) {
      const path = routes[door.dataset.door];
      const vx = path.x - forkX, vy = path.y - forkY;
      const length=Math.hypot(vx,vy);
      const alignment=(dx*vx+dy*vy)/(length*Math.max(1,distance));
      if (alignment > best) {
        best = alignment;
        target = door;
        const projected = alignment * distance;
        reach = Math.min(1, projected / length);
        const threshold = Math.min(event.pointerType === "touch" ? 64 : 112, length * .6);
        journey.ready = projected >= threshold;
      }
    }
    travel=reach;
    if (target) selectPath(target);
    else { active=null; doors.forEach(door=>door.classList.remove("aimed")); wake(); }
  });
  handle.addEventListener("pointerup",event=>{
    if (journey?.pointer !== event.pointerId) return;
    const dragged = journey.dragged;
    const target = dragged && journey.ready ? doors.find(door=>door.dataset.door===active) : null;
    journey = null;
    if (!dragged) return;
    ignoreClick = true;
    if (target) walkTo(target); else clearJourney();
  });
  for (const type of ["pointercancel","lostpointercapture"]) {
    handle.addEventListener(type,()=>{if(journey)clearJourney();});
  }
  handle.addEventListener("click",()=>{
    if (ignoreClick || entering) { ignoreClick=false; return; }
    if (armed) {walkTo(doors.find(door=>door.dataset.door===active) || doors[0]);return;}
    armed=true; handle.setAttribute("aria-pressed","true"); selectPath(doors[0]);
    routeStatus.textContent="已选建站开发，可用左右方向键换门，回车进入。";
  });
  handle.addEventListener("keydown",event=>{
    if (event.key==="Escape") {clearJourney();return;}
    if (!["ArrowLeft","ArrowRight"].includes(event.key)) return;
    event.preventDefault(); armed=true; handle.setAttribute("aria-pressed","true");
    const current=doors.findIndex(door=>door.dataset.door===active);
    selectPath(doors[(current+(event.key==="ArrowRight"?1:-1)+doors.length)%doors.length]);
  });
  handle.addEventListener("blur",()=>{if(!entering)clearJourney();});
  handle.hidden = false;
  for (const door of doors) {
    if (door.dataset.door === "social") door.setAttribute("aria-describedby","preview-keys");
    door.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") activate(door); });
    door.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") activate(document.activeElement?.closest("[data-door]")); });
    door.addEventListener("focus", () => activate(door));
    door.addEventListener("blur", () => activate(null));
    door.addEventListener("click", enter);
  }
  scene.addEventListener("pointermove", event => {
    if (portrait.matches || !finePointer.matches || event.pointerType !== "mouse" || reducedMotion.matches || entering || journey) return;
    const rect = scene.getBoundingClientRect();
    aimX = 1 - 2 * (event.clientX - rect.left) / rect.width;
    aimY = 1 - 2 * (event.clientY - rect.top) / rect.height;
    clearTimeout(restTimer);
    restTimer = setTimeout(centerCamera, 180);
    wake();
  });
  scene.addEventListener("pointerleave", centerCamera);
  document.addEventListener("keydown",event=>{if (event.key === "Escape" && entering) resetTrip();});
  window.addEventListener("pagehide",resetTrip);
  window.addEventListener("pageshow",event => {
    if (event.persisted) resetTrip();
    const y = history.state?.streetReturnY;
    if (Number.isFinite(y)) requestAnimationFrame(() => {
      window.scrollTo({top:y,left:0,behavior:"instant"});
      const restored = {...history.state};
      delete restored.streetReturnY;
      try { history.replaceState(restored,""); history.scrollRestoration="auto"; } catch {}
    });
  });
  document.addEventListener("visibilitychange", wake);
  reducedMotion.addEventListener("change", wake);
  new ResizeObserver(measure).observe(scene);
  new IntersectionObserver(([entry])=>{
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  }).observe(scene);
  setupStreetProps(scene, activate);
  street.querySelector(".street-hint span").textContent = "移到门前看预览，点击门牌或沿光路拖动进门";
  setupStreetEncore(street.querySelector(".encore-sign"));
  setupShopViews(street, doors, portrait);
}

function setupShopViews(street, doors, portrait) {
  const pan = street.querySelector(".street-pan");
  const frame = street.querySelector(".street-frame");
  const views = street.querySelector(".shop-views");
  const buttons = [...views.querySelectorAll("button")];
  const help = street.querySelector(".touch-help");
  const zoom = street.querySelector(".scene-zoom");
  const range = street.querySelector("#street-zoom");
  const reading = zoom.querySelector(".zoom-reading");
  const explore = street.querySelector(".explore");
  const saved = history.state?.streetView;
  if (Number.isInteger(saved?.zoom)) range.value = saved.zoom;
  let current = doors[saved?.shop] ? saved.shop : 0;
  let focus = Number.isFinite(saved?.focus) ? saved.focus : null;
  let autoLeft = null;
  let scrollFrame = 0;
  let signTimer;

  function center(door) {
    return (door.offsetLeft + door.offsetWidth / 2) / frame.offsetWidth;
  }
  function offset(point) {
    const end = pan.scrollWidth - pan.clientWidth;
    return Math.max(0, Math.min(end, point * frame.offsetWidth - pan.clientWidth / 2));
  }
  function markShop() {
    buttons.forEach((button,index) => button.setAttribute("aria-pressed", String(index === current)));
  }
  function applyZoom() {
    const scale = range.valueAsNumber / 100;
    street.style.setProperty("--street-scale", scale);
    const label = scale.toFixed(2).replace(/0$/, "");
    reading.textContent = label + "×";
    range.setAttribute("aria-valuetext", scale === 1 ? "1 倍，全景" : label + " 倍");
    if (focus === null) focus = center(doors[current]);
    autoLeft = offset(focus);
    pan.scrollTo({left:autoLeft, behavior:"instant"});
  }
  function remember() {
    if (!portrait.matches) return;
    try {
      history.replaceState({...history.state,streetView:{zoom:range.valueAsNumber,focus,shop:current}}, "");
    } catch { /* A restricted local preview can still retain the view in memory. */ }
  }
  range.addEventListener("input", applyZoom);
  range.addEventListener("change", remember);
  buttons.forEach((button,index) => button.addEventListener("click", () => {
    current = index;
    focus = center(doors[index]);
    // Include the projection wall at the rightmost stop.
    if (index === doors.length - 1) focus = 1;
    autoLeft = offset(focus);
    pan.scrollTo({left:autoLeft, behavior:reducedMotion.matches ? "instant" : "smooth"});
    markShop();
    clearTimeout(signTimer);
    const sign = doors[index].nextElementSibling;
    street.querySelector(".shop-sign.lit")?.classList.remove("lit");
    sign.classList.add("lit");
    signTimer = setTimeout(() => sign.classList.remove("lit"), 900);
  }));
  function allowPan() { autoLeft = null; }
  pan.addEventListener("pointerdown", allowPan, {passive:true});
  pan.addEventListener("wheel", allowPan, {passive:true});
  pan.addEventListener("keydown", allowPan);
  pan.addEventListener("scroll", () => {
    if (!portrait.matches || scrollFrame || autoLeft !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!portrait.matches || autoLeft !== null || pan.scrollWidth <= pan.clientWidth) return;
      focus = (pan.scrollLeft + pan.clientWidth / 2) / frame.offsetWidth;
      const distances = doors.map(door => Math.abs(center(door) - focus));
      current = distances.indexOf(Math.min(...distances));
      markShop();
    });
  }, {passive:true});
  function fit() {
    views.hidden = zoom.hidden = !portrait.matches;
    help.hidden = false;
    help.textContent = portrait.matches ? "左右滑动逛街，轻点门牌进入" : "长按门牌预览，轻点进入";
    if (portrait.matches) {
      applyZoom();
      markShop();
    } else {
      zoom.open = false;
      pan.scrollLeft = 0;
    }
  }
  // Only one street control is open at a time. Outside taps return to the scene.
  for (const panel of [explore, zoom]) {
    document.addEventListener("pointerdown", event => {
      if (panel.open && !panel.contains(event.target)) panel.open = false;
    }, {passive:true});
    panel.addEventListener("toggle", () => {
      if (panel.open) (panel === explore ? zoom : explore).open = false;
    });
    panel.addEventListener("keydown", event => {
      if (event.key === "Escape" && panel.open) {
        panel.open = false;
        panel.querySelector("summary").focus();
      }
    });
    panel.addEventListener("focusout", event => {
      if (event.relatedTarget && !panel.contains(event.relatedTarget)) panel.open = false;
    });
  }
  window.addEventListener("pagehide", remember);
  window.addEventListener("pageshow", fit);
  new ResizeObserver(fit).observe(pan);
  portrait.addEventListener("change", fit);
  fit();
}

function setupStreetProps(scene, activate) {
  const posterTitles = [...scene.querySelectorAll(".print-rack [data-title]")].map(print=>print.dataset.title);
  const socialLabel = scene.querySelector(".door-social small");
  scene.dataset.cut = "1";

  function scrub(fraction) {
    const position = Math.max(0, Math.min(1, fraction));
    const cut = Math.min(2, Math.floor(position * 3));
    if (scene.dataset.cut === String(cut)) return;
    scene.dataset.cut = String(cut);
    socialLabel.textContent = posterTitles[cut];
  }
  function scrubAt(door, clientX) {
    if (door.dataset.door !== "social") return;
    const box = door.getBoundingClientRect();
    scrub( (clientX - box.left) / box.width);
  }

  let lastRipple = { x:0, y:0, time:-Infinity };
  function disturbWater(event) {
    if (reducedMotion.matches || event.target.closest("a,button,details,input") || !scene.animate) return;
    const tap = event.type === "pointerdown";
    const now = performance.now();
    if (!tap && (now - lastRipple.time < 150 || Math.hypot(event.clientX - lastRipple.x, event.clientY - lastRipple.y) < 32)) return;
    const box = scene.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    if (y < box.height * .69) return;
    lastRipple = { x:event.clientX, y:event.clientY, time:now };
    const ring = document.createElement("span");
    ring.className = "puddle-ring";
    ring.setAttribute("aria-hidden","true");
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    scene.append(ring);
    const wave = ring.animate([
      { transform:"translate(-50%,-50%) scale(.14)", opacity:.95 },
      { transform:"translate(-50%,-50%) scale(1.18)", opacity:0 }
    ], { duration:850, easing:"cubic-bezier(.18,.55,.48,.94)" });
    wave.finished.then(()=>ring.remove(),()=>ring.remove());
  }

  let press = null, skipTap = null;
  function releasePress() {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.previewing) activate(null);
    press = null;
  }
  scene.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    releasePress();
    skipTap = null;
    disturbWater(event);
    const door = event.target.closest("[data-door]");
    if (!door || event.pointerType !== "touch") return;
    press = { door, id:event.pointerId, x:event.clientX, y:event.clientY, previewing:false };
    press.timer = setTimeout(()=>{
      press.previewing = true;
      skipTap = door;
      activate(door);
      scrubAt(door, press.x);
    }, 380);
  });
  scene.addEventListener("pointermove", event => {
    if (!event.isPrimary) return;
    if (press && event.pointerId === press.id) {
      if (press.previewing) scrubAt(press.door,event.clientX);
      else if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) releasePress();
    } else if (event.pointerType === "mouse" && !event.buttons) {
      const door = event.target.closest("[data-door]");
      if (door) scrubAt(door,event.clientX);
      else disturbWater(event);
    }
  });
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) {
    scene.addEventListener(type,event=>{ if (press?.id === event.pointerId) releasePress(); });
  }
  scene.addEventListener("contextmenu",event=>{ if (press?.door === event.target.closest("[data-door]")) event.preventDefault(); });
  scene.addEventListener("click",event=>{
    if (!skipTap || event.detail === 0 || skipTap !== event.target.closest("[data-door]")) return;
    event.preventDefault();
    event.stopPropagation();
    skipTap = null;
  }, true);
  scene.addEventListener("keydown",event=>{
    const door = event.target.closest("[data-door]");
    if (door?.dataset.door !== "social" || !["ArrowRight","ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    scrub(((Number(scene.dataset.cut) + step + 3) % 3 + .5) / 3);
    scene.querySelector("#route-status").textContent = socialLabel.textContent;
  });
  window.addEventListener("pagehide",releasePress);
  document.addEventListener("visibilitychange",()=>{ if (document.hidden) releasePress(); });
}

function setupMotionSections(collection) {
  const nav = collection.querySelector(".motion-sections");
  const panels = [...collection.querySelectorAll(".motion-panel")];
  const links = [...nav.querySelectorAll("a")];
  function showSection(hash) {
    const target = document.getElementById(hash.slice(1));
    const panel = target?.closest(".motion-panel") || panels[0];
    panels.forEach(item => { item.hidden = item !== panel; });
    links.forEach(link => {
      if (link.hash === "#" + panel.id) link.setAttribute("aria-current","location");
      else link.removeAttribute("aria-current");
    });
  }
  nav.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(null,"",link.hash);
    showSection(link.hash);
  });
  window.addEventListener("hashchange", () => showSection(location.hash));
  showSection(location.hash);
}

function setupPersonalReel(panel) {
  const strip = panel.querySelector(".film-strip");
  const cards = [...strip.querySelectorAll(".film-card")];
  const controls = panel.querySelector(".reel-controls");
  const position = controls.querySelector(".reel-position");
  const prev = controls.querySelector(".reel-prev");
  const next = controls.querySelector(".reel-next");

  function updatePosition() {
    if (!strip.clientWidth) return;
    const end = strip.scrollWidth - strip.clientWidth;
    controls.hidden = end <= 1;
    prev.setAttribute("aria-disabled", String(strip.scrollLeft <= 1));
    next.setAttribute("aria-disabled", String(strip.scrollLeft >= end - 1));
    const bounds = strip.getBoundingClientRect();
    const visible = cards.filter(card => {
      const box = card.getBoundingClientRect();
      const middle = box.left + box.width / 2;
      return middle >= bounds.left && middle <= bounds.right;
    });
    if (visible.length) {
      const first = cards.indexOf(visible[0]) + 1;
      const last = first + visible.length - 1;
      position.textContent = (first === last ? first : first + "–" + last) + " / " + cards.length;
    }
  }

  function turnPage(direction) {
    const style = getComputedStyle(strip);
    const gap = parseFloat(style.columnGap);
    const step = cards[0].offsetWidth + gap;
    const space = strip.clientWidth - 2 * parseFloat(style.paddingLeft);
    const count = Math.max(1, Math.floor((space + gap) / step));
    strip.scrollBy({left: direction * count * step, behavior: reducedMotion.matches ? "instant" : "smooth"});
    updatePosition();
  }
  prev.addEventListener("click", () => { if (prev.getAttribute("aria-disabled") === "false") turnPage(-1); });
  next.addEventListener("click", () => { if (next.getAttribute("aria-disabled") === "false") turnPage(1); });
  strip.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = cards.indexOf(event.target.closest(".film-card"));
    if (index < 0) return;
    const destinations = {ArrowLeft:index - 1, ArrowRight:index + 1, Home:0, End:cards.length - 1};
    if (!Object.hasOwn(destinations,event.key)) return;
    event.preventDefault();
    const target = cards[Math.max(0,Math.min(destinations[event.key],cards.length - 1))];
    target.focus({preventScroll:true});
    target.scrollIntoView({inline:"nearest",block:"nearest",behavior:reducedMotion.matches ? "instant" : "smooth"});
  });
  strip.addEventListener("scroll",updatePosition,{passive:true});
  new ResizeObserver(updatePosition).observe(strip);
  updatePosition();
}

function encoreItems(catalog) {
  const items = [
    {kind:"网站", title:"QRveo 墨西哥独立站", image:"assets/qrveo-home.webp", href:"https://lwcqr.qrveo.com/", action:"访问独立站"},
    {kind:"网站", title:"QRveo 建站实训", image:"assets/qrveo-home.webp", href:"web.html#qrveo", action:"看建站过程", sameTab:true},
    {kind:"网站", title:"校企招聘与就业管理平台", image:"assets/studio-web.webp", href:"web.html#case-dev", action:"查看项目", sameTab:true},
    {kind:"海外运营", title:"广告素材测试与投放复盘", image:"assets/studio-social.webp", href:"social.html#case-social", action:"看运营实践", sameTab:true},
    {kind:"个人介绍", title:"关于林亿翰", image:"assets/portrait.webp", href:"index.html#about", action:"阅读介绍", sameTab:true},
    {kind:"个人介绍", title:"林亿翰的简历", image:"assets/portrait.webp", href:"resume-linyihan.pdf", action:"查看简历"}
  ];
  for (const link of catalog.querySelectorAll("#films .watch[data-film]")) {
    items.push({kind:"视频", category:link.dataset.category, title:link.dataset.title || link.querySelector("h3").textContent,
      image:link.querySelector("img").getAttribute("src"), href:link.getAttribute("href"), action:"播放短片"});
  }
  for (const link of catalog.querySelectorAll("#promotion .account-links a")) {
    const label = link.querySelector("span");
    items.push({kind:"社媒账号", title:label.firstChild.textContent.trim() + " · " + label.querySelector("small").textContent,
      image:"assets/studio-social.webp", href:link.getAttribute("href"), action:"打开社媒账号"});
  }
  for (const poster of catalog.querySelectorAll(".campaign-stills [data-original]")) {
    items.push({kind:"推广海报", title:poster.dataset.title, image:poster.getAttribute("src"), href:poster.dataset.original, action:"查看海报原稿"});
  }
  return items;
}

function setupEncoreTicket(ticket, catalog) {
  const items = encoreItems(catalog);
  const still = ticket.querySelector("img");
  const title = ticket.querySelector(".ticket-film");
  const type = ticket.querySelector(".ticket-type");
  const open = ticket.querySelector(".ticket-open");
  let remaining = [], last;
  function drawTicket() {
    if (!remaining.length) remaining = [...items];
    const otherKinds = remaining.filter(item => item.kind !== last?.kind);
    const choices = otherKinds.length ? otherKinds : remaining;
    const item = choices[Math.floor(Math.random() * choices.length)];
    remaining.splice(remaining.indexOf(item),1);
    last = item;
    type.textContent = item.category ? item.kind + " · " + item.category : item.kind;
    title.textContent = item.title;
    still.src = item.image;
    open.textContent = item.action;
    open.href = item.href;
    open.target = item.sameTab ? "_self" : "_blank";
    open.classList.toggle("watch",item.kind === "视频");
    open.dataset.title = item.title;
    open.dataset.category = item.category || item.kind;
  }
  ticket.querySelector(".ticket-draw").addEventListener("click",drawTicket);
  ticket.querySelector(".ticket-close").addEventListener("click",()=>ticket.close());
  open.addEventListener("click",event=>{
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) ticket.close();
  });
  return () => {
    if (ticket.open) return;
    drawTicket();
    ticket.showModal();
  };
}

function setupStreetEncore(link) {
  if (typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal) return;
  link.href = "motion.html#encore";
  if (location.protocol === "file:") return;
  // Read the same published film and account links as the work page, only on the first draw.
  let ready;
  async function loadTicket() {
    const response = await fetch("motion.html");
    if (!response.ok) throw new Error("Encore catalog unavailable");
    const catalog = new DOMParser().parseFromString(await response.text(),"text/html");
    const ticket = document.importNode(catalog.querySelector("#encore"),true);
    document.body.append(ticket);
    return setupEncoreTicket(ticket,catalog);
  }
  link.addEventListener("click",async event=>{
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      ready ??= loadTicket();
      const open = await ready;
      open();
    } catch {
      location.assign(link.href);
    }
  });
}

function setupScreeningLinks(collection) {
  const ticket = document.querySelector("#encore");
  if (!ticket.showModal) return;
  const openTicket = setupEncoreTicket(ticket,collection);
  function openSelection() {
    if (location.hash === "#encore") {
      collection.scrollIntoView({behavior:"instant"});
      collection.querySelector('.motion-sections a[aria-current]').focus({preventScroll:true});
      openTicket();
    } else {
      const work = document.getElementById(location.hash.slice(1));
      if (!work?.matches(".motion-work")) return;
      work.scrollIntoView({behavior:"instant"});
      const link = work.querySelector(".watch");
      link.focus({preventScroll:true});
      if (location.protocol !== "file:") link.click();
    }
  }
  window.addEventListener("hashchange", openSelection);
  openSelection();
}

function setupPlayer(dialog) {
  const screen = dialog.querySelector("#screen");
  const close = dialog.querySelector("#close-player");
  document.addEventListener("click", event => {
    const link = event.target.closest("a.watch");
    // The provider needs an HTTP origin to embed. File previews use its share page.
    if (!link || location.protocol === "file:" || !dialog.showModal) return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const title = link.dataset.title || link.querySelector("h3")?.textContent;
    if (!title) return;
    event.preventDefault();
    dialog.querySelector("#player-title").textContent = title;
    dialog.querySelector("#player-type").textContent = link.dataset.category;
    dialog.querySelector("#external").href = link.href;
    const iframe = document.createElement("iframe");
    iframe.src = link.href + "?embed=1&layout=full&autoplay=1";
    iframe.title = title + " · CodaPan 播放器";
    iframe.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    screen.replaceChildren(iframe);
    dialog.showModal(); close.focus();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => screen.replaceChildren());
  dialog.addEventListener("click", event=>{
    if (event.target !== dialog) return;
    const box=dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}

function setupScrollReveals() {
  if (!("IntersectionObserver" in window) || reducedMotion.matches) return;
  const parts = document.querySelectorAll(
    ".profile-intro > *, .profile-story > *, .caseblock > *, .motion-sections, " +
    ".motion-promotion > *, .reel-header, .film-strip, .footer-contact > *"
  );
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("reveal-in");
      observer.unobserve(entry.target);
    }
  });
  parts.forEach(part => observer.observe(part));
}

function setupPageNavigation() {
  let veil;
  window.addEventListener("pagehide",()=>{
    veil?.remove();
    veil = null;
  });
  document.addEventListener("click",event=>{
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const destination = new URL(link.href);
    if (destination.origin !== location.origin || !destination.pathname.endsWith(".html") || destination.pathname === location.pathname) return;
    if (reducedMotion.matches || !document.body.animate) return;
    event.preventDefault();
    if (veil) return;
    const layer = document.createElement("div");
    layer.className = "page-exit";
    layer.setAttribute("aria-hidden","true");
    document.body.append(layer);
    veil = layer;
    const fade = layer.animate([{opacity:0},{opacity:.88}],{duration:190,easing:"ease-in",fill:"forwards"});
    fade.finished.then(()=>{ if (veil === layer) location.assign(destination.href); },()=>{});
  });
}
setupScrollReveals();
const street = document.querySelector("#street");
if (street) {
  const oldCases = {"#films":"motion","#case-web":"web","#case-dev":"web","#case-social":"social","#case-video":"motion","#case-ai":"motion"};
  function restoreCaseLink() {
    const page = oldCases[location.hash];
    if (page) location.replace(page+".html"+location.hash);
  }
  restoreCaseLink();
  window.addEventListener("hashchange", restoreCaseLink);
  setupStreet(street);
}
const player = document.querySelector("#player");
if (player) setupPlayer(player);
const collection = document.querySelector(".motion-collection");
if (collection) {
  setupMotionSections(collection);
  setupPersonalReel(collection.querySelector("#personal"));
  setupScreeningLinks(collection);
}
setupPageNavigation();
