<template>
  <div class="about-widget">
    <img class="about-icon" :src="iconSrc" alt="icon" />
    <div class="about-text">
      <h4>Patchouli.js</h4>
      <p>Patchouli.js 是一个基于 Vue 编写的 HTML 文档阅读器，支持单页和分页显示。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const iconSrc = 'logo.png' // 这里是图标的路径，替换为实际图标路径
</script>

<style scoped>
.about-widget {
  display: flex;
  align-items: center;
  gap: 10px;
  /* background-color: rgba(255, 255, 255, 0.9); */
  padding: 10px;
  border-radius: 8px;
  transition:
    background-color 0.3s ease,
    color 0.3s ease; /* 平滑过渡效果 */
  width: 100%; /* 自适应宽度 */
  max-width: 100%; /* 确保不会超出父容器 */
  box-sizing: border-box; /* 包括 padding 在内计算宽度 */
}

.about-icon {
  width: 50px;
  height: 50px;
  object-fit: contain;
  flex-shrink: 0; /* 防止图标在内容较长时被挤压 */
}

.about-text {
  flex: 1; /* 占据剩余空间 */
  display: flex;
  flex-direction: column;
  min-width: 0; /* 允许内容在狭窄时折行 */
}

.about-text h4 {
  margin: 0;
  font-size: 18px;
  font-weight: bold;
  /* color: #000;  */
  white-space: nowrap; /* 禁止标题换行（可选） */
  overflow: hidden; /* 超出隐藏（可选） */
  text-overflow: ellipsis; /* 省略号效果（可选） */
}

.about-text p {
  font-size: 14px;
  margin-top: 5px;
  line-height: 1.4;
  /* color: #555;默认文字颜色 */
  word-wrap: break-word; /* 允许长单词换行 */
}
</style>
