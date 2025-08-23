<template>
  <q-layout class="q-pa-md">
    <!-- 右下角悬浮开关按钮 -->
    <q-btn
      round
      dense
      icon="menu"
      class="drawer-toggle br"
      @click="drawerOpen = !drawerOpen"
      :aria-label="drawerOpen ? '关闭角色列表' : '打开角色列表'"
    />

  <!-- 左侧边栏（由 q-layout 管理，框架将自动挤压主内容） -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      bordered
      :breakpoint="0"
      :width="drawerWidth"
      class="bg-grey-1"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-md">
          <div class="row items-center justify-between q-mb-sm">
            <div class="text-subtitle1">角色（{{ roles.length }}）</div>
            <!-- <q-btn dense flat icon="unfold_less" @click="collapseAll" class="q-ml-sm" />
            <q-btn dense flat icon="unfold_more" @click="expandAll" /> -->
          </div>

          <q-list separator>
            <!-- 一个角色 = 一个可折叠分组 -->
            <q-expansion-item
              v-for="(r, idx) in roles"
              :key="r.id"
              :label="r.base?.name || `未命名角色 ${idx + 1}`"
              expand-separator
              header-class="bg-grey-2"
              :default-opened="opened.has(r.id)"
              @show="open(r.id)"
              @hide="close(r.id)"
            >
              <!-- 快速跳转到该角色卡 -->
              <q-item clickable @click="scrollToRole(r.id)">
                <q-item-section avatar><q-icon name="my_location" /></q-item-section>
                <q-item-section>跳转到卡片</q-item-section>
              </q-item>

              <q-separator spaced />

              <!-- 三段：base / extended / custom -->
              <template v-for="bucket in ['base','extended','custom']" :key="bucket">
                <div v-if="hasBucket(r, bucket as any)" class="q-mb-sm">
                  <div class="row items-center q-gutter-xs q-mb-xs">
                    <q-chip
                      dense
                      size="sm"
                      :color="bucket==='base' ? 'primary' : (bucket==='extended' ? 'teal' : 'orange')"
                      text-color="white"
                    >
                      {{ bucket }}
                    </q-chip>
                    <q-badge outline color="grey-7" :label="countKeys(r, bucket as any) + ' 项'" />
                  </div>

                  <!-- 键值对一览（可点击跳转） -->
                  <q-list dense bordered class="rounded-borders">
                    <q-item
                      v-for="(entry, i) in bucketEntries(r, bucket as any)"
                      :key="bucket + '-' + i"
                      clickable
                      @click="scrollToRole(r.id)"
                    >
                      <q-item-section>
                        <div class="row items-start justify-between">
                          <div class="text-weight-medium ellipsis">{{ entry.key }}</div>
                          <div class="text-grey-7 q-ml-sm mono value-preview">{{ entry.preview }}</div>
                        </div>
                      </q-item-section>
                    </q-item>
                    <div v-if="bucketEntries(r, bucket as any).length === 0" class="text-grey-6 q-pa-sm">
                      （空）
                    </div>
                  </q-list>
                </div>
              </template>
            </q-expansion-item>
          </q-list>
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- 右侧主体 -->
    <q-page-container>
      <div class="column col q-gutter-md">
      <!-- 用外层 div 承载 ref，避免去摸子组件实例的 $el -->
      <div
        v-for="(r, idx) in roles"
        :key="r.id"
        :ref="el => setRoleRef(r.id, el as HTMLElement)"
      >
        <role-card
          v-model="roles[idx]"
          @changed="e => onChanged(idx, e)"
          @type-changed="e => onTypeChanged(idx, e)"
        />
      </div>

      <!-- 添加角色按钮（位于最后一个角色下面） -->
      <div class="q-mt-sm">
        <q-btn color="primary" icon="add" label="添加角色" @click="addRole" />
      </div>

      <q-separator class="q-my-md" />

      <div class="text-subtitle2">当前数据快照</div>
      <q-card flat bordered>
        <q-card-section>
          <pre style="white-space:pre-wrap">{{ roles }}</pre>
        </q-card-section>
      </q-card>
      </div>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import RoleCard from 'components/RoleCard.vue'

type KV = Record<string, any>
type Role = {
  id: string
  base?: KV
  extended?: KV
  custom?: KV
}

const drawerOpen = ref(true)
const drawerWidth = 300

// 用 Set 存已展开的角色 id；克隆再赋值以触发更新
const opened = ref<Set<string>>(new Set())

