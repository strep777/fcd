import {createHash} from 'node:crypto';
import type {Marking} from '../../../packages/schema/index';

/** Stable dependency identity shared by paint editing and exact subdivision. */
export const markingFingerprint=(m:Marking)=>createHash('sha256').update(JSON.stringify({fragments:m.fragments,paths:m.paths,color:m.color,surfaceHash:m.surfaceHash,placement:m.placement})).digest('hex');
