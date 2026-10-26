import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCanvas, loadImage} from '@napi-rs/canvas';

// Human-selected landmarks in the original, before extraction. These are not
// component IDs, generated masks, or an old production-output baseline.
export const characterFixture = {
  path: 'tests/fixtures/character-front-back.jpg',
  sha256: 'ce2cad952e7efc4228ed236736b1d5370803aa5616b251a4bbffa164cd4ea768',
  width: 1275,
  height: 750,
  crops: {front: {left: 609, width: 666}, back: {left: 0, width: 609}},
  landmarks: [
    {name: 'back tail yellow', view: 'back', x: 100, y: 450, part: 'tail', pigment: 'yellow'},
    {name: 'back thigh yellow', view: 'back', x: 450, y: 490, part: 'leg', pigment: 'yellow'},
    {name: 'front tail yellow', view: 'front', x: 1160, y: 480, part: 'tail', pigment: 'yellow'},
    {name: 'front thigh yellow', view: 'front', x: 950, y: 545, part: 'leg', pigment: 'yellow'},
    {name: 'back tail blue', view: 'back', x: 220, y: 480, part: 'tail', pigment: 'cyan'},
    {name: 'back thigh blue', view: 'back', x: 460, y: 420, part: 'leg', pigment: 'cyan'},
    {name: 'front tail blue', view: 'front', x: 1070, y: 515, part: 'tail', pigment: 'cyan'},
    {name: 'front thigh blue', view: 'front', x: 970, y: 480, part: 'leg', pigment: 'cyan'},
  ],
  // Only the eye interiors; ears, muzzle, face silhouette and fabric markings
  // are outside this window. Tiny sources are diagnostics pending a deliberate
  // manufacturing choice: black pupils and white highlights must not be erased.
  eyeWindow: {left: 770, top: 160, right: 895, bottom: 205},
};

const cyan = ([r, g, b]) => r < 25 && g > 90 && b > 150 && b - r > 130;
const yellow = ([r, g, b]) => r > 150 && g > 120 && b < 100 && r - b > 90;
const area = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0)) / 2;
function contains(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
async function decode(bytes) {
  const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return {width: image.width, height: image.height, rgba: context.getImageData(0, 0, image.width, image.height).data};
}
function sampleRing(piece, ring, pixel) {
  return ring.flatMap((node, i) => {
    const next = ring[(i + 1) % ring.length];
    const curve = piece.curves?.find(c => c.startNodeId === node.id && c.endNodeId === next.id);
    const a = pixel(node), d = pixel(next), b = curve ? pixel(curve.c1) : a, c = curve ? pixel(curve.c2) : d;
    const length = Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y)+Math.hypot(d.x-c.x,d.y-c.y);
    const count = Math.max(1, Math.ceil(length / .2));
    return Array.from({length: count}, (_, j) => {
      const t = j/count, s = 1-t;
      return {x:s*s*s*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t*t*t*d.x,
        y:s*s*s*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t*t*t*d.y};
    });
  });
}

/** Audit saved vectors directly against original JPEG positions. No production
 * segmentation, classifier, rasterizer, fitter or topology code is imported. */
