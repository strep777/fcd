/** CSS tokens for UI-only canvas backgrounds; face/texture/marking colors remain project data. */
export function canvasTheme(element:HTMLElement){
 const css=getComputedStyle(element),color=(name:string,fallback:string)=>css.getPropertyValue(name).trim()||fallback;
 const background=color('--model-canvas','#e9eff8');
 const rgb=[1,3,5].map(i=>parseInt(background.slice(i,i+2),16)/255) as [number,number,number];
 return {background,rgb,shadow:color('--studio-navy','#0d3b66'),wire:color('--border','#cbdbe8'),
  accent:color('--accent','#176778'),ink:color('--studio-deep','#022b3a'),
  coral:color('--studio-coral','#f95738'),teal:color('--studio-teal','#1f7a8c'),
  yellow:color('--studio-yellow','#f4d35e'),orange:color('--studio-orange','#ee964b'),
  cream:color('--studio-cream','#faf0ca')};
}
