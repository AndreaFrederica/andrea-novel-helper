<template>
  <q-page class="q-pa-md">
    <div class="row q-col-gutter-md">
      <!-- 左侧关系列表 -->
      <div class="col-12 col-md-4">
        <q-card>
          <q-card-section>
            <div class="text-h6 q-mb-md">
              关系列表
              <q-btn
                flat
                dense
                round
                icon="add"
                color="primary"
                class="float-right"
                @click="addNewRelationship"
              >
                <q-tooltip>添加新关系</q-tooltip>
              </q-btn>
            </div>
            
            <!-- 搜索框 -->
            <q-input
              v-model="searchText"
              placeholder="搜索关系..."
              dense
              filled
              clearable
              class="q-mb-md"
            >
              <template #prepend>
                <q-icon name="search" />
              </template>
            </q-input>

            <!-- 关系列表 -->
            <q-list separator>
              <q-item
                v-for="relationship in filteredRelationships"
                :key="relationship.id || ''"
                clickable
                :active="selectedRelationshipId === relationship.id"
                @click="selectRelationship(relationship.id)"
                class="relationship-item"
              >
                <q-item-section>
                  <q-item-label>
                    {{ relationship.base.fromRoleId }} → {{ relationship.base.toRoleId }}
                  </q-item-label>
                  <q-item-label caption>
                    {{ relationship.base.relationshipType }}
                    <q-badge
                      v-if="relationship.base.strength"
                      :color="getStrengthColor(relationship.base.strength)"
                      class="q-ml-sm"
                    >
                      {{ relationship.base.strength }}
                    </q-badge>
                  </q-item-label>
                  <q-item-label caption v-if="relationship.base.description">
                    {{ relationship.base.description.substring(0, 50) }}{{ relationship.base.description.length > 50 ? '...' : '' }}
                  </q-item-label>
                </q-item-section>
                
                <q-item-section side>
                  <div class="row">
                    <q-btn
                      flat
                      dense
                      round
                      icon="edit"
                      size="sm"
                      color="primary"
                      @click.stop="selectRelationship(relationship.id)"
                    >
                      <q-tooltip>编辑关系</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      icon="delete"
                      size="sm"
                      color="negative"
                      @click.stop="confirmDeleteRelationship(relationship.id)"
                    >
                      <q-tooltip>删除关系</q-tooltip>
                    </q-btn>
                  </div>
                </q-item-section>
              </q-item>
            </q-list>

            <!-- 空状态 -->
            <div v-if="relationships.length === 0" class="text-center q-pa-md text-grey-6">
              <q-icon name="relationship" size="3em" class="q-mb-md" />
              <div>暂无关系数据</div>
              <div class="text-caption">点击右上角的 + 按钮添加新关系</div>
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- 右侧关系编辑器 -->
      <div class="col-12 col-md-8">
        <div v-if="selectedRelationship">
          <RelationshipCard
            v-model="selectedRelationship"
            @delete="confirmDeleteRelationship(selectedRelationship.id)"
            @save="saveRelationship"
          />
        </div>
        
        <!-- 未选择关系时的提示 -->
        <q-card v-else>
          <q-card-section class="text-center q-pa-xl">
            <q-icon name="arrow_back" size="3em" color="grey-4" class="q-mb-md" />
            <div class="text-h6 text-grey-6">请从左侧选择一个关系进行编辑</div>
            <div class="text-caption text-grey-5 q-mt-sm">
              或者点击左上角的 + 按钮添加新关系
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <q-dialog v-model="deleteDialog" persistent>
      <q-card>
        <q-card-section class="row items-center">
          <q-avatar icon="warning" color="negative" text-color="white" />
          <span class="q-ml-sm">确定要删除这个关系吗？此操作不可撤销。</span>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="取消" color="primary" v-close-popup />
          <q-btn flat label="删除" color="negative" @click="deleteRelationship" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import RelationshipCard from '../components/RelationshipCard.vue';

// 类型定义
interface BaseRelationshipFields {
  id?: string;
  uuid?: string;
  fromRoleId: string;
  toRoleId: string;
  relationshipType: string;
  description?: string;
  strength?: number;
  isDirectional?: boolean;
  startTime?: string;
  endTime?: string;
  status?: 'active' | 'inactive' | 'ended';
  tags?: string[];
  notes?: string;
}

interface RelationshipCardModel {
  base: BaseRelationshipFields;
  extended?: Record<string, any>;
  custom?: Record<string, any>;
}

type RelationshipCardModelWithId = RelationshipCardModel & { id?: string };

