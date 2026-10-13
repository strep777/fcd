import type {PrintPlan} from '../manufacturing/print-pages';
import {MESH_VERTICES,MESH_FACES,UNWRAP_FACES} from '../surface/limits';
import { z } from 'zod';
import {bodyParts} from '../reference/body-parts';
export const uuid = z.uuid();
export const entityNameSchema=z.string().min(1).max(120).refine(value=>value.trim().length>0,{message:'Name cannot be blank'});
export const bodyPartSchema=z.enum(bodyParts);
export const bodySideSchema=z.enum(['left','right','center','unknown']);
export const anatomicalContextSchema=z.object({part:bodyPartSchema,side:bodySideSchema,confidence:z.number().min(0).max(1)}).strict();
export const anatomySchema=z.object({part:bodyPartSchema,side:bodySideSchema,confidence:z.number().min(0).max(1),method:z.enum(['silhouette-1','manual']),contexts:z.array(anatomicalContextSchema).min(1).max(bodyParts.length*3).optional()}).strict();
export const modelPartSchema=z.object({region:z.string().min(1).max(80),part:bodyPartSchema,side:bodySideSchema}).strict();
export const pixelBoxSchema=z.object({minX:z.number().nonnegative().max(100000),minY:z.number().nonnegative().max(100000),maxX:z.number().positive().max(100000),maxY:z.number().positive().max(100000)}).strict().refine(b=>b.maxX>b.minX&&b.maxY>b.minY);
export const illustrationSchema=z.object({algorithm:z.enum(['illustration-1','illustration-2']),edgeClipped:z.boolean().optional(),subject:z.enum(['character','head','paw','foot']).optional(),bounds:pixelBoxSchema,partBounds:z.array(z.object({part:bodyPartSchema,side:bodySideSchema.optional(),orientationRad:z.number().finite().min(-Math.PI).max(Math.PI).optional(),frameCorners:z.array(z.object({x:z.number().finite().min(-100000).max(100000),y:z.number().finite().min(-100000).max(100000)}).strict()).length(4).optional(),bounds:pixelBoxSchema}).strict()).max(bodyParts.length*3),foregroundPixels:z.number().int().positive().max(4096*4096),discardedPixels:z.number().int().nonnegative().max(4096*4096),palette:z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(16),smoothingPx:z.number().min(0).max(2)}).strict();
export const mm = z.number().finite().min(-1e6).max(1e6);
export const pointSchema = z.object({id:uuid,xMm:mm,yMm:mm}).strict();
export const curveSchema = z.object({id:uuid,startNodeId:uuid,endNodeId:uuid,c1:pointSchema,c2:pointSchema}).strict();
export const notchSchema = z.object({id:uuid,sourceSeamId:uuid.optional(),nodeId:uuid,position:z.number().min(0).max(1),depthMm:z.number().positive().max(100),label:z.string().max(40)}).strict();
export const labelSchema = z.object({id:uuid,xMm:mm,yMm:mm,text:entityNameSchema}).strict();
export const joinSchema=z.enum(['miter','round','bevel']);
export const exportFormatSchema=z.enum(['svg','pdf','png','dxf']);
export const paperSchema=z.object({widthMm:z.number().min(50).max(5000),heightMm:z.number().min(50).max(5000),marginMm:z.number().min(0).max(100),overlapMm:z.number().min(0).max(100)}).strict().refine(p=>Math.min(p.widthMm,p.heightMm)>2*p.marginMm+p.overlapMm);
export type Paper=z.infer<typeof paperSchema>;
export type ExportFormat=z.infer<typeof exportFormatSchema>;
export type Join=z.infer<typeof joinSchema>;
export const allowanceSampleSchema=z.object({s:z.number().min(0).max(1),widthMm:z.number().min(0).max(1000)}).strict();
export const edgeAllowanceSchema=z.object({nodeId:uuid,endNodeId:uuid,samples:z.array(allowanceSampleSchema).min(2).max(64)}).strict().refine(e=>e.samples[0].s===0&&e.samples.at(-1)!.s===1&&e.samples.every((v,i)=>!i||v.s>e.samples[i-1].s),{message:'Samples must strictly increase and cover [0,1]'});
export const materialSchema=z.object({id:uuid,name:entityNameSchema,version:z.number().int().positive(),category:z.enum(['fur','foam','lining','other']),thicknessMm:z.number().min(0).max(100),furLengthMm:z.number().min(0).max(300),compensationMm:z.number().min(0).max(100),defaultAllowanceMm:z.number().min(0).max(1000),furRequired:z.boolean(),grainRequired:z.boolean(),rotationsRad:z.array(z.number().finite()).min(1).max(16),seamToleranceMm:z.number().min(0).max(100),stretchWarpRatio:z.number().min(0).max(2),stretchWeftRatio:z.number().min(0).max(2),measurementSource:z.enum(['estimated','measured']),sourceNote:z.string().max(300)}).strict();
export type Material=z.infer<typeof materialSchema>;
export const pieceSchema = z.object({sourceMaskId:uuid.optional(),
  id:uuid,name:entityNameSchema,nodes:z.array(pointSchema).min(2).max(2000),
  closed:z.boolean(),allowanceMm:z.number().finite().min(0).max(1000),
  cutQty:z.number().int().min(1).max(100),mirror:z.boolean(),
  material:entityNameSchema,materialId:uuid.optional(),grainRad:z.number().finite().optional(),allowanceSource:z.enum(['piece','material','project']).optional(),edgeAllowances:z.array(edgeAllowanceSchema).max(2000).optional(),furRad:z.number().finite(),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/),
  holes:z.array(z.array(pointSchema).min(3).max(2000)).max(32).optional(),
  curves:z.array(curveSchema).max(2000).optional(),
  join:joinSchema.optional(),miterLimit:z.number().min(1).max(20).optional(),
  notches:z.array(notchSchema).max(200).optional(),labels:z.array(labelSchema).max(100).optional()
}).strict().refine(p=>!p.closed||p.nodes.length>=3,{message:"Closed paths require at least three nodes"}).superRefine((p,ctx)=>{
 const nodes=[...p.nodes,...(p.holes??[]).flat()];
 for(const [key,items] of Object.entries({nodes,curves:p.curves??[],notches:p.notches??[],labels:p.labels??[]})){
  if(new Set(items.map(item=>item.id)).size!==items.length)ctx.addIssue({code:'custom',message:'Duplicate entity ID',path:[key]});
 }
});
export const nestingOptionsSchema=z.object({widthMm:z.number().positive().max(10000),lengthLimitMm:z.number().positive().max(1e6),marginMm:z.number().min(0).max(1000),gapMm:z.number().min(0).max(1000),alignGrain:z.boolean(),preserveLocks:z.boolean().optional(),mode:z.enum(['shelf','contour']).optional(),rotationsRad:z.array(z.number().finite()).min(1).max(16).optional(),candidateBudget:z.number().int().min(100).max(20000).optional()}).strict();
export const placementSchema=z.object({pieceId:uuid,instance:z.number().int().min(1).max(100),xMm:mm,yMm:mm,angleRad:z.number().finite(),mirror:z.boolean(),widthMm:z.number().positive(),heightMm:z.number().positive(),locked:z.boolean().optional()}).strict();
export const nestingSchema=z.object({algorithm:z.enum(['shelf-bbox-1','contour-bottom-left-1']),dependencyHash:z.string().regex(/^[a-f0-9]{64}$/),options:nestingOptionsSchema,sheets:z.array(z.object({material:z.string(),lengthMm:z.number().nonnegative(),utilization:z.number().min(0).max(1),placements:z.array(placementSchema).max(10000)}).strict()).max(100),unplaced:z.array(z.object({pieceId:uuid,instance:z.number().int(),reason:z.string()}).strict()).max(10000)}).strict();
export type NestingOptions=z.infer<typeof nestingOptionsSchema>;
export type Nesting=z.infer<typeof nestingSchema>;
export const seamSideSchema=z.object({pieceId:uuid,nodeId:uuid,endNodeId:uuid,start:z.number().min(0).max(1),end:z.number().min(0).max(1),reverse:z.boolean()}).strict().refine(s=>s.end>s.start);
export const seamSchema=z.object({id:uuid,name:entityNameSchema,a:seamSideSchema,b:seamSideSchema,expectedEaseMm:z.number().finite().min(-1000).max(1000),toleranceMm:z.number().min(0).max(100),locked:z.boolean()}).strict();
export type Seam=z.infer<typeof seamSchema>;
export const bodyParamsSchema=z.object({heightMm:z.number().min(100).max(1500),neckGirthMm:z.number().min(100).max(2000),chestGirthMm:z.number().min(200).max(3000),waistGirthMm:z.number().min(200).max(3000),hipGirthMm:z.number().min(200).max(3000),depthRatio:z.number().min(.3).max(2),chestPaddingMm:z.number().min(0).max(100),waistPaddingMm:z.number().min(0).max(100),hipPaddingMm:z.number().min(0).max(100),layerMm:z.number().min(0).max(50)}).strict();
export const speciesParamsSchema=z.object({species:z.enum(['canine','feline','rabbit','bear','deer','dragon']),legType:z.enum(['plantigrade','digitigrade']),heightMm:z.number().min(600).max(2400),neckGirthMm:z.number().min(100).max(1800),chestGirthMm:z.number().min(300).max(2400),waistGirthMm:z.number().min(250).max(2400),hipGirthMm:z.number().min(300).max(2400),shoulderWidthMm:z.number().min(150).max(900),armLengthMm:z.number().min(100).max(1000),legLengthMm:z.number().min(200).max(1400),headWidthMm:z.number().min(100).max(500),headLengthMm:z.number().min(100).max(500),snoutLengthMm:z.number().min(0).max(300),snoutWidthMm:z.number().min(20).max(350),earHeightMm:z.number().min(10).max(500),earWidthMm:z.number().min(10).max(250),earAngleRad:z.number().min(-1.2).max(1.2),tailLengthMm:z.number().min(0).max(2000),tailBaseGirthMm:z.number().min(30).max(700),tailTipGirthMm:z.number().min(0).max(500),tailCurvature:z.number().min(-1).max(1),upperArmGirthMm:z.number().min(100).max(1000),forearmGirthMm:z.number().min(80).max(900),thighGirthMm:z.number().min(150).max(1200),shinGirthMm:z.number().min(100).max(1000),pawLengthMm:z.number().min(50).max(400),pawWidthMm:z.number().min(50).max(350),footLengthMm:z.number().min(80).max(500),clawLengthMm:z.number().min(0).max(100),paddingMm:z.number().min(0).max(80),layerMm:z.number().min(0).max(50)}).strict().refine(p=>p.tailTipGirthMm<=p.tailBaseGirthMm&&p.legLengthMm<p.heightMm*.65&&p.headLengthMm<p.heightMm*.3,{message:'Incompatible proportions'});
export type SpeciesParams=z.infer<typeof speciesParamsSchema>;
export const templateSnapshotSchema=z.object({id:z.string(),version:z.enum(['1.0.0','1.1.0']),license:z.literal('original-project-source'),parameters:speciesParamsSchema,parts:z.array(z.string()).max(100),measurements:z.array(z.object({name:z.string(),targetMm:z.number(),actualMm:z.number(),residualMm:z.number()}).strict()),fit:z.object({targets:z.record(z.string(),z.number()),iterations:z.number().int().nonnegative(),toleranceMm:z.number().positive()}).strict().optional(),warnings:z.array(z.string())}).strict();
export const vertex3Schema=z.object({id:uuid,xMm:mm,yMm:mm,zMm:mm}).strict();
export const cutProjectionSchema=z.object({origin:z.tuple([mm,mm,mm]),axes:z.tuple([z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite(),z.number().finite()])])}).strict();
export const sectionInputSchema=z.object({axis:z.enum(['x','y','z']),positionMm:mm,regions:z.array(z.string().min(1).max(80)).min(1).max(200).optional()}).strict();
export const cutScopeSchema=z.object({side:z.enum(['full','left','right']),axis:z.enum(['x','y','z']),positionMm:mm,closeMidline:z.boolean()}).strict();
export const cutEdgeSchema=z.object({a:uuid,b:uuid,locked:z.boolean()}).strict();
export const cutLineSchema=z.object({id:uuid,name:entityNameSchema,kind:z.enum(['pen','freehand','section','midline']),enabled:z.boolean(),closed:z.boolean(),symmetric:z.boolean(),mirroredFrom:uuid.optional(),regions:z.array(z.string().min(1).max(80)).min(1).max(200).optional(),controlPoints:z.array(vertex3Schema).max(400),projection:cutProjectionSchema.optional(),tension:z.number().min(0).max(1),section:sectionInputSchema.optional(),edges:z.array(z.object({a:uuid,b:uuid}).strict()).max(MESH_FACES)}).strict();
export type CutLine=z.infer<typeof cutLineSchema>;
export type CutProjection=z.infer<typeof cutProjectionSchema>;
export type CutScope=z.infer<typeof cutScopeSchema>;
export const textureSchema=z.object({id:uuid,name:z.string().max(120),width:z.number().int().min(1).max(2048),height:z.number().int().min(1).max(2048),png:z.string().startsWith('data:image/png;base64,').max(24000000),sha256:z.string().regex(/^[a-f0-9]{64}$/),proxy:z.object({width:z.number().int().min(1).max(512),height:z.number().int().min(1).max(512),png:z.string().startsWith('data:image/png;base64,').max(2000000)}).strict()}).strict();
const textureUv=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
export const textureFaceSchema=z.object({faceId:uuid,textureId:uuid,uv:z.tuple([textureUv,textureUv,textureUv])}).strict();
export const customTemplateSchema=z.object({format:z.literal('fpcad-template'),formatVersion:z.literal(1),id:uuid,name:entityNameSchema,version:z.string().regex(/^\d+\.\d+\.\d+$/),license:z.string().min(1).max(300),unit:z.literal('mm'),vertices:z.array(vertex3Schema).min(4).max(3000),faces:z.array(z.object({id:uuid,vertices:z.tuple([uuid,uuid,uuid]),region:z.string().min(1).max(80)}).strict()).min(4).max(5000),morphs:z.array(z.object({name:z.string().min(1).max(60),minWeight:z.number().min(-10).max(10),maxWeight:z.number().min(-10).max(10),defaultWeight:z.number().min(-10).max(10),deltas:z.array(vertex3Schema).max(3000)}).strict().refine(m=>m.minWeight<=m.defaultWeight&&m.defaultWeight<=m.maxWeight)).max(16),measurements:z.array(z.object({name:z.string().min(1).max(60),kind:z.enum(['height','loop']),vertexIds:z.array(uuid).min(2).max(3000),targetMm:z.number().positive().max(100000),minMm:z.number().positive().max(100000),maxMm:z.number().positive().max(100000),toleranceMm:z.number().positive().max(100)}).strict().refine(m=>m.minMm<=m.targetMm&&m.targetMm<=m.maxMm&&m.minMm<m.maxMm)).min(1).max(32)}).strict();
export type CustomTemplate=z.infer<typeof customTemplateSchema>;
export const templateTargetsSchema=z.record(z.string().min(1).max(60),z.number().finite().positive().max(100000)).refine(t=>Object.keys(t).length<=32);
export const customSnapshotSchema=z.object({definition:customTemplateSchema,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),targets:templateTargetsSchema,weights:z.record(z.string(),z.number().finite()),measurements:z.array(z.object({name:z.string(),targetMm:z.number(),actualMm:z.number(),residualMm:z.number()}).strict()),solver:z.object({iterations:z.number().int().nonnegative(),converged:z.boolean(),errorBefore:z.number().nonnegative(),errorAfter:z.number().nonnegative()}).strict()}).strict();
export const surfaceSchema=z.object({partAssignments:z.array(modelPartSchema).max(500).optional(),cutBaseConstraints:z.array(cutEdgeSchema).max(MESH_FACES).optional(),cutLines:z.array(cutLineSchema).max(200).optional(),cutScope:cutScopeSchema.optional(),textures:z.array(textureSchema).max(8).optional(),textureFaces:z.array(textureFaceSchema).max(MESH_FACES).optional(),id:uuid,topologyVersion:z.number().int().positive(),source:z.enum(['obj','glb','sculpt-1','torso-loft-1','species-template-1','custom-template-1']),customTemplate:customSnapshotSchema.optional(),sculpt:z.object({baseHash:z.string().regex(/^[a-f0-9]{64}$/),originalSource:z.string().max(80),mode:z.enum(['move','smooth']),affectedVertices:z.number().int().positive().max(MESH_VERTICES)}).strict().optional(),vertices:z.array(vertex3Schema).min(3).max(MESH_VERTICES),faces:z.array(z.object({id:uuid,vertices:z.tuple([uuid,uuid,uuid]),region:z.string().min(1).max(80)}).strict()).min(1).max(MESH_FACES),parameters:bodyParamsSchema.optional(),cutConstraints:z.array(z.object({a:uuid,b:uuid,locked:z.boolean()}).strict()).max(MESH_FACES).optional(),assembly:z.object({algorithm:z.literal('manifold-union-3.5.4'),sourceHash:z.string(),components:z.literal(1),volumeMm3:z.number().positive(),toleranceMm:z.number().nonnegative(),inputFaces:z.number().int(),measurements:z.array(z.object({name:z.string(),targetMm:z.number(),actualMm:z.number(),residualMm:z.number()}).strict())}).strict().optional(),template:templateSnapshotSchema.optional()}).strict();
export const uvSchema=z.object({vertexId:uuid,xMm:mm,yMm:mm}).strict();
export const unwrapOptionsSchema=z.object({partitionStrategy:z.enum(['design','mesh']).optional(),method:z.enum(['lscm','arap']).optional(),automaticCuts:z.boolean().optional(),colorBoundaryCuts:z.boolean().optional(),normalAngleDeg:z.number().min(5).max(180).optional(),maxFacesPerPatch:z.number().int().min(1).max(2000).optional(),iterations:z.number().int().min(1).max(100).optional(),optimizeCuts:z.boolean().optional(),searchPasses:z.number().int().min(1).max(5).optional(),maxPieces:z.number().int().min(2).max(500).optional()}).strict();
export type UnwrapOptions=z.infer<typeof unwrapOptionsSchema>;
export const surfaceReportSchema=z.object({boundaryToleranceMm:z.number().nonnegative().max(.001).optional(),planarExact:z.boolean().optional(),faceIds:z.array(uuid).min(1).max(UNWRAP_FACES),uv:z.array(uvSchema).min(3).max(MESH_VERTICES),boundary:z.array(uuid).min(3).max(2000),areaErrorMax:z.number().finite().nonnegative(),edgeErrorMax:z.number().finite().nonnegative(),distortionMean:z.number().finite().nonnegative(),distortionP95:z.number().finite().nonnegative(),distortionMax:z.number().finite().nonnegative(),faceDistortion:z.array(z.object({faceId:uuid,areaError:z.number().nonnegative(),edgeError:z.number().nonnegative(),angleError:z.number().nonnegative().optional(),distortion:z.number().nonnegative()}).strict()).max(UNWRAP_FACES).optional(),arap:z.object({iterations:z.number().int().nonnegative(),energyBefore:z.number().nonnegative(),energyAfter:z.number().nonnegative(),converged:z.boolean(),reverted:z.boolean().optional()}).strict().optional(),status:z.enum(['acceptable','needsReview'])}).strict();
const barycentricSchema=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1)]);
export const trimMeshSchema=z.object({vertices:z.array(pointSchema).min(3).max(MESH_VERTICES),triangles:z.array(z.object({faceId:uuid,vertices:z.tuple([uuid,uuid,uuid]),barycentric:z.tuple([barycentricSchema,barycentricSchema,barycentricSchema])}).strict()).min(1).max(UNWRAP_FACES*8),boundary:z.array(uuid).min(3).max(2000),holes:z.array(z.array(uuid).min(3).max(2000)).max(32)}).strict();
export const bindingSchema=z.object({colorHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),trim:trimMeshSchema.optional(),adjusted:z.boolean().optional(),pieceId:uuid,surfaceId:uuid,topologyVersion:z.number().int().positive(),geometryHash:z.string().regex(/^[a-f0-9]{64}$/),surfaceHash:z.string().regex(/^[a-f0-9]{64}$/),report:surfaceReportSchema}).strict();
export const surfaceRunSchema=z.object({inputHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),designCutReport:z.object({materialDomains:z.number().int().nonnegative(),userSeams:z.number().int().nonnegative(),topologySeams:z.number().int().nonnegative(),distortionSeams:z.number().int().nonnegative(),manufacturingSeams:z.number().int().nonnegative()}).strict().optional(),colorCutReport:z.object({budgetSplits:z.number().int().nonnegative(),allowanceSplits:z.number().int().nonnegative(),topologySplits:z.number().int().nonnegative()}).strict().optional(),scope:cutScopeSchema.optional(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),algorithm:z.enum(['lscm-cg-1','lscm-arap-1']),cutPreview:z.array(z.object({id:uuid,cut:z.array(pointSchema).max(20000),cutHoles:z.array(z.array(pointSchema).max(20000)).max(32).optional()}).strict()).max(500).optional(),options:unwrapOptionsSchema.optional(),optimization:z.object({passes:z.number().int(),trials:z.number().int(),repairPasses:z.number().int().min(0).max(6).optional(),optimizedCost:z.number().optional(),initialCost:z.number(),finalCost:z.number(),improved:z.boolean()}).strict().optional(),cutEdges:z.array(z.tuple([uuid,uuid])).max(UNWRAP_FACES).optional(),pieces:z.array(pieceSchema).max(500),bindings:z.array(bindingSchema).max(500),accepted:z.boolean()}).strict();
export type Surface=z.infer<typeof surfaceSchema>;
export type BodyParams=z.infer<typeof bodyParamsSchema>;
export type SurfaceReport=z.infer<typeof surfaceReportSchema>;
export type Binding=z.infer<typeof bindingSchema>;
export type SurfaceRun=z.infer<typeof surfaceRunSchema>;
export const pixelSchema=z.object({x:z.number().finite().min(0).max(100000),y:z.number().finite().min(0).max(100000)}).strict();
export const calibrationSchema=z.object({a:pixelSchema,b:pixelSchema,distanceMm:z.number().positive().max(100000)}).strict().refine(p=>Math.hypot(p.b.x-p.a.x,p.b.y-p.a.y)>1e-6);
const imageHash=z.string().regex(/^[a-f0-9]{64}$/),pngData=z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
const imageVariant=z.object({width:z.number().int().positive().max(512),height:z.number().int().positive().max(512),png:pngData.max(2000000),sha256:imageHash,scaleX:z.number().positive(),scaleY:z.number().positive()}).strict();
export const referenceResourcesSchema=z.object({version:z.literal(1),source:z.object({mime:z.enum(['image/png','image/jpeg','image/webp']),width:z.number().int().positive().max(16384),height:z.number().int().positive().max(16384),orientation:z.number().int().min(1).max(8),data:z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(96000000),sha256:imageHash,transform:z.tuple([z.number(),z.number(),z.number(),z.number(),z.number(),z.number()])}).strict(),original:z.object({sha256:imageHash}).strict(),proxy:imageVariant,thumbnail:imageVariant}).strict();
export const referenceSchema=z.object({sheet:z.object({id:uuid,width:z.number().int().positive().max(100000),height:z.number().int().positive().max(100000),x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),png:z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(104000000).optional()}).strict().optional(),id:uuid,name:entityNameSchema,view:z.enum(['front','back']),width:z.number().int().positive().max(100000),height:z.number().int().positive().max(100000),png:z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(104000000),resources:referenceResourcesSchema.optional(),calibrationMode:z.enum(['automatic','manual']).optional(),illustration:illustrationSchema.optional(),calibration:calibrationSchema.optional()}).strict();
export const maskSchema=z.object({width:z.number().int().min(1).max(100000),height:z.number().int().min(1).max(100000),pixels:z.string().max(16777216).regex(/^[01]+$/)}).strict().refine(m=>m.pixels.length===m.width*m.height);
export const clusterOptionsSchema=z.object({space:z.enum(['lab','hsv']),clusters:z.number().int().min(2).max(16),minRegionPixels:z.number().int().min(4).max(1000)}).strict();
export const clusterReportSchema=clusterOptionsSchema.extend({iterations:z.number().int().min(1).max(20),selectedCluster:z.number().int().min(0).max(15),discardedPixels:z.number().int().min(0).max(512*512),quantizationBits:z.literal(5),palette:z.array(z.string().regex(/^#[0-9a-f]{6}$/)).min(1).max(16)}).strict();
export const curveFitReportSchema=z.object({algorithm:z.literal('bezier-ls-bounded-1'),toleranceMm:z.number().min(.01).max(.5),maxDeviationMm:z.number().nonnegative().max(.5),inputNodes:z.number().int().positive().max(200000),outputNodes:z.number().int().positive().max(200000),fallbackCount:z.number().int().nonnegative().max(100)}).strict();
export const contourRepairSchema=z.object({algorithm:z.literal('raster-diagonal-bevel-1'),corners:z.number().int().positive().max(262144),maxDeviationMm:z.number().nonnegative().max(.01),areaLossMm2:z.number().nonnegative()}).strict();
export type ContourRepair=z.infer<typeof contourRepairSchema>;
export const referenceRunSchema=z.object({referenceId:uuid,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),piece:pieceSchema,pieces:z.array(pieceSchema).min(1).max(100).optional(),mask:maskSchema.optional(),algorithm:z.enum(['color-flood-1','manual-mask-1','cluster-lab-1','cluster-hsv-1']).optional(),clustering:clusterReportSchema.optional(),curveFit:curveFitReportSchema.optional(),contourRepair:contourRepairSchema.optional(),discardedPixels:z.number().int().nonnegative().max(16777216).optional(),pixelCount:z.number().int().positive(),proxyWidth:z.number().int().positive(),proxyHeight:z.number().int().positive(),accepted:z.boolean()}).strict().refine(r=>!r.pieces||(r.pieces[0].id===r.piece.id&&new Set(r.pieces.map(p=>p.id)).size===r.pieces.length)).refine(r=>!r.mask||(r.mask.width===r.proxyWidth&&r.mask.height===r.proxyHeight));
export const maskSourceSchema=z.object({id:uuid,referenceId:uuid,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),mask:maskSchema,algorithm:z.enum(['color-flood-1','manual-mask-1','cluster-lab-1','cluster-hsv-1']),clustering:clusterReportSchema.optional(),curveFit:curveFitReportSchema.optional(),contourRepair:contourRepairSchema.optional(),discardedPixels:z.number().int().nonnegative().max(16777216).optional(),calibration:calibrationSchema,originalWidth:z.number().int().positive().max(100000),originalHeight:z.number().int().positive().max(100000)}).strict();
export type Reference=z.infer<typeof referenceSchema>;
export type Calibration=z.infer<typeof calibrationSchema>;
export type ReferenceRun=z.infer<typeof referenceRunSchema>;
export const markingPointSchema=z.object({xMm:mm,yMm:mm}).strict();
export const anatomicalPlacementSchema=z.object({algorithm:z.enum(['anatomy-1','anatomy-2']),rotationRad:z.number().finite().min(-Math.PI).max(Math.PI).optional(),sourceGroupHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),part:bodyPartSchema,side:bodySideSchema,modelSide:bodySideSchema.optional(),regions:z.array(z.string().min(1).max(80)).min(1).max(500),scaleX:z.number().positive().max(1000),scaleY:z.number().positive().max(1000),sourceCenter:z.object({xMm:mm,yMm:mm}).strict(),targetCenter:z.object({xMm:mm,yMm:mm}).strict(),reviewed:z.boolean()}).strict();
export const markingSchema=z.object({placement:anatomicalPlacementSchema.optional(),locked:z.boolean().optional(),id:uuid,name:entityNameSchema,color:z.string().regex(/^#[0-9a-fA-F]{6}$/),editMode:z.enum(['projected','uv-manual','source-manual']).optional(),cutLibraryId:uuid.optional(),cutLibrarySourceHash:z.string().optional(),source:z.enum(['reference','manual','texture','surface','inferred','cut-library']),inference:z.object({algorithm:z.enum(['adjacent-extension-1','exact-symmetry-x-1']),sourceMarkingId:uuid,sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),distanceMm:z.number().positive().max(10000),planeXmm:mm,reviewed:z.boolean()}).strict().optional(),surfaceShape:z.object({curves:z.array(z.object({startIndex:z.number().int().min(0).max(1999),c1:markingPointSchema,c2:markingPointSchema}).strict()).max(2000).optional(),regions:z.array(z.string().min(1).max(80)).min(1).max(500).optional(),holes:z.array(z.array(markingPointSchema).min(3).max(2000)).max(32).optional(),spline:z.object({algorithm:z.literal('closed-catmull-rom-1'),tension:z.number().min(0).max(1),toleranceMm:z.number().min(.01).max(.5)}).strict().optional(),nodes:z.array(markingPointSchema).min(3).max(2000),origin:z.tuple([mm,mm,mm]),axes:z.tuple([z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite(),z.number().finite()])])}).strict().optional(),textureId:uuid.optional(),textureRegion:z.object({seed:z.object({x:z.number().nonnegative(),y:z.number().nonnegative()}).strict(),tolerance:z.number().min(0).max(442),algorithm:z.literal('texture-flood-1')}).strict().optional(),sourcePieceId:uuid.optional(),sourceHash:z.string(),surfaceId:uuid,topologyVersion:z.number().int().positive(),surfaceHash:z.string(),view:z.enum(['front','back']),offsetXmm:mm,offsetYmm:mm,fragments:z.array(z.object({faceId:uuid,rings:z.array(z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1)])).min(3).max(2000)).max(32)}).strict()).max(UNWRAP_FACES),paths:z.array(z.object({pieceId:uuid,geometryHash:z.string(),rings:z.array(z.array(markingPointSchema).min(3).max(2000)).max(1000)}).strict()).max(500)}).strict();
export type Marking=z.infer<typeof markingSchema>;
export const surfaceBrushSchema=z.object({points:z.array(markingPointSchema).min(1).max(500),radiusMm:z.number().finite().min(.1).max(200),mode:z.enum(['add','erase']),shape:markingSchema.shape.surfaceShape.optional()}).strict();
export type SurfaceBrush=z.infer<typeof surfaceBrushSchema>;
export const sourceRegionOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('brush'),mode:z.enum(['add','erase']),points:z.array(markingPointSchema).min(1).max(500),radiusMm:z.number().finite().min(.1).max(200)}).strict(),
 z.object({kind:z.literal('pen'),mode:z.enum(['add','erase']),points:z.array(markingPointSchema).min(3).max(2000),spline:z.object({tension:z.number().min(0).max(1),toleranceMm:z.number().min(.01).max(.5)}).strict().optional()}).strict()
]);
export const libraryRegionEditSchema=z.object({piece:pieceSchema,operations:z.array(sourceRegionOperationSchema).max(50)}).strict();
export type SourceRegionOperation=z.infer<typeof sourceRegionOperationSchema>;
export type LibraryRegionEdit=z.infer<typeof libraryRegionEditSchema>;
export const regionSchema=z.object({anatomy:anatomySchema.optional(),piece:pieceSchema,referenceId:uuid,view:z.enum(['front','back']),category:z.string().min(1).max(80)}).strict();
export const modelRecordSchema=z.object({id:uuid,name:entityNameSchema,surface:surfaceSchema,pieces:z.array(pieceSchema).max(500).optional(),bindings:z.array(bindingSchema).max(500).optional(),markings:z.array(markingSchema).max(500).optional(),seams:z.array(seamSchema).max(500).optional()}).strict().refine(m=>m.id===m.surface.id).superRefine((m,ctx)=>{
 const seams=m.seams??[],pieces=new Map(m.pieces?.map(p=>[p.id,p]));
 if(new Set(seams.map(s=>s.id)).size!==seams.length)ctx.addIssue({code:'custom',message:'Duplicate seam ID',path:['seams']});
 for(const s of seams)for(const side of [s.a,s.b])if(!pieces.has(side.pieceId))ctx.addIssue({code:'custom',message:'Missing model seam piece',path:['seams']});
});
export const workflowNodeSchema=z.object({key:z.string().min(1).max(180),title:entityNameSchema,notes:z.string().max(4000),completed:z.boolean()}).strict();
export const cutLibraryEntrySchema=z.object({id:uuid,name:entityNameSchema,createdAt:z.iso.datetime(),sourceRevision:z.number().int().nonnegative(),surface:surfaceSchema,run:surfaceRunSchema,markings:z.array(markingSchema).max(500),seams:z.array(seamSchema).max(500)}).strict().superRefine((entry,ctx)=>{
 const pieces=new Set(entry.run.pieces.map(p=>p.id)),faces=new Set(entry.surface.faces.map(f=>f.id));
 if(!entry.run.accepted||!entry.run.pieces.length||pieces.size!==entry.run.pieces.length)ctx.addIssue({code:'custom',message:'Cut archive must contain accepted unique pieces'});
 if(entry.run.bindings.length!==pieces.size||new Set(entry.run.bindings.map(b=>b.pieceId)).size!==pieces.size)ctx.addIssue({code:'custom',message:'Cut archive binding mismatch'});
 for(const b of entry.run.bindings)if(!pieces.has(b.pieceId)||b.surfaceId!==entry.surface.id||b.topologyVersion!==entry.surface.topologyVersion||b.report.faceIds.some(id=>!faces.has(id)))ctx.addIssue({code:'custom',message:'Cut archive surface mismatch'});
 for(const m of entry.markings)if(m.surfaceId!==entry.surface.id||m.topologyVersion!==entry.surface.topologyVersion||m.fragments.some(f=>!faces.has(f.faceId))||m.paths.some(p=>!pieces.has(p.pieceId)))ctx.addIssue({code:'custom',message:'Cut archive marking mismatch'});
 for(const seam of entry.seams)if(!pieces.has(seam.a.pieceId)||!pieces.has(seam.b.pieceId))ctx.addIssue({code:'custom',message:'Cut archive seam mismatch'});
});
export type CutLibraryEntry=z.infer<typeof cutLibraryEntrySchema>;
export const projectSchema = z.object({schemaVersion:z.literal(2),id:uuid,name:entityNameSchema,unit:z.literal('mm'),revision:z.number().int().nonnegative(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),pieces:z.array(pieceSchema).max(500),cuttingLibrary:z.array(cutLibraryEntrySchema).max(100).optional(),activeCutId:uuid.optional(),patternLibrary:z.array(regionSchema).max(500).optional(),modelLibrary:z.array(modelRecordSchema).max(30).optional(),workflow:z.array(workflowNodeSchema).max(1000).optional(),previewMarkings:z.array(markingSchema).max(500).optional(),materials:z.array(materialSchema).max(100).optional(),defaultAllowanceMm:z.number().min(0).max(1000).optional(),nesting:nestingSchema.optional(),seams:z.array(seamSchema).max(500).optional(),surface:surfaceSchema.optional(),surfaceRun:surfaceRunSchema.optional(),bindings:z.array(bindingSchema).max(500).optional(),maskSources:z.array(maskSourceSchema).max(20).optional(),references:z.array(referenceSchema).max(2).optional(),referenceRun:referenceRunSchema.optional(),markings:z.array(markingSchema).max(500).optional()}).strict().superRefine((p,ctx)=>{for(const [name,items] of Object.entries({pieces:p.pieces,maskSources:p.maskSources??[],materials:p.materials??[],seams:p.seams??[],references:p.references??[],markings:p.markings??[],models:p.modelLibrary??[],cuts:p.cuttingLibrary??[],regions:(p.patternLibrary??[]).map(r=>r.piece),workflow:(p.workflow??[]).map(n=>({id:n.key}))})){const ids=items.map(v=>v.id);if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'Duplicate entity ID',path:[name]});}for(const piece of p.pieces)if(piece.sourceMaskId&&!p.maskSources?.some(m=>m.id===piece.sourceMaskId))ctx.addIssue({code:'custom',message:'Missing mask source',path:['pieces']});const names=(p.materials??[]).map(m=>m.name.trim().toLocaleLowerCase());if(new Set(names).size!==names.length)ctx.addIssue({code:'custom',message:'Duplicate material name',path:['materials']});});
export type Point = z.infer<typeof pointSchema>;
export type Piece = z.infer<typeof pieceSchema>;
export type Project = z.infer<typeof projectSchema>;
export const workflowFileSchema=z.object({format:z.literal('fpcad-workflow'),version:z.literal(1),project:projectSchema}).strict();
/** Upgrade snapshots in memory; source files/history rows are left intact until an explicit new save/commit. */
export function parseProject(raw:unknown):Project {const value=z.object({schemaVersion:z.union([z.literal(1),z.literal(2)])}).passthrough().parse(raw);return projectSchema.parse({...value,schemaVersion:2});}
export const commandSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('surface.classify'),kind:z.enum(['body','body-feet','head','paw','foot']),side:bodySideSchema.optional(),footBoundaryMm:mm.optional()}).strict(),
 z.object({type:z.literal('surface.anatomy'),faceRegions:z.array(z.object({faceId:uuid,region:z.string().min(1).max(80)}).strict()).max(MESH_FACES).optional(),assignments:z.array(modelPartSchema).min(1).max(500)}).strict(),
 z.object({type:z.literal('markings.batch'),markings:z.array(markingSchema).max(500)}).strict(),
 z.object({type:z.literal('marking.placement.review'),markingIds:z.array(uuid).min(1).max(500),reviewed:z.boolean()}).strict(),
 z.object({type:z.literal('library.regions'),regions:z.array(regionSchema).max(500),references:z.array(referenceSchema).max(2).optional(),replaceViews:z.array(z.enum(['front','back'])).max(2)}).strict(),
 z.object({type:z.literal('library.region.put'),region:regionSchema}).strict(),
 z.object({type:z.literal('library.region.update'),region:regionSchema,markings:z.array(markingSchema).max(500),models:z.array(modelRecordSchema).max(30).optional()}).strict(),
 z.object({type:z.literal('library.region.delete'),pieceId:uuid}).strict(),
 z.object({type:z.literal('library.regions.delete'),pieceIds:z.array(uuid).min(1).max(500).refine(ids=>new Set(ids).size===ids.length)}).strict(),
 z.object({type:z.literal('model.activate'),modelId:uuid}).strict(),
 z.object({type:z.literal('model.rename'),modelId:uuid,name:z.string().trim().min(1).max(120)}).strict(),
 z.object({type:z.literal('model.delete'),modelId:uuid}).strict(),
 z.object({type:z.literal('workflow.node'),node:workflowNodeSchema}).strict(),
 z.object({type:z.literal('piece.trim'),pieceId:uuid,startId:uuid,endId:uuid}).strict(),
 z.object({type:z.literal('piece.join'),a:uuid,b:uuid,reverseA:z.boolean(),reverseB:z.boolean()}).strict(),
 z.object({type:z.literal('piece.split'),pieceId:uuid,nodeId:uuid,t:z.number().gt(0).lt(1)}).strict(),
 z.object({type:z.literal('material.put'),material:materialSchema}).strict(),
 z.object({type:z.literal('material.delete'),materialId:uuid}).strict(),
 z.object({type:z.literal('project.allowance'),widthMm:z.number().min(0).max(1000)}).strict(),
 z.object({type:z.literal('marking.put'),marking:markingSchema}).strict(),
 z.object({type:z.literal('marking.source.update'),piece:pieceSchema,markings:z.array(markingSchema).min(1).max(500),models:z.array(modelRecordSchema).max(30).optional()}).strict(),
 z.object({type:z.literal('marking.review'),markingId:uuid,reviewed:z.boolean()}).strict(),
 z.object({type:z.literal('marking.lock'),markingId:uuid,locked:z.boolean()}).strict(),
 z.object({type:z.literal('markings.lockAll'),locked:z.boolean()}).strict(),
 z.object({type:z.literal('markings.clear')}).strict(),
 z.object({type:z.literal('marking.delete'),markingId:uuid}).strict(),
 z.object({type:z.literal('reference.put'),reference:referenceSchema}).strict(),
 z.object({type:z.literal('reference.calibrate'),referenceId:uuid,calibration:calibrationSchema}).strict(),
 z.object({type:z.literal('reference.delete'),referenceId:uuid}).strict(),
 z.object({type:z.literal('reference.candidate'),run:referenceRunSchema,library:z.boolean().optional()}).strict(),
 z.object({type:z.literal('reference.accept'),library:z.boolean().optional()}).strict(),
 z.object({type:z.literal('reference.masks.clean')}).strict(),
 z.object({type:z.literal('surface.set'),surface:surfaceSchema}).strict(),
 z.object({type:z.literal('surface.resize'),scale:z.number().positive().max(100000).optional(),dimensionsMm:z.object({width:z.number().nonnegative().max(100000),height:z.number().nonnegative().max(100000),depth:z.number().nonnegative().max(100000)}).strict().optional()}).strict().refine(c=>(c.scale===undefined)!==(c.dimensionsMm===undefined)),
 z.object({type:z.literal('surface.split'),a:uuid,b:uuid,t:z.number().gt(0).lt(1)}).strict(),
 z.object({type:z.literal('surface.curve'),id:uuid.optional(),name:entityNameSchema,kind:z.enum(['pen','freehand']),regions:z.array(z.string().min(1).max(80)).min(1).max(200).optional(),controlPoints:z.array(vertex3Schema).min(2).max(400),projection:cutProjectionSchema,tension:z.number().min(0).max(1),closed:z.boolean(),symmetric:z.boolean()}).strict(),
 z.object({type:z.literal('surface.section'),id:uuid.optional(),name:entityNameSchema,section:sectionInputSchema}).strict(),
 z.object({type:z.literal('surface.cutScope'),scope:cutScopeSchema}).strict(),
 z.object({type:z.literal('surface.cutLine.meta'),lineId:uuid,name:entityNameSchema,enabled:z.boolean()}).strict(),
 z.object({type:z.literal('surface.cutLine.delete'),lineId:uuid}).strict(),

 z.object({type:z.literal('surface.refined'),surface:surfaceSchema,markings:z.array(markingSchema).max(500)}).strict(),
 z.object({type:z.literal('unwrap.candidate'),run:surfaceRunSchema,markings:z.array(markingSchema).max(500).optional()}).strict(),
 z.object({type:z.literal('unwrap.accept')}).strict(),
 z.object({type:z.literal('cutting.activate'),entryId:uuid}).strict(),
 z.object({type:z.literal('cutting.delete'),entryId:uuid}).strict(),
  z.object({type:z.literal('seam.put'),seam:seamSchema}).strict(),
  z.object({type:z.literal('seam.delete'),seamId:uuid}).strict(),
  z.object({type:z.literal('nesting.set'),nesting:nestingSchema}).strict(),
  z.object({type:z.literal('pieces.replace'),removeIds:z.array(uuid).max(100),pieces:z.array(pieceSchema).max(500)}).strict(),
  z.object({type:z.literal('piece.put'),piece:pieceSchema}).strict(),
  z.object({type:z.literal('piece.adjusted'),piece:pieceSchema,bindings:z.array(bindingSchema).max(500),markings:z.array(markingSchema).max(500)}).strict(),
  z.object({type:z.literal('piece.delete'),pieceId:uuid}).strict(),
  z.object({type:z.literal('project.rename'),name:entityNameSchema}).strict()
]);
export type Command = z.infer<typeof commandSchema>;
const base = {protocolVersion:z.literal(1),requestId:uuid};
const projectBase = {...base,projectId:uuid,expectedRevision:z.number().int().nonnegative()};
const empty = z.object({}).strict();
// Whole-project and selected-pattern exports share a finite warning budget.
const warningAckIdsSchema=z.array(z.string()).max(5000);
export const requestSchema = z.discriminatedUnion('method',[
  z.object({...base,method:z.literal('session.read'),payload:empty}).strict(),
  z.object({...base,method:z.literal('session.delete'),payload:z.object({sessionId:uuid}).strict()}).strict(),
  z.object({...base,method:z.literal('session.activate'),payload:z.object({sessionId:uuid}).strict()}).strict(),
  z.object({...base,method:z.literal('project.create'),payload:z.object({name:entityNameSchema,unit:z.literal('mm')}).strict()}).strict(),
  z.object({...base,method:z.literal('project.open'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('project.save'),payload:z.object({saveAs:z.boolean()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('command.apply'),payload:commandSchema}).strict(),
  z.object({...projectBase,method:z.literal('command.undo'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('command.redo'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('validation.run'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('marking.auto'),payload:z.object({pieceIds:z.array(uuid).min(1).max(500),parts:z.array(bodyPartSchema).min(1).max(bodyParts.length).optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('reference.auto'),payload:z.object({subject:z.enum(['character','head','paw','foot']).optional(),mode:z.enum(['simple','precise']).optional(),layout:z.enum(['separate','front-left','front-right']),heightMm:z.number().min(1).max(10000),clusters:z.number().int().min(2).max(16),excludeBackground:z.boolean()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('reference.splitAll'),payload:z.object({swapViews:z.boolean().optional(),subject:z.enum(['character','head','paw','foot']).optional(),mode:z.enum(['simple','precise']).optional(),heightMm:z.number().min(1).max(10000),clusters:z.number().int().min(2).max(16),excludeBackground:z.boolean()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('workflow.file'),payload:z.object({action:z.enum(['import','export'])}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('patterns.bundle'),payload:z.object({action:z.enum(['import','export'])}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('patterns.output'),payload:z.object({pieceIds:z.array(uuid).min(1).max(500),format:z.enum(['pdf','svg','print']),paper:paperSchema,warningAckIds:warningAckIdsSchema,pageNumbers:z.array(z.number().int().min(1).max(200)).min(1).max(200).optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('patterns.preview'),payload:z.object({overviewOnly:z.boolean().optional(),pieceIds:z.array(uuid).min(1).max(500),paper:paperSchema,warningAckIds:warningAckIdsSchema}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('reference.import'),payload:z.object({view:z.enum(['front','back'])}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('reference.segment'),payload:z.object({referenceId:uuid,seed:pixelSchema,tolerance:z.number().min(0).max(442),options:clusterOptionsSchema.optional(),fitToleranceMm:z.number().min(.01).max(.5).optional(),library:z.boolean().optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('reference.mask'),payload:z.object({referenceId:uuid,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),mask:maskSchema,color:z.string().regex(/^#[0-9a-fA-F]{6}$/),library:z.boolean().optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('reference.accept'),payload:z.object({library:z.boolean().optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('marking.source.edit'),payload:z.object({pieceId:uuid,nodeId:uuid,xMm:mm,yMm:mm,replaceManual:z.boolean()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('library.region.edit'),payload:z.object({pieceId:uuid,edit:libraryRegionEditSchema}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('marking.edit'),payload:z.object({markingId:uuid,pieceId:uuid,rings:z.array(z.array(markingPointSchema).min(3).max(2000)).min(1).max(32)}).strict()}).strict(),
 z.object({...projectBase,method:z.literal('marking.infer'),payload:z.object({markingId:uuid,mode:z.enum(['extend','symmetry']),distanceMm:z.number().positive().max(10000),planeXmm:mm}).strict()}).strict(),
 z.object({...projectBase,method:z.literal('marking.surface.edit'),payload:z.object({markingId:uuid,shape:markingSchema.shape.surfaceShape.unwrap()}).strict()}).strict(),
 z.object({...projectBase,method:z.literal('marking.surface.brush'),payload:z.object({markingId:uuid,stroke:surfaceBrushSchema}).strict()}).strict(),
 z.object({...projectBase,method:z.literal('marking.surface'),payload:z.object({shape:markingSchema.shape.surfaceShape.unwrap(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),name:entityNameSchema}).strict()}).strict(),
 z.object({...projectBase,method:z.literal('marking.texture'),payload:z.object({textureId:uuid,seed:z.object({x:z.number().nonnegative(),y:z.number().nonnegative()}).strict(),tolerance:z.number().min(0).max(442)}).strict()}).strict(),
 z.object({...projectBase,method:z.literal('marking.project'),payload:z.object({pieceId:uuid,view:z.enum(['front','back']),offsetXmm:mm,offsetYmm:mm,replaceManual:z.boolean().optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('seam.notches'),payload:z.object({seamId:uuid,count:z.number().int().min(1).max(20),depthMm:z.number().positive().max(100)}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('pattern.corner'),payload:z.object({pieceId:uuid,nodeId:uuid,kind:z.enum(['round','bevel']),sizeMm:z.number().positive().max(1000)}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('pattern.import'),payload:z.object({scale:z.number().positive().max(10000)}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('surface.export'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('surface.import'),payload:z.object({scale:z.number().positive().max(10000)}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('species.generate'),payload:speciesParamsSchema}).strict(),
  z.object({...projectBase,method:z.literal('species.assemble'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('template.import'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('template.export'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('species.fit'),payload:z.object({targets:templateTargetsSchema}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('template.morph'),payload:z.object({weights:z.record(z.string().max(60),z.number().min(-10).max(10))}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('surface.sculpt'),payload:z.object({center:z.object({xMm:mm,yMm:mm,zMm:mm}).strict(),radiusMm:z.number().positive().max(100000),delta:z.object({xMm:z.number().min(-1000).max(1000),yMm:z.number().min(-1000).max(1000),zMm:z.number().min(-1000).max(1000)}).strict(),mode:z.enum(['move','smooth']),strength:z.number().positive().max(1)}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('template.fit'),payload:z.object({targets:templateTargetsSchema}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('body.generate'),payload:bodyParamsSchema}).strict(),
  z.object({...projectBase,method:z.literal('surface.cancel'),payload:empty}).strict(),
  z.object({...projectBase,method:z.literal('surface.unwrap'),payload:unwrapOptionsSchema}).strict(),
  z.object({...projectBase,method:z.literal('surface.accept'),payload:z.object({acknowledgeReview:z.boolean()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('nesting.run'),payload:nestingOptionsSchema}).strict(),
  z.object({...projectBase,method:z.literal('pattern.boolean'),payload:z.object({a:uuid,b:uuid,operation:z.enum(['union','difference','intersection','xor'])}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('pattern.allowance'),payload:z.object({pieceId:uuid,edgeAllowances:z.array(edgeAllowanceSchema).max(2000),allowanceSource:z.enum(['piece','material','project'])}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('pattern.offset'),payload:z.object({pieceId:uuid,distanceMm:z.number().finite().min(0).max(1000),join:joinSchema}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('job.cancel'),payload:z.object({jobId:uuid}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('result.discard'),payload:z.object({jobId:uuid}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('result.accept'),payload:z.object({jobId:uuid,resultHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('export.create'),payload:z.object({format:exportFormatSchema,warningAckIds:warningAckIdsSchema,paper:paperSchema.optional(),nested:z.boolean().optional()}).strict()}).strict(),
  z.object({...projectBase,method:z.literal('recovery.restore'),payload:z.object({revision:z.number().int().nonnegative()}).strict()}).strict()
]);
export type Request = z.infer<typeof requestSchema>;
export interface Issue {ruleId:string;severity:'error'|'warning';entityId:string;messageKey:string}
export interface Geometry {notchSegments?:{id:string;start:{xMm:number;yMm:number};end:{xMm:number;yMm:number};label:string}[];id:string;cut:Point[];seam?:Point[];seamHoles?:Point[][];cutHoles?:Point[][];edgeLengths?:{nodeId:string;endNodeId:string;lengthMm:number}[];areaMm2:number;perimeterMm:number;issues:Issue[]}
export type JobStatus='queued'|'running'|'succeeded'|'failed'|'cancelled'|'accepted'|'discarded'|'stale';
export interface JobSummary {id:string;pieceId:string;pieceName:string;distanceMm:number;baseRevision:number;status:JobStatus;sequence:number;resultHash:string|null;errorCode:string|null;issues:Issue[]}
export interface Session { sessionId?:string; notice?:'PROJECT_INVALID'|'STORAGE_RECLAIM_FAILED';project:Project|null; geometry:Geometry[]; canUndo:boolean;canRedo:boolean; savedRevision:number|null; recovery:number[]; history:{revision:number;type:string}[]; recent:{sessionId:string;name:string;revision:number}[];jobs:JobSummary[] }
export type PatternOverview={svg:string;widthMm:number;heightMm:number;revision:number;pieceIds:string[]};
export type PrintPreview={svg:string;plan:PrintPlan;revision:number;pieceIds:string[]};
export type Response = {ok:true;data:Session; cancelled?:boolean;autoPlacementReport?:{placed:number;skipped:{pieceId:string;name:string;reason:string}[]};printPreview?:PrintPreview;patternOverview?:PatternOverview}|{ok:false;error:{code:string;messageKey:string}};
export interface DesktopApi {assistantSettings(request:import('./assistant-config').AssistantSettingsRequest):Promise<import('./assistant-config').AssistantSettingsResponse>;cancelSurface(id:string,revision:number):Promise<Response>;allowance(projectId:string,expectedRevision:number,pieceId:string,edgeAllowances:Piece['edgeAllowances'],allowanceSource:'piece'|'material'|'project'):Promise<Response>;read():Promise<Response>;activate(sessionId:string):Promise<Response>;deleteSession(sessionId:string):Promise<Response>;create(payload:{name:string;unit:'mm'}):Promise<Response>;open():Promise<Response>;save(projectId:string,expectedRevision:number,saveAs:boolean):Promise<Response>;apply(projectId:string,expectedRevision:number,payload:Command):Promise<Response>;undo(projectId:string,expectedRevision:number):Promise<Response>;redo(projectId:string,expectedRevision:number):Promise<Response>;validate(projectId:string,expectedRevision:number):Promise<Response>;export(projectId:string,expectedRevision:number,format:ExportFormat,warningAckIds:string[],paper?:Paper,nested?:boolean):Promise<Response>;restore(projectId:string,expectedRevision:number,revision:number):Promise<Response>}
declare global {interface Window {fpcad:DesktopApi}}
export interface DesktopApi {assistantSettings(request:import('./assistant-config').AssistantSettingsRequest):Promise<import('./assistant-config').AssistantSettingsResponse>;patternPreview(id:string,revision:number,pieceIds:string[],paper:Paper,warningAckIds:string[]):Promise<Response>;
 patternOverview(id:string,revision:number,pieceIds:string[],paper:Paper,warningAckIds:string[]):Promise<Response>;
 autoPlaceMarkings(id:string,revision:number,pieceIds:string[],parts?:z.infer<typeof bodyPartSchema>[]):Promise<Response>;
 autoReference(id:string,revision:number,layout:'separate'|'front-left'|'front-right',heightMm:number,clusters:number,excludeBackground:boolean,mode?:'simple'|'precise',subject?:'character'|'head'|'paw'|'foot'):Promise<Response>;
 splitAllReferences(id:string,revision:number,heightMm:number,clusters:number,excludeBackground:boolean,mode?:'simple'|'precise',subject?:'character'|'head'|'paw'|'foot',swapViews?:boolean):Promise<Response>;
 workflowFile(id:string,revision:number,action:'import'|'export'):Promise<Response>;
 patternBundle(id:string,revision:number,action:'import'|'export'):Promise<Response>;
 patternOutput(id:string,revision:number,pieceIds:string[],format:'pdf'|'svg'|'print',paper:Paper,warningAckIds:string[],pageNumbers?:number[]):Promise<Response>;
 editMarking(projectId:string,expectedRevision:number,markingId:string,pieceId:string,rings:{xMm:number;yMm:number}[][]):Promise<Response>;
 inferMarking(projectId:string,expectedRevision:number,markingId:string,mode:'extend'|'symmetry',distanceMm:number,planeXmm:number):Promise<Response>;
 editSurfaceMarking(projectId:string,expectedRevision:number,markingId:string,shape:NonNullable<Marking['surfaceShape']>):Promise<Response>;
 brushSurfaceMarking(projectId:string,expectedRevision:number,markingId:string,stroke:SurfaceBrush):Promise<Response>;
 surfaceMarking(projectId:string,expectedRevision:number,shape:NonNullable<Marking['surfaceShape']>,color:string,name:string):Promise<Response>;
 textureMarking(projectId:string,expectedRevision:number,textureId:string,seed:{x:number;y:number},tolerance:number):Promise<Response>;
 projectMarking(projectId:string,expectedRevision:number,pieceId:string,view:'front'|'back',offsetXmm:number,offsetYmm:number,replaceManual?:boolean):Promise<Response>;
 importReference(projectId:string,expectedRevision:number,view:'front'|'back'):Promise<Response>;
 editMarkingSource(id:string,revision:number,pieceId:string,nodeId:string,xMm:number,yMm:number,replaceManual:boolean):Promise<Response>;
 editLibraryRegion(id:string,revision:number,pieceId:string,edit:LibraryRegionEdit):Promise<Response>;
 maskReference(id:string,revision:number,referenceId:string,sourceHash:string,mask:z.infer<typeof maskSchema>,color:string,library?:boolean):Promise<Response>;
 segmentReference(projectId:string,expectedRevision:number,referenceId:string,seed:{x:number;y:number},tolerance:number,options?:z.infer<typeof clusterOptionsSchema>,fitToleranceMm?:number,library?:boolean):Promise<Response>;
 acceptReference(projectId:string,expectedRevision:number,library?:boolean):Promise<Response>;
 importTemplate(id:string,revision:number):Promise<Response>;
 exportTemplate(id:string,revision:number):Promise<Response>;
 fitTemplate(id:string,revision:number,targets:Record<string,number>):Promise<Response>;
 fitSpecies(projectId:string,expectedRevision:number,targets:Record<string,number>):Promise<Response>;
 morphTemplate(projectId:string,expectedRevision:number,weights:Record<string,number>):Promise<Response>;
 sculptSurface(projectId:string,expectedRevision:number,input:{center:{xMm:number;yMm:number;zMm:number};radiusMm:number;delta:{xMm:number;yMm:number;zMm:number};mode:'move'|'smooth';strength:number}):Promise<Response>;
 corner(projectId:string,expectedRevision:number,pieceId:string,nodeId:string,kind:'round'|'bevel',sizeMm:number):Promise<Response>;
 importPattern(projectId:string,expectedRevision:number,scale:number):Promise<Response>;
 pairNotches(projectId:string,expectedRevision:number,seamId:string,count:number,depthMm:number):Promise<Response>;
 exportSurface(projectId:string,expectedRevision:number):Promise<Response>;
 importSurface(projectId:string,expectedRevision:number,scale:number):Promise<Response>;
 assembleSpecies(projectId:string,expectedRevision:number):Promise<Response>;
 generateSpecies(projectId:string,expectedRevision:number,parameters:SpeciesParams):Promise<Response>;
 generateBody(projectId:string,expectedRevision:number,parameters:BodyParams):Promise<Response>;
 unwrapSurface(projectId:string,expectedRevision:number,options?:UnwrapOptions):Promise<Response>;
 acceptSurface(projectId:string,expectedRevision:number,acknowledgeReview:boolean):Promise<Response>;
 nest(projectId:string,expectedRevision:number,options:NestingOptions):Promise<Response>;
 offset(projectId:string,expectedRevision:number,pieceId:string,distanceMm:number,join?:Join):Promise<Response>;
 boolean(projectId:string,expectedRevision:number,a:string,b:string,operation:"union"|"difference"|"intersection"|"xor"):Promise<Response>;
 cancelJob(projectId:string,expectedRevision:number,jobId:string):Promise<Response>;
 acceptResult(projectId:string,expectedRevision:number,jobId:string,resultHash:string):Promise<Response>;
 discardResult(projectId:string,expectedRevision:number,jobId:string):Promise<Response>;
 onChanged(callback:()=>void):()=>void;
 onStorageError(callback:()=>void):()=>void;
}

export interface AssistantConnection {enabled:boolean;endpoint:string;token:string;connected:boolean;lastRequestAt?:string;methods:string[];commands:string[]}
export type AssistantReply={ok:true;connection:AssistantConnection}|{ok:false;error:{code:string;messageKey:string}};
export interface DesktopApi {assistantSettings(request:import('./assistant-config').AssistantSettingsRequest):Promise<import('./assistant-config').AssistantSettingsResponse>;assistant(action:"status"|"enable"|"disable"):Promise<AssistantReply>}




