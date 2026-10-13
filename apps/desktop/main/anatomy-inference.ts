import type {Project} from '../../../packages/schema/index';
import {markingFingerprint,staleMarkingIds} from './markings';

/** Metadata rebasing preserves existing approval and never repairs invalid inputs. */
export function rebaseAnatomyInferences(previous:Project,next:Project){
 const stale=staleMarkingIds(previous),parents=new Map(previous.markings?.map(m=>[m.id,m])),updated=new Map(next.markings?.map(m=>[m.id,m]));
 for(const m of next.markings??[]){
  const inference=m.inference;if(!inference||stale.has(m.id))continue;
  const parent=parents.get(inference.sourceMarkingId),replacement=updated.get(inference.sourceMarkingId);
  if(parent&&replacement&&!parent.inference&&!stale.has(parent.id)&&inference.sourceFingerprint===markingFingerprint(parent))m.inference={...inference,sourceFingerprint:markingFingerprint(replacement)};
 }
}
