<template>
 <div class="inline-activity" role="status" aria-live="polite"><span class="inline-spinner" aria-hidden="true"/>{{label}}</div>
</template>

<script setup lang="ts">
defineProps<{label:string}>();
</script>

<style scoped>
.inline-activity{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--accent-soft);border-radius:5px;color:var(--text-muted);font-size:11px}.inline-spinner{width:18px;height:18px;flex-shrink:0;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:inline-spin .8s linear infinite}@keyframes inline-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.inline-spinner{animation:none}}
</style>
