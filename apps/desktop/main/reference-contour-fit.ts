import type {Piece} from '../../../packages/schema/index';
import type {CurveFitReport} from '../../../packages/pattern/bezier-fit';
import {recoverContour} from '../../../packages/reference/recover-contour';
import {contourBoundaryError,safeContour} from '../../../packages/reference/contour-topology';

/** Custom millimetre tolerance is an additional limit on raster recovery,
 * never permission to replace digital straight sides with smooth cubics. */
export function fitReferenceCandidate(piece:Piece,toleranceMm:number,pixelMm:number,createId:()=>string):{piece:Piece;report:CurveFitReport}{
 if(!Number.isFinite(toleranceMm)||toleranceMm<.01||toleranceMm>.5||!Number.isFinite(pixelMm)||pixelMm<=0||!piece.closed||piece.curves?.length)throw Error('INVALID_FIT');
 const report:CurveFitReport={algorithm:'bezier-ls-bounded-1',toleranceMm,maxDeviationMm:0,inputNodes:piece.nodes.length,outputNodes:piece.nodes.length,fallbackCount:1};
 try{
 const candidate={...recoverContour(piece,pixelMm,createId),holes:piece.holes};
 // Preserve the custom fitter's exact-hole contract. Validate those original
 // holes against the recovered outer ring before accepting the candidate.
 if(candidate.nodes.length>=piece.nodes.length||!safeContour(candidate,piece,pixelMm))return {piece,report};
 const limit=Math.min(toleranceMm,pixelMm/.8*1.05);
 const deviation=contourBoundaryError(candidate,piece,Math.min(pixelMm/8,limit/4),limit);
 if(!Number.isFinite(deviation)||deviation>limit)return {piece,report};
 return {piece:candidate,report:{...report,maxDeviationMm:deviation,outputNodes:candidate.nodes.length,fallbackCount:0}};
 }catch(error){
  // A very large mm/pixel calibration and a tiny requested tolerance can
  // exhaust conservative curve sampling. Keep the exact input in that case.
  if(error instanceof Error&&error.message==='RESOURCE_LIMIT')return {piece,report};
  throw error;
 }
}
