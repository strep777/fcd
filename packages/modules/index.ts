export interface FeatureModule {id:string;version:string;dependsOn:string[];optional:boolean;capabilities:string[];initialize():Promise<void>;dispose():Promise<void>}
export class ModuleRegistry {
 private initialized:FeatureModule[]=[];
 readonly states=new Map<string,'ready'|'failed'|'blocked'>();
 async start(modules:FeatureModule[]){
  if(this.initialized.length)throw new Error('REGISTRY_ALREADY_STARTED');
  const byId=new Map(modules.map(m=>[m.id,m]));if(byId.size!==modules.length)throw new Error('DUPLICATE_MODULE');
  const visiting=new Set<string>(),visited=new Set<string>(),ordered:FeatureModule[]=[];
  const visit=(m:FeatureModule)=>{if(visiting.has(m.id))throw new Error('CYCLIC_MODULE');if(visited.has(m.id))return;visiting.add(m.id);for(const id of m.dependsOn){const dependency=byId.get(id);if(!dependency)throw new Error('MISSING_MODULE');visit(dependency);}visiting.delete(m.id);visited.add(m.id);ordered.push(m);};
  modules.forEach(visit);this.states.clear();
  try{for(const m of ordered){if(m.dependsOn.some(id=>this.states.get(id)!=='ready')){this.states.set(m.id,'blocked');if(!m.optional)throw new Error('REQUIRED_MODULE_BLOCKED');continue;}try{await m.initialize();this.initialized.push(m);this.states.set(m.id,'ready');}catch(e){this.states.set(m.id,'failed');await m.dispose().catch(()=>{});if(!m.optional)throw e;}}}catch(e){await this.dispose();throw e;}
 }
 capabilities(modules:FeatureModule[]){return modules.filter(m=>this.states.get(m.id)==='ready').flatMap(m=>m.capabilities);}
 async dispose(){const errors:unknown[]=[];for(const m of this.initialized.reverse()){try{await m.dispose();}catch(e){errors.push(e);}}this.initialized=[];if(errors.length)throw new AggregateError(errors,'MODULE_DISPOSE_FAILED');}
}
