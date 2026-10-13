import { randomUUID } from 'node:crypto';
import type { Piece,Project } from '../packages/schema/index';
export function rectangle(width=100,height=200):Piece{return {id:randomUUID(),name:'测试纸样',nodes:[[0,0],[width,0],[width,height],[0,height]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm})),closed:true,allowanceMm:10,cutQty:1,mirror:false,material:'蓝色毛皮',furRad:Math.PI/2,color:'#73c9b6'};}
export function project():Project{const now='2026-09-11T00:00:00.000Z';return {schemaVersion:2,id:randomUUID(),name:'测试工程',unit:'mm',revision:0,createdAt:now,updatedAt:now,pieces:[rectangle()]};}
