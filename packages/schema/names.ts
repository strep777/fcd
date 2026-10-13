/** Preserve the identifying suffix and whole Unicode characters within the schema's UTF-16 limit. */
export function derivedName(base:string,suffix:string){
 const budget=120-suffix.length;if(budget<0)throw Error('VALIDATION_ERROR');let prefix='';
 for(const char of base){if(prefix.length+char.length>budget)break;prefix+=char;}
 return prefix.trimEnd()+suffix;
}
