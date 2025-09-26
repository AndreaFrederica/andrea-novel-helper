<template>
  <q-dialog
    v-model="isVisible"
    persistent
    maximized-mobile
    transition-show="scale"
    transition-hide="scale"
  >
    <q-card style="min-width: 450px; max-width: 500px;">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">编辑节点</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section>
        <q-form @submit="onSubmit" class="q-gutter-md">
          <!-- 节点名称 -->
          <q-input
            v-model="formData.text"
            label="节点名称"
            outlined
            dense
            :rules="[val => !!val || '节点名称不能为空']"
            autofocus
          />

          <!-- 性别类型 -->
          <q-select
            v-model="formData.sexType"
            label="性别类型"
            outlined
            dense
            :options="sexTypeOptions"
            emit-value
            map-options
          />

          <!-- 节点形状 -->
          <q-select
            v-model="formData.shape"
            label="节点形状"
            outlined
            dense
            :options="shapeOptions"
            emit-value
            map-options
          />

          <!-- 节点大小 -->
          <q-input
            v-model.number="formData.size"
            label="节点大小"
            type="number"
            outlined
            dense
            :min="30"
            :max="200"
            :step="10"
            :rules="[val => val >= 30 && val <= 200 || '大小必须在30-200之间']"
          />

          <!-- 节点颜色 -->
          <div class="q-field q-field--outlined q-field--dense">
            <div class="q-field__inner">
              <div class="q-field__control">
                <div class="q-field__control-container col relative-position row no-wrap q-anchor--skip">
                  <q-input
                    v-model="formData.color"
                    label="节点颜色"
                    outlined
                    dense
                    placeholder="#FF0000 或 #FF0000FF"
                    clearable
                    :rules="[val => !val || /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(val) || '请输入有效的十六进制颜色值（支持6位或8位）']"
                  >
                    <template v-slot:append>
                      <q-icon name="palette" class="cursor-pointer">
                        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                          <q-color
                            v-model="formData.color"
                            format-model="hex"
                            default-value="#1976D2"
                            no-header
                            no-footer
                          />
                        </q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
              </div>
            </div>
          </div>

          <!-- 字体颜色跟随主题 -->
          <q-checkbox
            v-model="formData.followThemeFontColor"
            label="字体颜色跟随主题"
            class="q-mt-sm"
          />
          <div v-if="formData.followThemeFontColor" class="text-caption text-grey-6 q-ml-lg">
            开启后，字体颜色将自动适应VS Code主题
          </div>

          <!-- 自定义字体颜色 -->
          <div v-if="!formData.followThemeFontColor" class="q-field q-field--outlined q-field--dense">
            <div class="q-field__inner">
              <div class="q-field__control">
                <div class="q-field__control-container col relative-position row no-wrap q-anchor--skip">
                  <q-input
                    v-model="formData.fontColor"
                    label="字体颜色"
                    outlined
                    dense
                    placeholder="#FFFFFF 或 #FFFFFFFF"
                    clearable
                    :rules="[val => !val || /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(val) || '请输入有效的十六进制颜色值（支持6位或8位）']"
                  >
                    <template v-slot:append>
                      <q-icon name="palette" class="cursor-pointer">
                        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                          <q-color
                            v-model="formData.fontColor"
                            format-model="hex"
                            default-value="#FFFFFF"
                            no-header
                            no-footer
                          />
                        </q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
              </div>
            </div>
          </div>

          <!-- 绑定角色 -->
          <q-select
            v-model="formData.roleUuid"
            label="绑定角色（可选）"
            outlined
            dense
            clearable
            use-input
            input-debounce="0"
            :options="filteredRoleOptions"
            option-value="uuid"
            option-label="displayName"
            emit-value
            map-options
            @filter="filterRoles"
            placeholder="选择或搜索角色"
          >
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  没有找到匹配的角色
                </q-item-section>
              </q-item>
            </template>
            
            <template v-slot:option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section>
                  <q-item-label>{{ scope.opt.name }}</q-item-label>
                  <q-item-label caption>
                    {{ scope.opt.packagePath }} - {{ scope.opt.type }}
                    <span v-if="scope.opt.affiliation"> ({{ scope.opt.affiliation }})</span>
                  </q-item-label>
                </q-item-section>
                <q-item-section side v-if="scope.opt.color">
                  <div 
                    class="role-color-indicator" 
                    :style="{ backgroundColor: scope.opt.color }"
                  ></div>
                </q-item-section>
              </q-item>
            </template>
          </q-select>

          <!-- 节点属性跟随角色 -->
          <q-checkbox
            v-model="formData.followRole"
            label="节点属性跟随角色"
            :disable="!formData.roleUuid"
            class="q-mt-sm"
          />
          <div v-if="formData.followRole && formData.roleUuid" class="text-caption text-grey-6 q-ml-lg">
            开启后，节点的名称和颜色将自动同步角色信息
          </div>
        </q-form>
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          flat
          label="取消"
          color="grey"
          v-close-popup
        />
        <q-btn
          label="保存"
          color="primary"
          @click="onSubmit"
          :loading="loading"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed, inject } from 'vue';

// 定义组件属性
interface NodeEditData {
  text: string;
  sexType: string;
  shape: string;
  size: number;
  color: string;
  fontColor: string;
  followThemeFontColor: boolean;
  roleUuid: string;
  followRole: boolean;
}

