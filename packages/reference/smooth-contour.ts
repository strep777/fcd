import type {Piece} from '../schema/index';
import {recoverContour} from './recover-contour';
/** Compatibility name: reconstruct pixel-constrained geometry without
 * averaging anchors, restoring area, relaxing or beautifying shapes. */
export function smoothContour(piece:Piece,pixelMm:number,createId:()=>string):Piece{
 return recoverContour(piece,pixelMm,createId);
}
