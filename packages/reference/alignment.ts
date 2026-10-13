import type {Reference} from '../schema/index';
/** Calibrated A is the common origin, AB is +Y. Back-view X is mirrored into front world coordinates. */
export function referenceWorldMatrix(reference:Reference,mirrorBack=true):[number,number,number,number,number,number]{const c=reference.calibration;if(!c)throw Error('CALIBRATION_REQUIRED');const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,k=c.distanceMm/(dx*dx+dy*dy),flip=reference.view==='back'&&mirrorBack?-1:1,a=-dy*k*flip,b=-dx*k,cx=dx*k*flip,d=-dy*k;return [a,b,cx,d,-a*c.a.x-cx*c.a.y,-b*c.a.x-d*c.a.y];}