interface RoleOption {
  uuid: string;
  name: string;
  type: string;
  affiliation?: string;
  color?: string;
  packagePath: string;
  displayName: string;
  extended?: Record<string, any>;
  custom?: Record<string, any>;
}

interface Props {
  modelValue: boolean;
  initialData?: NodeEditData;
  roleList?: any[];
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'submit', data: NodeEditData): void;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  initialData: () => ({
    text: '',
    sexType: 'other',
    shape: 'circle',
    size: 60,
    color: '',
    fontColor: '',
    followThemeFontColor: true,
    roleUuid: '',
    followRole: false
  }),
  roleList: () => []
});

const emit = defineEmits<Emits>();

// 响应式数据
const isVisible = ref(props.modelValue);
const loading = ref(false);

// 表单数据
const formData = reactive<NodeEditData>({
  text: '',
  sexType: 'other',
  shape: 'circle',
  size: 60,
  color: '',
  fontColor: '',
  followThemeFontColor: true,
  roleUuid: '',
  followRole: false
});

// 角色选项处理
const roleOptions = computed<RoleOption[]>(() => {
  const options: RoleOption[] = [];
  
  for (const packageGroup of props.roleList) {
    for (const role of packageGroup.roles) {
      options.push({
        uuid: role.uuid,
        name: role.name,
        type: role.type,
        affiliation: role.affiliation,
        color: role.color,
        packagePath: packageGroup.packagePath,
        displayName: `${role.name} (${packageGroup.packagePath})`
      });
    }
  }
  
  return options;
});

// 过滤后的角色选项
const filteredRoleOptions = ref<RoleOption[]>([]);

// 角色过滤函数
const filterRoles = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (val === '') {
      filteredRoleOptions.value = roleOptions.value;
    } else {
      const needle = val.toLowerCase();
      filteredRoleOptions.value = roleOptions.value.filter(role => 
        role.name.toLowerCase().includes(needle) ||
        role.type.toLowerCase().includes(needle) ||
        role.packagePath.toLowerCase().includes(needle) ||
        (role.affiliation && role.affiliation.toLowerCase().includes(needle))
      );
    }
  });
};

// 初始化过滤选项
watch(() => props.roleList, () => {
  filteredRoleOptions.value = roleOptions.value;
}, { immediate: true });

// 监听角色选择和跟随角色设置的变化，自动同步角色属性
watch([() => formData.roleUuid, () => formData.followRole], ([newRoleUuid, followRole]) => {
  if (followRole && newRoleUuid) {
    // 找到选中的角色
    const selectedRole = roleOptions.value.find(role => role.uuid === newRoleUuid);
    if (selectedRole) {
      // 同步角色的名字和颜色到节点
      formData.text = selectedRole.name;
      if (selectedRole.color) {
        formData.color = selectedRole.color;
      }
      
      // 同步性别字段（从扩展字段或自定义字段中获取）
      const genderFromExtended = selectedRole.extended?.['gender'] || selectedRole.extended?.['性别'];
      const genderFromCustom = selectedRole.custom?.['gender'] || selectedRole.custom?.['性别'];
      const genderValue = genderFromExtended || genderFromCustom;
      
      if (genderValue) {
        // 将角色数据中的性别值映射到节点的sexType
        const genderMapping: Record<string, string> = {
          '男': 'male',
          '女': 'female', 
          '男性': 'male',
          '女性': 'female',
          'male': 'male',
          'female': 'female',
          '无': 'none',
          'none': 'none',
          '其他': 'other',
          'other': 'other'
        };
        
        const mappedGender = genderMapping[String(genderValue).toLowerCase()] || 
                           genderMapping[String(genderValue)] || 'other';
        formData.sexType = mappedGender;
      }
    }
  }
}, { immediate: false });

// 选项数据
const sexTypeOptions = [
  { label: '男性', value: 'male' },
  { label: '女性', value: 'female' },
  { label: '无', value: 'none' },
  { label: '其他', value: 'other' }
];

const shapeOptions = [
  { label: '圆形', value: 'circle' },
  { label: '矩形', value: 'rect' },
  { label: '菱形', value: 'diamond' },
  { label: '椭圆', value: 'ellipse' }
];

// 监听对话框显示状态
watch(() => props.modelValue, (newVal) => {
  isVisible.value = newVal;
  if (newVal && props.initialData) {
    // 重置表单数据
    Object.assign(formData, props.initialData);
  }
});

watch(isVisible, (newVal) => {
  emit('update:modelValue', newVal);
});

// 提交表单
const onSubmit = () => {
  // 验证表单
  if (!formData.text.trim()) {
    return;
  }

  if (formData.size < 30 || formData.size > 200) {
    return;
  }

  loading.value = true;
  
  try {
    // 发送数据
    emit('submit', {
      text: formData.text.trim(),
      sexType: formData.sexType,
      shape: formData.shape,
      size: formData.size,
      color: formData.color,
      fontColor: formData.fontColor,
      followThemeFontColor: formData.followThemeFontColor,
      roleUuid: formData.roleUuid.trim(),
      followRole: formData.followRole
    });
    
    // 关闭对话框
    isVisible.value = false;
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.q-card {
  border-radius: 8px;
}

.q-form {
  max-width: 100%;
}

.role-color-indicator {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid #ddd;
}
</style>