// 初始示例
const roles = ref<Role[]>([
  // ===== 正则表达式示例 =====
  {
    id: genId(),
    base: {
      name: '中文对话',
      type: '正则表达式',
      regex: '“[^”]*”',
      regexFlags: 'g',
      color: '#fbdc98ff',
      priority: 100,
      description: '匹配中文引号内的对话内容'
    },
    extended: {
      说明: '用于标注中文引号中的对白。'
    },
    custom: {
      标签: '- dialogue\n- zh-CN'
    }
  },

  // ===== 主角：博丽灵梦 =====
  {
    id: genId(),
    base: {
      name: '博丽灵梦',
      type: '主角',
      affiliation: '博丽神社',
      color: '#e94152ff',
      priority: 10,
      description: '乐园的巫女，博丽神社现任巫女。',
      aliases: ['灵梦', 'Reimu']
    },
    extended: {
      外貌: '- 红白巫女服\n- 大红蝴蝶结\n- 阴阳玉随身',
      性格: '- 大而化之\n- 懒散随性\n- 直觉敏锐',
      背景: '人类；幻想乡“博丽神社”的巫女，调停人妖两界的平衡。',
      技能: '- **在空中飞行程度的能力**\n- 御札/御币/结界术\n- 阴阳玉运用',
      代表符卡: '- 梦符「梦想封印」\n- 霊符「封魔阵」\n- 結界「八方鬼缚阵」',
      爱好: '泡茶，偶尔打扫神社（如果想起来）。'
    },
    custom: {
      称号: '- **乐园的巫女**',
      备注: '香火清淡与钱包清冷，是常年烦恼。'
    }
  },

  // ===== 主角：雾雨魔理沙 =====
  {
    id: genId(),
    base: {
      name: '雾雨魔理沙',
      type: '主角',
      affiliation: '魔法森林',
      color: '#FFD700',
      description: '人类魔法使，居住于魔法森林。',
      aliases: ['魔理沙', 'Marisa']
    },
    extended: {
      外貌: '- 黑色魔女服+白围裙\n- 尖顶帽（星月装饰）',
      性格: '- 开朗外向\n- 自信好胜\n- 实用主义',
      背景: '平民出身，自学魔法+物理结合；爱收集禁书与古器。',
      技能: '- 光热系魔法\n- 魔炮\n- 道具改造\n- 高速机动',
      代表符卡: '- 「魔砲・散射の弾幕」\n- 「光热魔炮」'
    },
    custom: {
      称号: '- **魔女的发明家**\n- **月下的弹幕猎手**',
      备注: '口头禅：DA☆ZE'
    }
  },

  // ===== 敏感词示例 =====
  {
    id: genId(),
    base: {
      name: '禁忌术',
      type: '敏感词',
      description: '需要替换/规避的高危词汇。',
      fixes: ['禁止术', '秘法', '封印术'],
      color: '#ff0000'
    },
    extended: {
      风险等级: '**高危**\n需重点替换'
    }
  },

  // ===== 词汇示例 =====
  {
    id: genId(),
    base: {
      name: '魔能',
      type: '词汇',
      description: '世界观中的能量单位'
    },
    custom: {
      分类: '能量体系',
      补充说明: '常规范围：0~100；>100 为危险阈值'
    }
  },

  // ===== 联动角色 =====
  {
    id: genId(),
    base: {
      name: '张三丰',
      type: '联动角色',
      affiliation: '武当派',
      description: '武当派开山祖师，太极拳创始人。',
      aliases: ['张真人']
    },
    extended: {
      技能: '- 太极拳\n- 纯阳无极功\n- 太极剑法',
      性格: '超凡脱俗，主张三教合一'
    },
    custom: {
      称号: '“通微显化真人”'
    }
  },

  // ===== 自定义类型 =====
  {
    id: genId(),
    base: {
      name: '黑曜导师',
      type: '炼金顾问',
      affiliation: '旧王廷密会',
      description: '沉默而克制的炼金顾问，偏防御反击，善用环境。',
      color: '#222233'
    },
    extended: {
      战斗风格: '防御反击，环境利用与反制',
      信仰: '旧王廷秘教',
      装备: '- 黑曜法杖\n- 腐蚀手甲'
    },
    custom: {
      备注: '只在主线第三幕短暂现身'
    }
  },

  // ===== 更多测试角色（批量） =====
  {
    id: genId(),
    base: {
      name: '十六夜咲夜',
      type: '配角',
      affiliation: '红魔馆',
      description: '红魔馆女仆长，能操纵时间。',
      aliases: ['咲夜', 'Sakuya']
    },
    extended: {
      技能: '- 投掷银制小刀\n- 停止时间的能力',
      性格: '冷静严谨，绝对忠诚'
    }
  },
  {
    id: genId(),
    base: {
      name: '帕秋莉·诺蕾姬',
      type: '配角',
      affiliation: '红魔馆',
      description: '大图书馆的魔法师，体质虚弱但知识渊博。',
      aliases: ['帕秋莉', 'Patchouli']
    },
    extended: {
      技能: '- 元素魔法\n- 炼金术',
      爱好: '阅读、研究'
    }
  },
  {
    id: genId(),
    base: {
      name: '琪露诺',
      type: '配角',
      affiliation: '雾之湖',
      description: '冰之妖精，自称“最强”。',
      aliases: ['Cirno']
    },
    extended: {
      技能: '操控冷气，制造冰锥弹幕',
      性格: '好胜单纯'
    }
  },
  {
    id: genId(),
    base: {
      name: '奈芙尼丝',
      type: '主角',
      affiliation: '多萝西的禁密书典',
      description: '学姐角色'
    },
    extended: {
      外貌: '黑发长裙，神秘气质',
      性格: '冷静、成熟'
    }
  },
  {
    id: genId(),
    base: {
      name: '凡尼娅',
      type: '主角',
      affiliation: '多萝西的禁密书典',
      description: '灯教修女',
      aliases: ['修女']
    },
    extended: {
      背景: '灯教的修女，信仰不太虔诚'
    }
  }
]);


