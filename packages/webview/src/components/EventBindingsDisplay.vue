<template>
  <div v-if="hasBindings" class="bindings-container">
    <!-- 角色绑定 -->
    <div v-if="characterBindings.length > 0" class="bindings-section">
      <div v-for="binding in characterBindings" :key="binding.uuid" class="binding-item">
        <div class="binding-avatar-row">
          <q-avatar
            :color="getRoleColor(binding.uuid)"
            text-color="white"
            size="20px"
            :icon="getRoleIcon(binding.uuid)"
          >
            {{ getRoleInitial(binding.uuid) }}
          </q-avatar>
          <div class="binding-info">
            <div class="binding-name">{{ getBindingDisplayName(binding) }}</div>
            <div v-if="binding.status" class="binding-status">{{ binding.status }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 文档绑定 -->
    <div v-if="documentBindings.length > 0" class="bindings-section document-section">
      <div v-for="binding in documentBindings" :key="binding.uuid" class="binding-item document-item">
        <q-icon name="description" size="16px" color="blue-6" class="doc-icon" />
        <div class="binding-info">
          <div class="binding-name">{{ binding.documentTitle || getBindingDisplayName(binding) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { QAvatar, QIcon } from 'quasar';
import type { BindingReference } from '../types/timeline';

interface RoleInfo {
  uuid: string;
  name: string;
  type: string;
  color?: string;
}

interface ArticleInfo {
  uuid: string;
  title: string;
  path: string;
  fullPath?: string;
}

interface Props {
  bindings?: BindingReference[];
  rolesList?: RoleInfo[] | undefined;
  articlesList?: ArticleInfo[] | undefined;
}

const props = defineProps<Props>();

// 计算属性：是否有绑定
const hasBindings = computed(() => {
  return props.bindings && props.bindings.length > 0;
});

// 计算属性：角色绑定
const characterBindings = computed(() => {
  if (!props.bindings) return [];
  return props.bindings.filter(b => b.type === 'character');
});

// 计算属性：文档绑定
const documentBindings = computed(() => {
  if (!props.bindings) return [];
  return props.bindings.filter(b => b.type === 'article');
});

// 获取角色信息
function getRoleByUuid(uuid: string): RoleInfo | undefined {
  return props.rolesList?.find(role => role.uuid === uuid);
}

// 获取文章信息
function getArticleByUuid(uuid: string): ArticleInfo | undefined {
  return props.articlesList?.find(article => article.uuid === uuid);
}

// 获取绑定显示名称
function getBindingDisplayName(binding: BindingReference): string {
  if (binding.label && binding.label.trim()) {
    return binding.label;
  }
  if (binding.type === 'character') {
    const role = getRoleByUuid(binding.uuid);
    if (role?.name) {
      return role.name;
    }
  } else if (binding.type === 'article') {
    const article = getArticleByUuid(binding.uuid);
    if (article?.title) {
      return article.title;
    }
  }
  return binding.uuid.substring(0, 8);
}

// 获取角色颜色
function getRoleColor(uuid: string): string {
  const role = getRoleByUuid(uuid);
  if (role?.color && role.color.trim().length > 0) {
    return role.color;
  }
  return 'purple';
}

// 获取角色首字母(用于头像显示)
function getRoleInitial(uuid: string): string {
  const role = getRoleByUuid(uuid);
  if (role?.name) {
    return role.name.charAt(0).toUpperCase();
  }
  return '?';
}

// 获取角色图标(可选)
function getRoleIcon(uuid: string): string | undefined {
  // 可以根据角色类型返回不同图标
  const role = getRoleByUuid(uuid);
  if (!role) return 'person';

  // 根据角色类型返回图标
  if (role.type === '主角') return 'star';
  if (role.type === '配角') return 'person';
  if (role.type === '群众') return 'people';

  return undefined; // 不使用图标,显示首字母
}
</script>

<style scoped>
.bindings-container {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.bindings-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bindings-section.document-section {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.binding-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  min-height: 20px;
}

.binding-avatar-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 24px;
}

.binding-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.binding-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: white;
  line-height: 1.3;
}

.binding-status {
  font-size: 0.9em;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.document-item {
  align-items: flex-start;
  min-height: 18px;
}

.doc-icon {
  margin-top: 1px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.9) !important;
}

.document-item .binding-name {
  font-size: 0.9em;
  line-height: 1.3;
  white-space: normal;
  word-break: break-word;
}
</style>
