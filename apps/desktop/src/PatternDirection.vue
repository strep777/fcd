<template>
 <g v-if="layout.fontSizeMm>0" class="piece-annotations" pointer-events="none">
  <text v-for="(line,index) in layout.caption" :key="index" class="piece-caption" xml:space="preserve" :x="line.xMm" :y="-line.yMm" text-anchor="middle" :font-size="line.fontSizeMm" fill="var(--ink)" paint-order="stroke" stroke="var(--studio-white)" :stroke-width="line.fontSizeMm*.15" stroke-linejoin="round">{{line.text}}</text>
  <g class="piece-direction" aria-label="Piece fur and fabric direction">
  <g v-for="arrow in layout.arrows" :key="arrow.kind" :class="'piece-direction-'+arrow.kind" :data-angle-rad="arrow.angle">
   <title>{{directionLabel(arrow.text)}} {{Number((arrow.angle*180/Math.PI).toFixed(1))}}°</title>
   <polyline :points="arrow.points.map(point=>`${point.xMm},${-point.yMm}`).join(' ')" fill="none" :stroke="arrow.kind==='grain'?'var(--studio-orange)':'var(--ink)'" :stroke-width="layout.fontSizeMm*.1" :stroke-dasharray="arrow.kind==='grain'?`${layout.fontSizeMm*.3} ${layout.fontSizeMm*.2}`:undefined" stroke-linecap="round" stroke-linejoin="round"/>
   <text xml:space="preserve" :x="arrow.label.xMm" :y="-arrow.label.yMm" text-anchor="middle" :font-size="directionFontSize(arrow.label)" :fill="arrow.kind==='grain'?'var(--studio-orange)':'var(--ink)'" paint-order="stroke" stroke="var(--studio-white)" :stroke-width="arrow.label.fontSizeMm*.15" stroke-linejoin="round">{{directionLabel(arrow.label.text)}}</text>
  </g>
  </g>
 </g>
</template>
<script setup lang="ts">
import type {patternAnnotationLayout} from '../../../packages/pattern/annotation-layout';
import {patternTextWidth} from '../../../packages/pattern/annotation-text';
const props=defineProps<{layout:ReturnType<typeof patternAnnotationLayout>;language:'zh'|'en'}>();
const englishLabels:Record<string,string>={'毛向':'Fur','布向':'Grain','毛向 / 布向':'Fur / grain'};
function directionLabel(text:string){return props.language==='zh'?text:englishLabels[text]??text;}
function directionFontSize(label:{text:string;fontSizeMm:number;widthMm:number}){return Math.min(label.fontSizeMm,label.widthMm/patternTextWidth(directionLabel(label.text)));}
</script>
<style scoped>
@font-face{font-family:'FurryPattern Sans SC';src:url('../../../assets/fonts/FurryPatternSansSC-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:block}
.piece-annotations{font-family:'FurryPattern Sans SC',sans-serif;font-weight:400;font-style:normal;font-synthesis:none;font-kerning:none;font-feature-settings:'locl' 0,'liga' 0;letter-spacing:normal;word-spacing:normal}
</style>
