const fixtureId=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');

// An analytic, connected seven-part T-pose cloth shell, made from the union of
// rectangular torso/sleeve/leg/foot volumes. It has an open neck and cuffs.
// No production assembly, tessellator, normal classifier or cut helper is used.
// A squared shell deliberately makes exact coplanar remeshing distinguishable
// from a smooth subdivision that changes the intended garment geometry.
export const garmentOracle={
  areaMm2:3028800,boundaryLengthMm:2200,
  colorAreaMm2:{'#eceae5':2514800,'#04a3f0':388000,'#f9e33c':126000},
  parts:['torso','arm-left','arm-right','leg-left','leg-right','foot-left','foot-right'],
  handSeam:{a:[-220,1050,100],b:[220,1050,100],lengthMm:440},
  bounds:[[-650,0,-100],[650,1500,260]],
};

export function coplanarGarmentShell(){
  let serial=0;const nextId=()=>fixtureId(++serial);
  const xs=[-650,-220,-80,-40,0,40,80,220,650],ys=[0,100,700,1250,1450,1500],zs=[-100,-70,70,100,260];
  const cells=new Map(),vertices=[],faces=[],pointIds=new Map();
  const key=(i,j,k)=>i+','+j+','+k;
  for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++)for(let k=0;k<zs.length-1;k++){
    const x=(xs[i]+xs[i+1])/2,y=(ys[j]+ys[j+1])/2,z=(zs[k]+zs[k+1])/2;
    let part;
    if(Math.abs(x)<220&&y>700&&z<100)part='torso';
    else if(Math.abs(x)>220&&y>1250&&y<1450&&z<100)part=x>0?'arm-left':'arm-right';
    else if(Math.abs(x)>40&&Math.abs(x)<220&&y>100&&y<700&&z<100)part=x>0?'leg-left':'leg-right';
    else if(Math.abs(x)>40&&Math.abs(x)<220&&y<100)part=x>0?'foot-left':'foot-right';
    if(part)cells.set(key(i,j,k),part);
  }
  const vertex=p=>{const key=p.join(',');if(!pointIds.has(key)){const id=nextId();pointIds.set(key,id);vertices.push({id,xMm:p[0],yMm:p[1],zMm:p[2]});}return pointIds.get(key);};
  for(const [cell,part]of cells){
    const [i,j,k]=cell.split(',').map(Number),lo=[xs[i],ys[j],zs[k]],hi=[xs[i+1],ys[j+1],zs[k+1]];
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const neighbor=[i,j,k];neighbor[axis]+=sign;if(cells.has(key(...neighbor)))continue;
      const plane=sign>0?hi[axis]:lo[axis];
      if(axis===0&&Math.abs(plane)===650)continue; // two open sleeve cuffs
      if(axis===1&&plane===1500&&lo[0]>=-80&&hi[0]<=80&&lo[2]>=-70&&hi[2]<=70)continue; // neck opening
      const u=(axis+1)%3,v=(axis+2)%3;
      let points=[[0,0],[1,0],[1,1],[0,1]].map(([s,t])=>{const p=[...lo];p[axis]=plane;p[u]=s?hi[u]:lo[u];p[v]=t?hi[v]:lo[v];return p;});
      if(sign<0)points=points.reverse();
      const ids=points.map(vertex);for(const corners of [[0,1,2],[0,2,3]])faces.push({id:nextId(),region:part,vertices:corners.map(n=>ids[n])});
    }
  }
  return {id:nextId(),source:'obj',topologyVersion:1,vertices,faces};
}

// Exact midpoint four-way subdivision. Shared edge identities are retained;
// no vertex is projected or smoothed, and no surface/part boundary is moved.
export function subdivideCoplanarGarment(source){
  let serial=1000000;const nextId=()=>fixtureId(++serial);
  const vertices=structuredClone(source.vertices),faces=[],byId=new Map(vertices.map(v=>[v.id,v])),midpoints=new Map();
  const midpoint=(a,b)=>{const key=[a,b].sort().join(':');if(!midpoints.has(key)){const p=byId.get(a),q=byId.get(b),id=nextId(),v={id,xMm:(p.xMm+q.xMm)/2,yMm:(p.yMm+q.yMm)/2,zMm:(p.zMm+q.zMm)/2};midpoints.set(key,id);vertices.push(v);byId.set(id,v);}return midpoints.get(key);};
  for(const face of source.faces){const [a,b,c]=face.vertices,ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);for(const row of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])faces.push({...face,id:nextId(),vertices:row});}
  return {...structuredClone(source),id:nextId(),vertices,faces};
}
