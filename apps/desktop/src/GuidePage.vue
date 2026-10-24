<template>
 <article class="guide-page">
  <div class="guide-content">
   <div class="guide-intro">
    <h1>{{language==='zh'?'使用指南':localize('User guide')}}</h1>
    <p>{{language==='zh'?'从原图到裁片，按以下顺序操作。所有长度均以毫米保存。':localize('Follow the workflow from original artwork to cutting patterns. Lengths are stored in millimeters.')}}</p>
   </div>
   <ol class="guide-steps"><li>{{guideText(0)}}</li><li>{{guideText(1)}}</li><li>{{guideText(2)}}</li><li>{{guideText(3)}}</li><li>{{guideText(4)}}</li></ol>
   <section class="guide-section"><h2>{{guideText(5)}}</h2><p>{{guideText(6)}}</p><p>{{guideText(7)}}</p></section>
   <section class="guide-section"><h2>{{guideText(8)}}</h2><p>{{guideText(9)}}</p><p>{{guideText(10)}}</p><p>{{guideText(11)}}</p></section>
   <section class="guide-section"><h2>{{guideText(12)}}</h2><p>{{guideText(13)}}</p><p>{{guideText(14)}}</p></section>
   <section class="guide-section"><h2>{{guideText(15)}}</h2><p>{{guideText(16)}}</p></section>
   <section class="guide-section"><h2>{{guideText(17)}}</h2><p>{{guideText(18)}}</p><p>{{guideText(19)}}</p><p>{{guideText(20)}}</p></section>
   <section class="guide-section"><h2>{{guideText(21)}}</h2><p>{{guideText(22)}}</p><p>{{guideText(23)}}</p></section>
   <section class="guide-section"><h2>{{guideText(24)}}</h2><p>{{guideText(25)}}</p></section>
   <section v-for="(topics,scope) in parameterHelp" :key="scope" class="guide-section guide-parameters">
    <h2>{{language==='zh'?titles[scope]:localize(scope)}}</h2>
    <dl><template v-for="topic in topics" :key="topic.name"><dt>{{language==='zh'?topic.name:localize(topic.enName)}}</dt><dd>{{language==='zh'?topic.explanation:localize(topic.en)}}</dd></template></dl>
   </section>
  </div>
 </article>
</template>
<script setup lang="ts">
import {localize,locale} from './localization';
import {guideCopy} from './guide-copy';
const guideText=(index:number)=>guideCopy[locale.value][index];

import {parameterHelp,type HelpScope} from '../../../packages/ui/parameter-help';
defineProps<{language:'zh'|'en'}>();
const titles:Record<HelpScope,string>={reference:'花纹提取',model:'模型管理',mapping:'花纹映射',cutting:'裁切版型',pattern:'制版',materials:'材料',seams:'接缝',nesting:'排料'};
</script>
<style scoped>
.guide-page{height:100%;min-height:0;min-width:0;width:100%;overflow:auto;overscroll-behavior:contain;padding:30px;background:var(--bg);color:var(--text);line-height:1.8}
.guide-content{max-width:960px;margin:0 auto}
.guide-intro{padding:2px 2px 20px}
.guide-intro h1{font-size:27px;line-height:1.25;font-weight:650;letter-spacing:-.035em;margin:0 0 10px}
.guide-intro p{font-size:13px;color:var(--text-muted);margin:0}
.guide-steps{list-style:none;counter-reset:guide-step;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:0;margin:0 0 24px}
.guide-steps li{counter-increment:guide-step;display:grid;grid-template-columns:27px minmax(0,1fr);align-items:start;gap:11px;margin:0;padding:17px 18px;background:var(--panel);border:1px solid var(--border);border-radius:12px;font-size:12px;line-height:1.8}
.guide-steps li::before{content:counter(guide-step);display:grid;place-items:center;width:25px;height:25px;margin-top:1px;border-radius:8px;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.guide-steps li:last-child{grid-column:1/-1}
.guide-section{padding:22px 24px;margin:0 0 14px;background:var(--panel);border:1px solid var(--border);border-radius:12px}
.guide-section h2{font-size:16px;line-height:1.5;font-weight:600;letter-spacing:-.015em;color:var(--text);margin:0 0 12px}
.guide-section p{font-size:12px;line-height:1.9;color:var(--text-muted);margin:10px 0 0;overflow-wrap:anywhere}
.guide-parameters dl{display:grid;grid-template-columns:minmax(110px,160px) minmax(0,1fr);gap:14px 24px;margin:16px 0 0}
.guide-parameters dt{font-size:12px;font-weight:600;color:var(--text);margin:0;line-height:1.8}
.guide-parameters dd{font-size:12px;line-height:1.8;text-align:left;color:var(--text-muted);margin:0;overflow-wrap:anywhere}
@media(max-width:1100px){.guide-page{padding:24px}.guide-steps{grid-template-columns:1fr;gap:10px}.guide-steps li{padding:14px 16px}.guide-section{padding:20px}}
@media(max-width:800px){.guide-page{padding:18px}.guide-intro h1{font-size:24px}.guide-section{padding:18px}.guide-parameters dl{grid-template-columns:1fr;gap:5px}.guide-parameters dd{margin-bottom:12px}}
</style>