export async function assertCharacterSeparation(project,{onEvidence}={}) {
  const bytes = await readFile(characterFixture.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), characterFixture.sha256);
  const original = await decode(bytes);
  assert.equal(original.width, characterFixture.width);
  assert.equal(original.height, characterFixture.height);
  const records = [], microEyePieces = [], violations=[];
  for (const view of ['front', 'back']) {
    const wholeSheet=project.references.find(r=>r.view==='sheet');
    const reference = wholeSheet??project.references.find(r => r.view === view);
    assert(reference, `Missing ${view} reference`);
    const crop = wholeSheet?{left:0,width:characterFixture.width}:characterFixture.crops[view];
    assert.equal(reference.width, crop.width);
    assert.equal(reference.height, characterFixture.height);
    const figureViews=wholeSheet?new Map((reference.illustration?.figures??[]).map(figure=>[figure.sourceGroup,figure.normalZ===1?'front':figure.normalZ===-1?'back':undefined])):undefined;
    if(wholeSheet){assert.equal(project.references.length,1);assert.equal(figureViews.size,2,'The original sheet retains both independently situated characters');assert.deepEqual(new Set(figureViews.values()),new Set(['front','back']));}
    const decoded = await decode(Buffer.from(reference.png.split(',')[1], 'base64'));
    const calibration = reference.calibration;
    const dx = calibration.b.x-calibration.a.x, dy = calibration.b.y-calibration.a.y;
    const pixel = p => ({x:crop.left+calibration.a.x+(-dy*p.xMm+dx*p.yMm)/calibration.distanceMm,
      y:calibration.a.y+(dx*p.xMm+dy*p.yMm)/calibration.distanceMm});
    const sources = project.patternLibrary.filter(s => s.referenceId === reference.id&&(!wholeSheet||figureViews.get(s.sourceGroup)===view)).map(source => {
      const rings = [source.piece.nodes, ...source.piece.holes ?? []].map(r => sampleRing(source.piece,r,pixel));
      return {source, rings};
    });
    for (const landmark of characterFixture.landmarks.filter(p => p.view === view)) {
      const sourceIds = new Set(),sourceAnatomies=new Map();
      // A 3x3 interior patch prevents a single lucky boundary point passing.
      for (let oy=-1; oy<=1; oy++) for (let ox=-1; ox<=1; ox++) {
        const x=landmark.x+ox, y=landmark.y+oy;
        const rgb=Array.from(original.rgba.subarray((y*original.width+x)*4,(y*original.width+x)*4+3));
        const matches=landmark.pigment==='yellow'?yellow:cyan;
        assert(matches(rgb), `Original ${landmark.name} patch changed at ${x},${y}: ${rgb}`);
        const local=((y*decoded.width+x-crop.left)*4);
        assert.deepEqual(Array.from(decoded.rgba.subarray(local,local+3)),rgb,'Stored crop retains original landmark RGB');
        const owners=sources.filter(s=>contains({x:x+.5,y:y+.5},s.rings[0])&&!s.rings.slice(1).some(r=>contains({x:x+.5,y:y+.5},r)));
        if(owners.length!==1){violations.push({kind:'nonunique-ownership',landmark:landmark.name,x,y,owners:owners.map(o=>o.source.piece.id)});continue;}
        const owner=owners[0].source;
        sourceIds.add(owner.piece.id);
        sourceAnatomies.set(owner.piece.id,{sourcePieceId:owner.piece.id,color:owner.piece.color,anatomy:owner.anatomy});
        if(!matches([1,3,5].map(i=>parseInt(owner.piece.color.slice(i,i+2),16))))violations.push({kind:'wrong-fabric-color',landmark:landmark.name,x,y,sourcePieceId:owner.piece.id,color:owner.piece.color});
        // A continuous body-colored thigh may keep body as its primary part.
        // Preserve both the primary and contextual anatomical classifications.
        const contexts=[owner.anatomy,...owner.anatomy?.contexts??[]];
        if(!contexts.some(c=>c?.part===landmark.part))violations.push({kind:'missing-anatomy-context',landmark:landmark.name,x,y,expectedPart:landmark.part,sourcePieceId:owner.piece.id,actual:owner.anatomy});
      }
      if(sourceIds.size!==1)violations.push({kind:'fragmented-landmark-core',landmark:landmark.name,sourcePieceIds:[...sourceIds]});
      records.push({...landmark,sourcePieceId:sourceIds.size===1?[...sourceIds][0]:null,sourcePieceIds:[...sourceIds],sources:[...sourceAnatomies.values()]});
    }
    if (view==='front') for (const {source,rings} of sources) {
      const bounds={left:Math.min(...rings[0].map(p=>p.x)),right:Math.max(...rings[0].map(p=>p.x)),
        top:Math.min(...rings[0].map(p=>p.y)),bottom:Math.max(...rings[0].map(p=>p.y))};
      const w=characterFixture.eyeWindow;
      const areaPx2=area(rings[0])-rings.slice(1).reduce((sum,r)=>sum+area(r),0);
      if(bounds.left>=w.left&&bounds.right<=w.right&&bounds.top>=w.top&&bounds.bottom<=w.bottom&&areaPx2<25)
        microEyePieces.push({id:source.piece.id,name:source.piece.name,areaPx2,bounds});
    }
  }
  for (const view of ['front','back']) for (const pigment of ['yellow','cyan']) {
    const pair=records.filter(p=>p.view===view&&p.pigment===pigment);
    if(pair[0].sourcePieceId&&pair[0].sourcePieceId===pair[1].sourcePieceId)violations.push({kind:'tail-leg-fusion',view,pigment,sourcePieceId:pair[0].sourcePieceId,landmarks:pair.map(p=>p.name)});
  }
  const evidence={landmarks:records,eyeWindow:characterFixture.eyeWindow,microEyePieces,violations,
    policy:'Independent 3x3 original RGB cores; distinct yellow/cyan tail/thigh owners; sub-25px2 eye sources reported for manufacturing review, never silently deleted'};
  await onEvidence?.(evidence);
  assert.deepEqual(violations,[],'Original JPEG semantic material ownership must satisfy every independently registered landmark');
  return evidence;
}

