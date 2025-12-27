/* Simple projector mapping warp tool.
   - Loads an image
   - Lets user drag 4 corner handles (touch & mouse)
   - Renders an approximated perspective warp by subdividing into grid and drawing triangles
   - Save/Load calibration JSON
*/
(function(){
  const canvas = document.getElementById('warpCanvas');
  const ctx = canvas.getContext('2d');
  const handlesEl = document.getElementById('handles');
  const shapeHandlesEl = document.getElementById('shapeHandles');
  const overlaySvg = document.getElementById('overlay');
  const addTriangleBtn = document.getElementById('addTriangle');
  const addRectangleBtn = document.getElementById('addRectangle');
  const addCircleBtn = document.getElementById('addCircle');
  const shapesListEl = document.getElementById('shapesList');
  const deleteShapeBtn = document.getElementById('deleteShapeBtn');
  const fileInput = document.getElementById('file');
  const gridRange = document.getElementById('gridRange');
  const gridLabel = document.getElementById('gridLabel');
  const resetBtn = document.getElementById('resetBtn');
  const saveBtn = document.getElementById('saveBtn');
  const loadBtn = document.getElementById('loadBtn');
  const loadFile = document.getElementById('loadFile');

  let image = null;
  let imgWidth = 0, imgHeight = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  // canvas size follows container
  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    // redraw canvas and overlay + handles to remain in sync after resize
    draw();
    renderOverlay();
    updateHandlePositions();
    updateShapeHandles();
  }

  window.addEventListener('resize', ()=>{ dpr = Math.max(1, window.devicePixelRatio || 1); resizeCanvas(); });

  // Default corner positions (normalized) in container coordinates
  let corners = [
    {x:0,y:0},
    {x:1,y:0},
    {x:1,y:1},
    {x:0,y:1}
  ];

  // Create handle elements
  const handleEls = [];
  for(let i=0;i<4;i++){
    const h = document.createElement('div');
    h.className='handle';
    h.dataset.i = i;
    handlesEl.appendChild(h);
    handleEls.push(h);
  }

  // Shapes support -----------------------------------------------------------------
  let shapes = []; // {id, type:'polygon'|'circle', points:[{x,y}], center?, radius?}
  let selectedShapeId = null;
  let shapeIdCounter = 1;
  let needsAnimation = false;
  let animFrame = null;

  function createShape(type){
    const id = 's'+(shapeIdCounter++);
    const center = {x:0.5 + (Math.random()-0.5)*0.1, y:0.45 + (Math.random()-0.5)*0.1};
    let shape = {id, type};
    if(type==='triangle'){
      shape.points = [
        {x:center.x-0.08, y:center.y+0.06},
        {x:center.x+0.08, y:center.y+0.06},
        {x:center.x, y:center.y-0.08}
      ];
    }else if(type==='rectangle'){
      const w = 0.18, h = 0.12;
      shape.points = [
        {x:center.x-w/2,y:center.y-h/2},
        {x:center.x+w/2,y:center.y-h/2},
        {x:center.x+w/2,y:center.y+h/2},
        {x:center.x-w/2,y:center.y+h/2}
      ];
    }else if(type==='circle'){
      shape.center = center;
      shape.radius = 0.08;
      // represent circle by two handles: center and circumference point (we'll synthesize points for rendering)
    }
    shapes.push(shape);
    selectedShapeId = id;
    renderShapesUI();
    renderOverlay();
    updateShapeHandles();
    draw();
  }

  function deleteSelectedShape(){
    if(!selectedShapeId) return;
    const removed = shapes.filter(s=>s.id===selectedShapeId);
    // cleanup resources for removed shapes
    removed.forEach(s=>{
      if(s._url){ try{ URL.revokeObjectURL(s._url); }catch(e){} s._url = null; }
      if(s.video){ try{ s.video.pause(); } catch(e){} s.video = null; }
    });
    shapes = shapes.filter(s=>s.id!==selectedShapeId);
    selectedShapeId = shapes.length? shapes[0].id : null;
    renderShapesUI();
    renderOverlay();
    updateShapeHandles();
    updateHandlePositions();
    updateAnimationLoop();
    // redraw canvas to remove deleted shape's image
    draw();
  }

  function renderShapesUI(){
    shapesListEl.innerHTML='';
    shapes.forEach(s=>{
      const div = document.createElement('div'); div.className='shape-item';
      const name = document.createElement('div'); name.className='name'; name.textContent = s.type + ' ('+s.id+')';
      const btns = document.createElement('div');
  const sel = document.createElement('button'); sel.className='selectBtn'; sel.textContent = selectedShapeId===s.id? 'Selected' : 'Select';
  sel.addEventListener('click', ()=>{ selectedShapeId = s.id; renderShapesUI(); renderOverlay(); updateShapeHandles(); updateHandlePositions(); });
      const del = document.createElement('button'); del.className='selectBtn'; del.textContent='Delete'; del.addEventListener('click', ()=>{
        // cleanup resources for this shape
        const removed = shapes.filter(x=>x.id===s.id);
        removed.forEach(r=>{ if(r._url){ try{ URL.revokeObjectURL(r._url); }catch(e){} r._url=null; } if(r.video){ try{ r.video.pause(); }catch(e){} r.video=null; } });
        shapes = shapes.filter(x=>x.id!==s.id);
        if(selectedShapeId===s.id) selectedShapeId=null;
        renderShapesUI(); renderOverlay(); updateShapeHandles(); updateHandlePositions(); updateAnimationLoop(); draw();
      });
      btns.appendChild(sel); btns.appendChild(del);
      div.appendChild(name); div.appendChild(btns);
      shapesListEl.appendChild(div);
    });
  }

  function renderOverlay(){
    // Use device pixel dimensions (canvas internal size) for the SVG viewBox so coordinates match drawing space
    const vw = canvas.width, vh = canvas.height;
    overlaySvg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    overlaySvg.innerHTML = '';
    shapes.forEach(s=>{
      if(s.type==='circle'){
        const cx = s.center.x * vw; const cy = s.center.y * vh; const r = s.radius * Math.min(vw, vh);
        const cir = document.createElementNS('http://www.w3.org/2000/svg','circle');
        cir.setAttribute('cx',cx); cir.setAttribute('cy',cy); cir.setAttribute('r',r);
        if(s.id===selectedShapeId) cir.classList.add('selected');
        cir.addEventListener('pointerdown', e=>{ selectedShapeId = s.id; renderShapesUI(); updateShapeHandles(); updateHandlePositions(); });
        overlaySvg.appendChild(cir);
      } else {
        // polygon
        const pts = s.points.map(p => `${p.x*vw},${p.y*vh}`).join(' ');
        const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        poly.setAttribute('points', pts);
        if(s.id===selectedShapeId) poly.classList.add('selected');
        poly.addEventListener('pointerdown', e=>{ selectedShapeId = s.id; renderShapesUI(); updateShapeHandles(); updateHandlePositions(); });
        overlaySvg.appendChild(poly);
      }
    });
  }

  function updateShapeHandles(){
    // recreate shape handles for selected shape only
    shapeHandlesEl.innerHTML = '';
    if(!selectedShapeId) return;
    const s = shapes.find(x=>x.id===selectedShapeId);
    if(!s) return;
    const rect = canvas.getBoundingClientRect();
    if(s.type==='circle'){
      // center handle
      const cen = document.createElement('div'); cen.className = 'shape-handle'; cen.dataset.shape = s.id; cen.dataset.idx = 0;
      cen.style.left = (s.center.x * rect.width) + 'px'; cen.style.top = (s.center.y * rect.height) + 'px';
      shapeHandlesEl.appendChild(cen);
      // radius handle at angle 0
      const rpoint = {x: s.center.x + s.radius, y: s.center.y};
      const edge = document.createElement('div'); edge.className='shape-handle'; edge.dataset.shape = s.id; edge.dataset.idx = 1;
      edge.style.left = (rpoint.x * rect.width) + 'px'; edge.style.top = (rpoint.y * rect.height) + 'px';
      shapeHandlesEl.appendChild(edge);
    } else {
      s.points.forEach((p,idx)=>{
        const h = document.createElement('div'); h.className='shape-handle'; h.dataset.shape = s.id; h.dataset.idx = idx;
        h.style.left = (p.x * rect.width) + 'px'; h.style.top = (p.y * rect.height) + 'px';
        shapeHandlesEl.appendChild(h);
      });
    }
    // attach pointer events to shape handles
    Array.from(shapeHandlesEl.children).forEach(el=>{
      el.addEventListener('pointerdown', e=>{ e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); startDragShape(el.dataset.shape, Number(el.dataset.idx), e.clientX, e.clientY); });
      el.addEventListener('pointermove', e=>{ if(e.pressure===0) return; moveDrag(e.clientX, e.clientY); });
      el.addEventListener('pointerup', e=>{ endDrag(); el.releasePointerCapture && el.releasePointerCapture(e.pointerId); });
      el.addEventListener('lostpointercapture', e=> endDrag());
    });
  }

  // shape drag state
  let active = null; // reuse active var (overrides earlier definition) - supports both corner and shape drags
  function startDragShape(shapeId, idx, clientX, clientY){ active = {type:'shape', shapeId, idx, startX:clientX, startY:clientY}; }

  function updateHandlePositions(){
    const rect = canvas.getBoundingClientRect();
    handleEls.forEach((el,i)=>{
      const c = corners[i];
      const parentRect = handlesEl.getBoundingClientRect();
      el.style.left = (c.x*parentRect.width) + 'px';
      el.style.top = (c.y*parentRect.height) + 'px';
      // hide corner handles when a shape is selected
      el.style.display = selectedShapeId ? 'none' : 'block';
    });
  }

  // Interaction: unified pointer logic
  function startDrag(i, clientX, clientY){ active = {type:'corner', i, startX:clientX, startY:clientY}; }
  function moveDrag(clientX, clientY){
    if(!active) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (clientX - rect.left)/rect.width;
    const ny = (clientY - rect.top)/rect.height;
    if(active.type==='corner'){
      corners[active.i].x = Math.min(1,Math.max(0,nx));
      corners[active.i].y = Math.min(1,Math.max(0,ny));
      updateHandlePositions();
      draw();
    } else if(active.type==='shape'){
      const s = shapes.find(x=>x.id===active.shapeId);
      if(!s) return;
      if(s.type==='circle'){
        if(active.idx===0){ // center
          s.center.x = nx; s.center.y = ny;
        } else { // radius handle
          const dx = nx - s.center.x, dy = ny - s.center.y; s.radius = Math.sqrt(dx*dx+dy*dy);
        }
      } else {
        // polygon point
        const idx = active.idx;
        s.points[idx].x = Math.min(1,Math.max(0,nx));
        s.points[idx].y = Math.min(1,Math.max(0,ny));
      }
      renderOverlay();
      updateShapeHandles();
      // redraw canvas so assigned images follow the moved shape
      draw();
    }
  }
  function endDrag(){ active=null; }

  // Attach pointer events to handles (support touch and mouse)
  handleEls.forEach(el => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); startDrag(Number(el.dataset.i), e.clientX, e.clientY); });
    el.addEventListener('pointermove', e => { if(e.pressure===0) return; moveDrag(e.clientX,e.clientY); });
    el.addEventListener('pointerup', e => { endDrag(); el.releasePointerCapture && el.releasePointerCapture(e.pointerId); });
    el.addEventListener('lostpointercapture', e => endDrag());
  });

  // attach events for shape creation / deletion
  addTriangleBtn.addEventListener('click', ()=> createShape('triangle'));
  addRectangleBtn.addEventListener('click', ()=> createShape('rectangle'));
  addCircleBtn.addEventListener('click', ()=> createShape('circle'));
  deleteShapeBtn.addEventListener('click', deleteSelectedShape);

  // File load
  fileInput.addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = ()=>{
      // If a shape is selected, assign the image/video to that shape, otherwise treat as the global warp image
      if(selectedShapeId){
        const s = shapes.find(x=>x.id===selectedShapeId);
        if(s){
          // clean up any previous resource
          if(s._url){ URL.revokeObjectURL(s._url); s._url = null; }
          s.image = img;
          s.video = null;
          s._url = url; // keep object URL so browser can continue to animate GIFs
          s.imgWidth = img.width; s.imgHeight = img.height;
          // if GIF, request animation
          if(f.type === 'image/gif'){
            needsAnimation = true; updateAnimationLoop();
            s._isGif = true;
          } else {
            s._isGif = false;
          }
        }
      } else {
        // global image
        if(image && image._url){ URL.revokeObjectURL(image._url); }
        image = img; image._url = url;
        imgWidth = img.width; imgHeight = img.height;
        // keep default corners to full canvas
        corners = [ {x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1} ];
        updateHandlePositions();
        resizeCanvas();
        if(f.type === 'image/gif') { needsAnimation = true; updateAnimationLoop(); image._isGif = true; }
      }
      renderShapesUI();
      renderOverlay();
      draw();
    };
    // if it's a video file, create a HTMLVideoElement instead and assign once loaded
    if(f.type && f.type.startsWith('video/')){
      const vid = document.createElement('video'); vid.src = url; vid.loop = true; vid.muted = true; vid.playsInline = true; vid.autoplay = true;
      vid.addEventListener('loadeddata', ()=>{
        if(selectedShapeId){
          const s = shapes.find(x=>x.id===selectedShapeId);
          if(s){ if(s._url){ URL.revokeObjectURL(s._url); s._url=null; } s.video = vid; s.image = null; s.imgWidth = vid.videoWidth; s.imgHeight = vid.videoHeight; s._url = url; }
        } else { if(image && image._url){ URL.revokeObjectURL(image._url);} image = null; image = vid; image._url = url; imgWidth = vid.videoWidth; imgHeight = vid.videoHeight; corners = [ {x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1} ]; updateHandlePositions(); resizeCanvas(); }
        needsAnimation = true; updateAnimationLoop(); renderShapesUI(); renderOverlay(); draw();
      });
      // start loading
      vid.load();
      return;
    }
    img.src = url;
  });

  function updateAnimationLoop(){
    // decide whether an animation loop is needed (videos or gif images present)
    let any = false;
    if(image && image._isGif) any = true;
    for(const s of shapes){ if(s.video) any = true; if(s._isGif) any = true; }
    needsAnimation = any;
    if(needsAnimation) startAnimationLoop(); else stopAnimationLoop();
  }

  function startAnimationLoop(){
    if(animFrame) return;
    function loop(){
      draw();
      animFrame = requestAnimationFrame(loop);
    }
    animFrame = requestAnimationFrame(loop);
  }
  function stopAnimationLoop(){
    if(animFrame){ cancelAnimationFrame(animFrame); animFrame = null; }
  }

  // Grid resolution
  gridRange.addEventListener('input', ()=>{ gridLabel.textContent = gridRange.value; draw(); });

  // Reset
  resetBtn.addEventListener('click', ()=>{
    corners = [ {x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1} ];
    updateHandlePositions();
    draw();
  });

  // Save calibration
  saveBtn.addEventListener('click', ()=>{
    const data = { corners, timestamp: Date.now(), image:{width: imgWidth, height: imgHeight} };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calibration.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Load calibration
  loadBtn.addEventListener('click', ()=> loadFile.click() );
  loadFile.addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const obj = JSON.parse(reader.result);
        if(obj.corners && obj.corners.length===4){
          corners = obj.corners;
          updateHandlePositions();
          draw();
        } else alert('Invalid calibration file');
      }catch(e){ alert('Failed to parse JSON'); }
    };
    reader.readAsText(f);
  });

  // Utility: draw triangle by computing affine transform mapping src triangle -> dest triangle
  function drawTriangle(imgCanvas, sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1, dy1, dx2, dy2){
    // Compute affine transform matrix M such that M * [sx, sy, 1] -> [dx, dy, 1]
    // Solve for a,b,c,d,e,f in matrix [[a,b,c],[d,e,f],[0,0,1]] using three point correspondences.
    const A = [
      [sx0, sy0, 1, 0, 0, 0],
      [0, 0, 0, sx0, sy0, 1],
      [sx1, sy1, 1, 0, 0, 0],
      [0, 0, 0, sx1, sy1, 1],
      [sx2, sy2, 1, 0, 0, 0],
      [0, 0, 0, sx2, sy2, 1]
    ];
    const B = [dx0, dy0, dx1, dy1, dx2, dy2];
    // Solve linear system A * x = B (6x6). Use Cramers or Gaussian elimination (simple).
    // We'll implement a small gaussian elimination.
    const M = A.map((r,i)=> r.concat([B[i]])); // augmented 6x7
    const n = 6;
    for(let i=0;i<n;i++){
      // pivot
      let pivot = i;
      for(let j=i;j<n;j++) if(Math.abs(M[j][i])>Math.abs(M[pivot][i])) pivot = j;
      if(Math.abs(M[pivot][i])<1e-12) continue;
      if(pivot!==i){ const tmp=M[i]; M[i]=M[pivot]; M[pivot]=tmp; }
      const div = M[i][i];
      for(let k=i;k<=n;k++) M[i][k] /= div;
      for(let j=0;j<n;j++) if(j!==i){
        const mult = M[j][i];
        for(let k=i;k<=n;k++) M[j][k] -= mult*M[i][k];
      }
    }
    const x = new Array(n);
    for(let i=0;i<n;i++) x[i] = M[i][n];

    ctx.save();
    // Clip to destination triangle
    ctx.beginPath();
    ctx.moveTo(dx0,dy0); ctx.lineTo(dx1,dy1); ctx.lineTo(dx2,dy2); ctx.closePath();
    ctx.clip();

    // set transform: map source to destination via affine: [a b c; d e f; 0 0 1]
    ctx.setTransform(x[0], x[3], x[1], x[4], x[2], x[5]);
    // draw the image
    ctx.drawImage(imgCanvas, 0, 0);
    ctx.restore();
  }

  // We'll use an offscreen canvas sized to image and draw triangles mapped to destination.
  function draw(){
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
  // Draw global warp image (if any)
    if(image){
      // Prepare offscreen image canvas scaled to a reasonable size to keep performance
      const off = document.createElement('canvas');
      const rescale = Math.min(1024 / imgWidth, 1024 / imgHeight, 1);
      off.width = Math.round(imgWidth * rescale);
      off.height = Math.round(imgHeight * rescale);
      const octx = off.getContext('2d');
      octx.drawImage(image, 0, 0, off.width, off.height);

      // Build dest corner coordinates in pixel space of canvas
      const dst = corners.map(c => ({x: c.x * w, y: c.y * h}));

      const cols = Number(gridRange.value);
      const rows = Math.round(cols * off.height / off.width);
      const sxStep = off.width / cols;
      const syStep = off.height / rows;

      // Draw mesh cells as two triangles per cell
      for(let j=0;j<rows;j++){
        for(let i=0;i<cols;i++){
          // source triangle 1 (top-left)
          const sx0 = i * sxStep, sy0 = j * syStep;
          const sx1 = (i+1)*sxStep, sy1 = j * syStep;
          const sx2 = i*sxStep, sy2 = (j+1)*syStep;

          // compute normalized positions within source (0..1) then map to dest via bilinear interpolation of corner quad
          const u0 = sx0 / off.width, v0 = sy0 / off.height;
          const u1 = sx1 / off.width, v1 = sy1 / off.height;
          const u2 = sx2 / off.width, v2 = sy2 / off.height;

          const d0 = bilinear(u0,v0,dst);
          const d1 = bilinear(u1,v1,dst);
          const d2 = bilinear(u2,v2,dst);

          drawTriangle(off, sx0, sy0, sx1, sy1, sx2, sy2, d0.x, d0.y, d1.x, d1.y, d2.x, d2.y);

          const sx3 = (i+1)*sxStep, sy3 = (j+1)*syStep;
          const u3 = sx3 / off.width, v3 = sy3 / off.height;
          const d3 = bilinear(u3,v3,dst);
          drawTriangle(off, sx1, sy1, sx3, sy3, sx2, sy2, d1.x, d1.y, d3.x, d3.y, d2.x, d2.y);
        }
      }

      // draw corner outlines
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1,2*dpr);
      ctx.beginPath();
      ctx.moveTo(dst[0].x, dst[0].y);
      for(let k=1;k<4;k++) ctx.lineTo(dst[k].x, dst[k].y);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }

    // Draw images assigned to shapes (each shape may have its own image)
    shapes.forEach(s=>{
      if(!s.image && !s.video) return;
      // prepare offscreen for shape image
      const soff = document.createElement('canvas');
      const sres = Math.min(1024 / (s.imgWidth||512), 1024 / (s.imgHeight||512), 1);
      soff.width = Math.max(1, Math.round((s.imgWidth||512) * sres));
      soff.height = Math.max(1, Math.round((s.imgHeight||512) * sres));
      const soctx = soff.getContext('2d');
      // draw current frame from image or video into the offscreen canvas
      if(s.video){ try { soctx.drawImage(s.video, 0, 0, soff.width, soff.height); } catch(e){} }
      else if(s.image){ soctx.drawImage(s.image, 0, 0, soff.width, soff.height); }

      if(s.type==='circle'){
        const cx = s.center.x * w, cy = s.center.y * h, r = s.radius * Math.min(w,h);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.closePath(); ctx.clip();
  // draw image centered into circle
  const drawSize = 2*r;
  // preserve aspect, cover
  const ar = soff.width/soff.height;
  let dw = drawSize, dh = drawSize;
  if(soff.width/soff.height > 1) { dh = drawSize / ar; } else { dw = drawSize * ar; }
  const dx = cx - dw/2, dy = cy - dh/2;
  ctx.drawImage(soff, dx, dy, dw, dh);
  ctx.restore();
      } else if(s.type==='triangle'){
        // clip to triangle and draw image into bounding box (preserve aspect, cover)
        const p0 = s.points[0], p1 = s.points[1], p2 = s.points[2];
        const x0 = Math.min(p0.x,p1.x,p2.x)*w, x1 = Math.max(p0.x,p1.x,p2.x)*w;
        const y0 = Math.min(p0.y,p1.y,p2.y)*h, y1 = Math.max(p0.y,p1.y,p2.y)*h;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(p0.x*w,p0.y*h); ctx.lineTo(p1.x*w,p1.y*h); ctx.lineTo(p2.x*w,p2.y*h); ctx.closePath(); ctx.clip();
        // compute cover fit
  const bw = x1-x0, bh = y1-y0;
        let dw = bw, dh = bh;
        const ar = soff.width/soff.height;
        if(bw/bh > ar){ dh = bw / ar; } else { dw = bh * ar; }
        const dx = x0 + (bw-dw)/2, dy = y0 + (bh-dh)/2;
  ctx.drawImage(soff, dx, dy, dw, dh);
        ctx.restore();
      } else if(s.type==='rectangle' && s.points && s.points.length>=4){
        // treat as quad: map source image to quad using bilinear grid mapping
        const dstCorners = s.points.map(p => ({x: p.x * w, y: p.y * h}));
  // use mesh resolution slider value for shape mapping so selected shape respects the control
  const cols = Math.max(4, Math.min(128, Number(gridRange.value) || 32));
  const rows = Math.max(2, Math.round(cols * soff.height / soff.width));
        const sxStep = soff.width / cols;
        const syStep = soff.height / rows;
        for(let j=0;j<rows;j++){
          for(let i=0;i<cols;i++){
            const sx0 = i * sxStep, sy0 = j * syStep;
            const sx1 = (i+1) * sxStep, sy1 = j * syStep;
            const sx2 = i * sxStep, sy2 = (j+1) * syStep;
            const u0 = sx0 / soff.width, v0 = sy0 / soff.height;
            const u1 = sx1 / soff.width, v1 = sy1 / soff.height;
            const u2 = sx2 / soff.width, v2 = sy2 / soff.height;
            const d0 = bilinear(u0,v0,dstCorners);
            const d1 = bilinear(u1,v1,dstCorners);
            const d2 = bilinear(u2,v2,dstCorners);
            drawTriangle(soff, sx0, sy0, sx1, sy1, sx2, sy2, d0.x, d0.y, d1.x, d1.y, d2.x, d2.y);
            const sx3 = (i+1)*sxStep, sy3 = (j+1)*syStep;
            const u3 = sx3 / soff.width, v3 = sy3 / soff.height;
            const d3 = bilinear(u3,v3,dstCorners);
            drawTriangle(soff, sx1, sy1, sx3, sy3, sx2, sy2, d1.x, d1.y, d3.x, d3.y, d2.x, d2.y);
          }
        }
      }
    });
  }

  // bilinear interpolation of a unit quad to destination quad (corners in pixel coords)
  function bilinear(u,v, dstCorners){
    // dstCorners: [tl, tr, br, bl]
    const tl=dstCorners[0], tr=dstCorners[1], br=dstCorners[2], bl=dstCorners[3];
    const top = { x: tl.x + (tr.x - tl.x)*u, y: tl.y + (tr.y - tl.y)*u };
    const bottom = { x: bl.x + (br.x - bl.x)*u, y: bl.y + (br.y - bl.y)*u };
    return { x: top.x + (bottom.x - top.x)*v, y: top.y + (bottom.y - top.y)*v };
  }

  // initial layout
  function init(){
    resizeCanvas();
    updateHandlePositions();
    // allow clicking on canvas to move nearest corner quickly
    canvas.addEventListener('pointerdown', e => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      // find nearest corner
      let best = 0, bestd = Infinity;
      for(let i=0;i<4;i++){ const dx = corners[i].x - x, dy = corners[i].y - y; const d = dx*dx+dy*dy; if(d<bestd){bestd=d;best=i;} }
      startDrag(best,e.clientX,e.clientY);
    });
    // clicking on empty canvas deselects shape
    canvas.addEventListener('pointerup', e=>{
      // if pointer up without dragging a shape, keep selection as is
      // short click on background deselects
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width; const y = (e.clientY - rect.top) / rect.height;
      // check if click landed on any shape (approx)
      const hit = shapes.some(s=>{
        if(s.type==='circle'){ const dx=x-s.center.x, dy=y-s.center.y; return Math.sqrt(dx*dx+dy*dy) <= s.radius; }
        return s.points.some(p=>{ const dx=p.x-x, dy=p.y-y; return dx*dx+dy*dy < 0.02*0.02; });
      });
      if(!hit){ selectedShapeId = null; renderShapesUI(); renderOverlay(); updateShapeHandles(); }
      if(!hit){ updateHandlePositions(); }
    });
    window.addEventListener('pointermove', e => moveDrag(e.clientX,e.clientY));
    window.addEventListener('pointerup', endDrag);
  }

  init();
  // initial draw placeholder
  ctx.fillStyle='#111'; ctx.fillRect(0,0,canvas.width,canvas.height);

})();
