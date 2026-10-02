<script setup>
import { withBase } from "vitepress";

defineProps({ items: { type: Array, required: true } });
</script>

<template>
  <div class="gallery">
    <figure v-for="item in items" :key="item.src">
      <a :href="withBase(item.src)" target="_blank" rel="noopener">
        <img :src="withBase(item.src)" :alt="item.alt || item.title" loading="lazy" />
      </a>
      <figcaption>
        <strong>{{ item.title }}</strong> <code v-if="item.name">{{ item.name }}</code>
        <br v-if="item.caption" />{{ item.caption }}
      </figcaption>
    </figure>
  </div>
</template>
