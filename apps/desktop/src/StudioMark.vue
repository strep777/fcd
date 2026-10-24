<template><img class="studio-mark" :src="logo" alt="奕星纪元" draggable="false"></template>
<script setup lang="ts">
const logo=new URL('./assets/studio-logo.png',import.meta.url).href;
</script>
<style scoped>.studio-mark{display:block;width:100%;height:100%;object-fit:contain;background:#fff;border-radius:4px}</style>
