export const distortionScales={distortion:.05,areaError:.15,edgeError:.10,angleError:.05} as const;
export type DistortionMetric=keyof typeof distortionScales;
export function distortionColor(value:number|undefined,metric:DistortionMetric){if(value===undefined)return '#8fa5aa';return 'hsl('+Math.max(0,120-Math.max(0,value)/distortionScales[metric]*120)+' 70% 55%)';}
