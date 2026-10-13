export type DrawingPoint={xMm:number;yMm:number};
/** Cheap bounded validation for an editable draft; the geometry worker remains authoritative. */
export function drawingIssue(nodes:DrawingPoint[]):string{
 if(nodes.length<3)return '';
 if(nodes.length>2000||nodes.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)))return 'DRAWING_LIMIT';
 const cross=(a:DrawingPoint,b:DrawingPoint,c:DrawingPoint)=>(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);
 const on=(a:DrawingPoint,b:DrawingPoint,p:DrawingPoint)=>Math.abs(cross(a,b,p))<1e-9&&p.xMm>=Math.min(a.xMm,b.xMm)-1e-9&&p.xMm<=Math.max(a.xMm,b.xMm)+1e-9&&p.yMm>=Math.min(a.yMm,b.yMm)-1e-9&&p.yMm<=Math.max(a.yMm,b.yMm)+1e-9;
 for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];if(Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm)<.0001)return 'DRAWING_DUPLICATE';for(let j=i+2;j<nodes.length;j++){if(i===0&&j===nodes.length-1)continue;const c=nodes[j],d=nodes[(j+1)%nodes.length];if(Math.max(a.xMm,b.xMm)<Math.min(c.xMm,d.xMm)||Math.max(c.xMm,d.xMm)<Math.min(a.xMm,b.xMm)||Math.max(a.yMm,b.yMm)<Math.min(c.yMm,d.yMm)||Math.max(c.yMm,d.yMm)<Math.min(a.yMm,b.yMm))continue;if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return 'DRAWING_CROSSING';}}
 const area=Math.abs(nodes.reduce((s,p,i)=>{const q=nodes[(i+1)%nodes.length];return s+p.xMm*q.yMm-q.xMm*p.yMm;},0))/2;return area<.001?'DRAWING_AREA':'';
}