/** Scope checks use the actual persisted mesh as well as the recipe labels.
 * DTD retains the wearer; padded is the sewing shell ending at the collar and
 * sleeves and ankles. A changed mode flag or self-reported height cannot satisfy this. */
export function assertBodyModelScope(surface,bodyMode) {
  assert(surface?.vertices.length&&surface.faces.length,'A persisted model mesh is required');
  const parameters=surface.template.parameters;
  assert.equal(parameters.bodyMode,bodyMode);
  const regions=new Set(surface.faces.map(f=>f.region));
  const ys=surface.vertices.map(v=>v.yMm),minimumY=Math.min(...ys),maximumY=Math.max(...ys);
  const expectedBottom=bodyMode==='padded'?parameters.legLengthMm*.10:0,expectedTop=bodyMode==='padded'?parameters.heightMm*.86+25:parameters.heightMm,expectedHeight=expectedTop-expectedBottom;
  let openings=[];
  assert(Math.abs(maximumY-minimumY-expectedHeight)<=1,'Actual model extent retains its intended physical height');
  assert(Math.abs(minimumY-expectedBottom)<=1,'The model starts at its physical floor or ankle opening');
  for(const part of ['tail','ear','snout','claw'])assert(![...regions].some(r=>r===part||r.startsWith(part+'-')),`${bodyMode} excludes costume-only ${part} geometry`);
  if(bodyMode==='padded') {
    assert(![...regions].some(r=>/^(head|hand|foot)(-|$)/.test(r)),'Padded body-only garment has no head, hands or feet');
    assert(!surface.template.parts.some(r=>/^(head|hand|foot)(-|$)/.test(r)),'Padded body-only recipe excludes head, hands and feet');
    assert(surface.vertices.every(v=>v.yMm<=parameters.heightMm*.86+26),'Padded geometry stops at the collar');
    assert(Math.max(...surface.vertices.map(v=>Math.abs(v.xMm)))<=parameters.shoulderWidthMm/2+parameters.armLengthMm,
      'Padded sleeves do not extend into added hand-length geometry');
    assert.equal(surface.assembly?.garmentOpenings,5,'Padded shell explicitly declares five garment openings');
    // Count boundary loops directly on the persisted triangles. A metadata
    // flag alone cannot prove that neck/sleeve caps were actually removed.
    const edges=new Map(),adjacency=new Map(),meshAdjacency=new Map();
    for(const face of surface.faces)for(let i=0;i<3;i++){
      const a=face.vertices[i],b=face.vertices[(i+1)%3],key=[a,b].sort().join(':');
      const entry=edges.get(key);if(entry)entry.count++;else edges.set(key,{a,b,count:1});
      for(const [x,y]of [[a,b],[b,a]]){const near=meshAdjacency.get(x)??new Set();near.add(y);meshAdjacency.set(x,near);}
    }
    for(const edge of edges.values()){
      assert(edge.count<=2,'Garment mesh has no nonmanifold shared edge');
      if(edge.count!==1)continue;
      for(const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]){const near=adjacency.get(a)??new Set();near.add(b);adjacency.set(a,near);}
    }
    for(const [id,neighbors] of adjacency)assert.equal(neighbors.size,2,`Opening boundary is a simple loop at ${id}`);
    const connected=new Set();let components=0;for(const start of meshAdjacency.keys())if(!connected.has(start)){components++;const todo=[start];while(todo.length){const id=todo.pop();if(connected.has(id))continue;connected.add(id);todo.push(...meshAdjacency.get(id));}}assert.equal(components,1,'Persisted padded body is one physical connected shell');
    const vertices=new Map(surface.vertices.map(v=>[v.id,v])),unvisited=new Set(adjacency.keys());
    while(unvisited.size){
      const todo=[unvisited.values().next().value],ids=[];
      while(todo.length){const id=todo.pop();if(!unvisited.delete(id))continue;ids.push(id);for(const near of adjacency.get(id))todo.push(near);}
      assert(ids.length>=3,'An opening has at least three vertices');
      const points=ids.map(id=>vertices.get(id));
      let location='unexpected';
      if(points.every(p=>Math.abs(p.yMm-expectedTop)<=.001))location='collar';
      else if(points.every(p=>Math.abs(p.yMm-expectedBottom)<=.001)){if(points.every(p=>p.xMm<0))location='left ankle';else if(points.every(p=>p.xMm>0))location='right ankle';}
      else for(const side of [-1,1]){const cx=side*(parameters.shoulderWidthMm/2+parameters.armLengthMm*Math.sqrt(.75)),cy=parameters.heightMm*.86-70-parameters.armLengthMm/2;if(points.every(p=>Math.abs(side*Math.sqrt(.75)*(p.xMm-cx)-.5*(p.yMm-cy))<=.001))location=side<0?'left cuff':'right cuff';}
      openings.push({location,vertices:ids.length,center:points.reduce((s,v)=>[s[0]+v.xMm/points.length,s[1]+v.yMm/points.length,s[2]+v.zMm/points.length],[0,0,0]),
        minimumY:Math.min(...points.map(v=>v.yMm)),maximumY:Math.max(...points.map(v=>v.yMm))});
    }
    assert.deepEqual(openings.map(o=>o.location).sort(),['collar','left ankle','left cuff','right ankle','right cuff'],'Persisted padded mesh has one collar, two sleeves and two ankles on their physical planes');
  } else {
    assert([...regions].some(r=>r==='head'||r.startsWith('head-')),'DTD retains the wearer head');
    for(const side of ['left','right'])assert([...regions].some(r=>r==='hand-'+side||r.startsWith('hand-'+side+'-')),`DTD retains ${side} hand`);
  }
  return {bodyMode,minimumY,maximumY,expectedHeight,expectedBottom,expectedTop,regions:[...regions].sort(),openings};
}

/** Additional usability gate; native geometry and exact correspondence gates
 * still run separately. The maximum is an assertion, never a solver override. */
export function assertRegularBodyPieceBudget(project) {
  const run=project.surfaceRun;
  assert(run && !run.accepted,'Inspect a fresh candidate before acceptance');
  assert(run.pieces.length>=10&&run.pieces.length<=50,`Regular full-body result must contain 10–50 usable panels; got ${run.pieces.length}`);
  assert.equal(run.options.partitionStrategy,'design');
  assert.equal(project.pieces.length,0,'Preview must not commit production pieces');
  assert.equal(project.cuttingLibrary?.length??0,0,'Preview must not create an archived cut');
  const panels=run.pieces.map(p=>{
    const rings=[p.nodes,...p.holes??[]].map(r=>sampleRing(p,r,n=>({x:n.xMm,y:n.yMm})));
    const netAreaMm2=area(rings[0])-rings.slice(1).reduce((s,r)=>s+area(r),0);
    assert(netAreaMm2>=100,`An unmarked full-body model must not create a sub-100 mm² fragment: ${p.name} (${netAreaMm2})`);
    return {id:p.id,name:p.name,netAreaMm2};
  });
  return {pieces:panels.length,panels};
}
