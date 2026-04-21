<script setup lang="ts">
import { battleCatalog } from '@ff14arena/content';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
</script>

<template>
  <main class="page-shell">
    <section class="hero-card">
      <p class="eyebrow">FF14 Arena Next</p>
      <h1>多人联机机制模拟项目基础环境已就绪</h1>
      <p class="description">
        当前前端骨架使用 Vue 3、Pinia、PixiJS 与 TypeScript，后续页面与战斗表现都从这里展开。
      </p>
    </section>

    <section class="grid">
      <article class="panel">
        <h2>固定队槽位</h2>
        <ul>
          <li v-for="slot in PARTY_SLOT_ORDER" :key="slot">{{ slot }}</li>
        </ul>
      </article>

      <article class="panel">
        <h2>已注册战斗</h2>
        <ul>
          <li v-for="battle in battleCatalog" :key="battle.id">
            {{ battle.name }}（{{ battle.id }}）
          </li>
        </ul>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  min-height: 100vh;
  padding: 48px 24px;
  color: #f4f1ea;
  background:
    radial-gradient(circle at top, rgba(255, 194, 102, 0.22), transparent 32%),
    linear-gradient(180deg, #171411 0%, #0d0c0b 100%);
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
}

.hero-card,
.panel {
  max-width: 1080px;
  margin: 0 auto;
  border: 1px solid rgba(255, 220, 170, 0.18);
  border-radius: 20px;
  background: rgba(36, 27, 21, 0.86);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
}

.hero-card {
  padding: 32px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #efc47a;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
}

.description {
  max-width: 720px;
  margin: 16px 0 0;
  line-height: 1.7;
  color: rgba(244, 241, 234, 0.82);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  max-width: 1080px;
  margin: 20px auto 0;
}

.panel {
  padding: 24px;
}

ul {
  margin: 16px 0 0;
  padding-left: 20px;
  line-height: 1.8;
}
</style>