// refs for scrollToRole（直接存 DOM 元素）
const roleRefs = new Map<string, HTMLElement>()
function setRoleRef (id: string, el: HTMLElement | null) {
  if (el) roleRefs.set(id, el)
}

function scrollToRole (id: string) {
  const el = roleRefs.get(id)
  if (el?.scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // 保持侧栏开启
  drawerOpen.value = true
}

// 展开/收起单个（用克隆触发更新）
function open (id: string) {
  const s = new Set(opened.value)
  s.add(id)
  opened.value = s
}
function close (id: string) {
  const s = new Set(opened.value)
  s.delete(id)
  opened.value = s
}

// 展开/收起全部
function expandAll () {
  opened.value = new Set(roles.value.map(r => r.id))
}
function collapseAll () {
  opened.value = new Set()
}

function onChanged (index: number, e: any) {}
function onTypeChanged (index: number, e: any) {}

// 添加角色
function addRole () {
  const newRole: Role = {
    id: genId(),
    base: {
      name: `新角色 ${roles.value.length + 1}`,
      type: '正则表达式',
      regex: '',
      regexFlags: 'g',
      color: '#e0e0e0',
      priority: 100 + roles.value.length,
      description: ''
    },
    extended: {},
    custom: {}
  }
  roles.value.push(newRole)
  nextTick(() => {
    open(newRole.id)            // 新增的在边栏默认展开
    scrollToRole(newRole.id)    // 并滚动过去
  })
}

function hasBucket (r: Role, bucket: 'base'|'extended'|'custom') {
  const obj = r[bucket]
  return obj && typeof obj === 'object'
}
function countKeys (r: Role, bucket: 'base'|'extended'|'custom') {
  const obj = r[bucket] as KV|undefined
  return obj ? Object.keys(obj).length : 0
}
function bucketEntries (r: Role, bucket: 'base'|'extended'|'custom') {
  const obj = r[bucket] as KV|undefined
  if (!obj) return []
  return Object.keys(obj).map(k => {
    const v = obj[k]
    return { key: k, preview: toPreview(v) }
  })
}
function toPreview (v: any): string {
  if (Array.isArray(v)) return `[${v.map(x => stringifyShort(x)).join(', ')}]`
  if (typeof v === 'object' && v !== null) return '{…}'
  return stringifyShort(v)
}
function stringifyShort (v: any): string {
  const s = String(v ?? '')
  return s.length > 36 ? s.slice(0, 33) + '…' : s
}

function genId () {
  return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
</script>

<style scoped>
/* 右下角：br = bottom-right */
.drawer-toggle.br {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
}

/* 值预览区域等宽字体 + 截断 */
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
.value-preview {
  max-width: 55%;
  min-width: 0; /* allow flex children to shrink correctly */
  /* allow wrapping and break long words when necessary */
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 列表圆角 */
.rounded-borders { border-radius: 8px; }
</style>
