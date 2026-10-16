<script setup lang="ts">
import {localize} from './localization';

import {computed} from 'vue';
import {useSession} from './store';
import type {Piece} from '../../../packages/schema/index';
const props=defineProps<{piece:Piece;language:'zh'|'en'}>(),store=useSession(),zh=computed(()=>props.language==='zh');
async function edit(id:string,field:'text'|'xMm'|'yMm',value:string|number){const p=store.data.project;if(p)await store.run(()=>window.fpcad.apply(p.id,p.revision,{type:'piece.put',piece:{...JSON.parse(JSON.stringify(props.piece)),labels:props.piece.labels?.map(l=>l.id===id?{...l,[field]:value}:l)}}));}
</script>
<template><details v-if="piece.labels?.length" class="label-editor" open><summary>{{zh?'调整标签':localize('Adjust labels')}}</summary><div v-for="l in piece.labels" :key="l.id"><label>{{zh?'标签文字':localize('Label text')}}<input :value="l.text" maxlength="120" @change="edit(l.id,'text',($event.target as HTMLInputElement).value)"></label><div class="two-col"><label>X mm<input :value="l.xMm" type="number" step=".1" @change="edit(l.id,'xMm',Number(($event.target as HTMLInputElement).value))"></label><label>Y mm<input :value="l.yMm" type="number" step=".1" @change="edit(l.id,'yMm',Number(($event.target as HTMLInputElement).value))"></label></div></div></details></template>
<style scoped>.label-editor{padding:12px 0;border-top:1px solid var(--border)}summary{font-size:12px;cursor:pointer}.label-editor label{font-size:11px;margin:10px 0}</style>