// Quasar
const $q = useQuasar();

// 响应式数据
const relationships = ref<RelationshipCardModelWithId[]>([]);
const selectedRelationshipId = ref<string | null>(null);
const searchText = ref('');
const deleteDialog = ref(false);
const relationshipToDelete = ref<string | null>(null);

// 计算属性
const selectedRelationship = computed({
  get: () => relationships.value.find(r => r.id === selectedRelationshipId.value) || null,
  set: (value: RelationshipCardModelWithId | null) => {
    if (value && value.id) {
      const index = relationships.value.findIndex(r => r.id === value.id);
      if (index !== -1) {
        relationships.value[index] = value;
        sendUpdateToVSCode();
      }
    }
  }
});

const filteredRelationships = computed(() => {
  if (!searchText.value) return relationships.value;
  
  const search = searchText.value.toLowerCase();
  return relationships.value.filter(relationship => 
    relationship.base.fromRoleId.toLowerCase().includes(search) ||
    relationship.base.toRoleId.toLowerCase().includes(search) ||
    relationship.base.relationshipType.toLowerCase().includes(search) ||
    (relationship.base.description && relationship.base.description.toLowerCase().includes(search))
  );
});

// 方法
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const getStrengthColor = (strength: number): string => {
  if (strength <= 3) return 'red';
  if (strength <= 6) return 'orange';
  if (strength <= 8) return 'green';
  return 'blue';
};

const selectRelationship = (id: string | undefined) => {
  if (id) {
    selectedRelationshipId.value = id;
  }
};

const addNewRelationship = () => {
  const newId = generateId();
  const newRelationship: RelationshipCardModelWithId = {
    id: newId,
    base: {
      id: newId,
      uuid: generateUUID(),
      fromRoleId: '',
      toRoleId: '',
      relationshipType: '朋友',
      description: '',
      strength: 5,
      isDirectional: false,
      status: 'active',
      tags: [],
      notes: ''
    }
  };
  
  relationships.value.push(newRelationship);
  selectedRelationshipId.value = newId;
  sendUpdateToVSCode();
  
  $q.notify({
    message: '已添加新关系',
    type: 'positive',
    position: 'top'
  });
};

const confirmDeleteRelationship = (id: string | undefined) => {
  if (id) {
    relationshipToDelete.value = id;
    deleteDialog.value = true;
  }
};

const deleteRelationship = () => {
  if (relationshipToDelete.value) {
    const index = relationships.value.findIndex(r => r.id === relationshipToDelete.value);
    if (index !== -1) {
      relationships.value.splice(index, 1);
      
      // 如果删除的是当前选中的关系，清除选择
      if (selectedRelationshipId.value === relationshipToDelete.value) {
        selectedRelationshipId.value = null;
      }
      
      sendUpdateToVSCode();
      
      $q.notify({
        message: '关系已删除',
        type: 'positive',
        position: 'top'
      });
    }
    
    relationshipToDelete.value = null;
  }
};

const saveRelationship = () => {
  sendUpdateToVSCode();
  $q.notify({
    message: '关系已保存',
    type: 'positive',
    position: 'top'
  });
};

const sendUpdateToVSCode = () => {
  if (window.vscode) {
    window.vscode.postMessage({
      type: 'updateRelationships',
      list: relationships.value
    });
  }
};

// VS Code 消息处理
const handleVSCodeMessage = (event: MessageEvent) => {
  const message = event.data;
  
  switch (message.type) {
    case 'relationshipCards':
      relationships.value = message.list || [];
      // 如果当前选中的关系不存在了，清除选择
      if (selectedRelationshipId.value && !relationships.value.find(r => r.id === selectedRelationshipId.value)) {
        selectedRelationshipId.value = null;
      }
      break;
  }
};

// 生命周期
onMounted(() => {
  // 监听来自 VS Code 的消息
  window.addEventListener('message', handleVSCodeMessage);
  
  // 请求初始数据
  if (window.vscode) {
    window.vscode.postMessage({ type: 'requestRelationshipCards' });
  }
});

// 监听选中关系的变化，自动保存
watch(selectedRelationship, (newVal) => {
  if (newVal) {
    sendUpdateToVSCode();
  }
}, { deep: true });

// 全局类型声明
declare global {
  interface Window {
    vscode?: {
      postMessage: (message: any) => void;
    };
  }
}
</script>

<style scoped>
.relationship-item {
  border-radius: 8px;
  margin-bottom: 4px;
}

.relationship-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.relationship-item.q-item--active {
  background-color: rgba(25, 118, 210, 0.12);
}
</style>