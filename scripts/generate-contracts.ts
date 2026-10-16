import { z } from 'zod';
import { mkdir,writeFile } from 'node:fs/promises';
import { customTemplateSchema,maskSchema,pieceSchema,pointSchema,curveSchema,notchSchema,labelSchema,edgeAllowanceSchema,allowanceSampleSchema,projectSchema,requestSchema,workflowFileSchema } from '../packages/schema/index';
await mkdir('packages/schema/generated',{recursive:true});
for(const [name,schema] of Object.entries({'custom-template':customTemplateSchema,mask:maskSchema,point:pointSchema,piece:pieceSchema,project:projectSchema,request:requestSchema,workflow:workflowFileSchema}))await writeFile(`packages/schema/generated/${name}.schema.json`,JSON.stringify(z.toJSONSchema(schema),null,2)+'\n');
function struct(name:string,schema:z.ZodType){
 const json=z.toJSONSchema(schema);
 const fields=Object.entries(json.properties??{}).map(([key,value])=>{
  const v=value as {type:string};
  const types:Record<string,string>={nodes:'Vec<Point>',holes:'Vec<Vec<Point>>',curves:'Vec<Curve>',notches:'Vec<Notch>',labels:'Vec<Label>',edgeAllowances:'Vec<EdgeAllowance>',samples:'Vec<AllowanceSample>',c1:'Point',c2:'Point'};
  const rustType=types[key]??(v.type==='string'?'String':v.type==='boolean'?'bool':v.type==='integer'?'u32':'f64');
  const snake=key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),optional=!json.required?.includes(key);
  return `${optional?'    #[serde(default, skip_serializing_if = "Option::is_none")]\n':''}    pub ${snake}: ${optional?`Option<${rustType}>`:rustType},`;
 }).join('\n');
 return `#[derive(Clone, Debug, Serialize, Deserialize)]\n#[serde(rename_all = "camelCase", deny_unknown_fields)]\npub struct ${name} {\n${fields}\n}\n`;
}
await writeFile('crates/geometry-core/src/schema_generated.rs','// Generated from packages/schema/index.ts. Do not edit by hand.\n'+struct('Point',pointSchema)+'\n'+struct('Curve',curveSchema)+'\n'+struct('Notch',notchSchema)+'\n'+struct('Label',labelSchema)+'\n'+struct('AllowanceSample',allowanceSampleSchema)+'\n'+struct('EdgeAllowance',edgeAllowanceSchema)+'\n'+struct('Piece',pieceSchema));
