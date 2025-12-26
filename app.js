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
    draw();
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

  function updateHandlePositions(){
    const rect = canvas.getBoundingClientRect();
    handleEls.forEach((el,i)=>{
      const c = corners[i];
      const left = rect.left + c.x*rect.width;
      const top = rect.top + c.y*rect.height;
      // place in handles container coordinates
      const parentRect = handlesEl.getBoundingClientRect();
      el.style.left = (c.x*parentRect.width) + 'px';
      el.style.top = (c.y*parentRect.height) + 'px';
    });
  }

  // Interaction: unified pointer logic
  let active = null;
  function startDrag(i, clientX, clientY){
    active = {i, startX:clientX, startY:clientY};
  }
  function moveDrag(clientX, clientY){
    if(!active) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (clientX - rect.left)/rect.width;
    const ny = (clientY - rect.top)/rect.height;
    corners[active.i].x = Math.min(1,Math.max(0,nx));
    corners[active.i].y = Math.min(1,Math.max(0,ny));
    updateHandlePositions();
    draw();
  }
  function endDrag(){ active=null; }

  // Attach pointer events to handles (support touch and mouse)
  handleEls.forEach(el => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); startDrag(Number(el.dataset.i), e.clientX, e.clientY); });
    el.addEventListener('pointermove', e => { if(e.pressure===0) return; moveDrag(e.clientX,e.clientY); });
    el.addEventListener('pointerup', e => { endDrag(); el.releasePointerCapture && el.releasePointerCapture(e.pointerId); });
    el.addEventListener('lostpointercapture', e => endDrag());
  });

  // File load
  fileInput.addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = ()=>{
      image = img;
      imgWidth = img.width; imgHeight = img.height;
      // keep default corners to full canvas
      corners = [ {x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1} ];
      updateHandlePositions();
      resizeCanvas();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

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
    if(!image) return;

    // Prepare offscreen image canvas scaled to a reasonable size to keep performance
    const off = document.createElement('canvas');
    const rescale = Math.min(1024 / imgWidth, 1024 / imgHeight, 1);
    off.width = Math.round(imgWidth * rescale);
    off.height = Math.round(imgHeight * rescale);
    const octx = off.getContext('2d');
    octx.drawImage(image, 0, 0, off.width, off.height);

    // Build dest corner coordinates in pixel space of canvas
    const rect = canvas.getBoundingClientRect();
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

        // draw triangle: map source full canvas coords to triangle using transform. But our drawTriangle expects source triangle coordinates in the off canvas space; we'll transform so that source coordinates are placed directly.
        // To use drawTriangle which uses setTransform and then drawImage(off,0,0), we need to supply source triangle in off-space that corresponds to the triangle within the full image placed at origin: We'll use coordinates relative to off canvas directly.
        drawTriangle(off, sx0, sy0, sx1, sy1, sx2, sy2, d0.x, d0.y, d1.x, d1.y, d2.x, d2.y);

        // triangle 2 (bottom-right)
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
    window.addEventListener('pointermove', e => moveDrag(e.clientX,e.clientY));
    window.addEventListener('pointerup', endDrag);
  }

  init();
  // initial draw placeholder
  ctx.fillStyle='#111'; ctx.fillRect(0,0,canvas.width,canvas.height);

})();
