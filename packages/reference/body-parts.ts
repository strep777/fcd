export const bodyParts=['head','ear','horn','body','arm','paw','leg','foot','tail','unknown'] as const;
export type BodyPart=typeof bodyParts[number];
export type BodySide='left'|'right'|'center'|'unknown';
const names:Record<BodyPart,[string,string]>={head:['头','Head'],ear:['耳朵','Ears'],horn:['角','Horns'],body:['身体','Body'],arm:['手臂','Arms'],paw:['手爪','Paws'],leg:['腿','Legs'],foot:['脚','Feet'],tail:['尾巴','Tail'],unknown:['待分类','Unclassified']};
export const partName=(part:BodyPart,zh=true)=>names[part][zh?0:1];
export const sideName=(side:BodySide,zh=true)=>({left:zh?'左侧':'Left',right:zh?'右侧':'Right',center:zh?'中间':'Center',unknown:zh?'未定侧':'Unknown side'})[side];
/** Imported group names are hints; unlabelled partial meshes are never assumed to be whole bodies. */
export function namedPart(region:string):{part:BodyPart;side:BodySide}{
 const text=region.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase(),tokens=text.split(/[^a-z]+/),side:BodySide=tokens.includes('left')||/左/.test(text)?'left':tokens.includes('right')||/右/.test(text)?'right':'center';
 const rules:[BodyPart,RegExp,RegExp][]=[['ear',/^(ear|ears)$/,/耳/],['horn',/^(horn|horns|antler|antlers)$/,/角/],['foot',/^(foot|feet|toe|toes|hoof|hooves)$/,/脚|足/],['paw',/^(paw|paws|palm|finger|fingers|hand|hands)$/,/爪|手掌/],['tail',/^tail$/,/尾/],['head',/^(head|snout|muzzle|face)$/,/头|脸|吻/],['arm',/^(arm|arms|forearm|upperarm)$/,/手臂|胳膊/],['leg',/^(leg|legs|thigh|calf)$/,/腿/],['body',/^(torso|body|chest|belly|abdomen|hip|pelvis)$/,/身体|躯干|腹|胸/]];
 return {part:rules.find(([,english,chinese])=>tokens.some(t=>english.test(t))||chinese.test(text))?.[0]??'unknown',side};
}
