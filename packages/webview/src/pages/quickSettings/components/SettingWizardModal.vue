<template>
  <div class="wizard-backdrop" @click.self="emit('close')">
    <section class="wizard-panel" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <aside class="wizard-sidebar">
        <div>
          <h2 id="wizard-title">设置向导</h2>
          <p>{{ currentScope === 'workspace' ? '写入当前工作区' : '写入全局设置' }}</p>
        </div>

        <nav class="wizard-steps" aria-label="设置向导步骤">
          <button
            v-for="(step, index) in wizardSteps"
            :key="step.id"
            type="button"
            class="wizard-step"
            :class="{ active: index === activeStep, complete: index < activeStep }"
            @click="activeStep = index"
          >
            <span>{{ index + 1 }}</span>
            <strong>{{ step.title }}</strong>
            <small>{{ step.caption }}</small>
          </button>
        </nav>
      </aside>

      <main class="wizard-main">
        <header class="wizard-header">
          <div>
            <span class="wizard-kicker">Andrea Novel Helper</span>
            <h3>{{ currentStep.title }}</h3>
            <p>{{ currentStep.description }}</p>
          </div>
          <button type="button" class="icon-button" title="关闭" @click="emit('close')">×</button>
        </header>

        <div class="wizard-body">
          <section v-if="currentStep.kind === 'profile'" class="profile-grid" aria-label="写作场景">
            <button
              v-for="profile in profiles"
              :key="profile.id"
              type="button"
              class="profile-option"
              :class="{ selected: selectedProfile === profile.id }"
              @click="selectProfile(profile.id)"
            >
              <span>{{ profile.tag }}</span>
              <strong>{{ profile.title }}</strong>
              <small>{{ profile.description }}</small>
            </button>
          </section>

          <section v-else-if="currentStep.kind === 'module' && currentModule" class="module-editor">
            <div class="module-summary">
              <label class="module-toggle">
                <input
                  type="checkbox"
                  :checked="isModuleEnabled(currentModule.id)"
                  @change="toggleModule(currentModule.id, ($event.target as HTMLInputElement).checked)"
                />
                <span>包含此模块</span>
              </label>
              <button type="button" class="ghost-button" @click="resetModule(currentModule.id)">
                恢复场景预设
              </button>
            </div>

            <div v-if="moduleItems(currentModule.id).length" class="setting-list">
              <article
                v-for="item in moduleItems(currentModule.id)"
                :key="item.id"
                class="setting-row"
                :class="{ muted: !isModuleEnabled(currentModule.id) }"
              >
                <div class="setting-copy">
                  <div class="setting-title-line">
                    <strong>{{ item.name }}</strong>
                    <span
                      class="scope-pill"
                      :title="sourceTooltip(item)"
                    >
                      {{ sourceLabel(item) }}
                    </span>
                  </div>
                  <code>{{ item.id }}</code>
                  <p v-if="plainDescription(item.description)">
                    {{ plainDescription(item.description) }}
                  </p>
                </div>

                <div class="setting-control">
                  <small>当前：{{ formatValue(item.value) }}</small>
                  <label v-if="item.type === 'boolean'" class="switch-control">
                    <input
                      type="checkbox"
                      :checked="getTargetValue(item) === true"
                      :disabled="!isModuleEnabled(currentModule.id)"
                      @change="setTargetValue(item.id, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ getTargetValue(item) === true ? '开启' : '关闭' }}</span>
                  </label>
                  <select
                    v-else-if="item.enum?.length"
                    :value="String(getTargetValue(item))"
                    :disabled="!isModuleEnabled(currentModule.id)"
                    @change="setTargetValue(item.id, coerceEnumValue(item, ($event.target as HTMLSelectElement).value))"
                  >
                    <option v-for="option in item.enum" :key="String(option)" :value="String(option)">
                      {{ enumLabel(item, option) }}
                    </option>
                  </select>
                  <input
                    v-else-if="item.type === 'number' || item.type === 'integer'"
                    type="number"
                    :value="getTargetValue(item)"
                    :min="item.minimum"
                    :max="item.maximum"
                    :step="item.type === 'integer' ? 1 : 0.1"
                    :disabled="!isModuleEnabled(currentModule.id)"
                    @input="setTargetValue(item.id, Number(($event.target as HTMLInputElement).value))"
                  />
                  <input
                    v-else
                    type="text"
                    :value="formatInputValue(getTargetValue(item))"
                    :disabled="!isModuleEnabled(currentModule.id)"
                    @input="setTargetValue(item.id, ($event.target as HTMLInputElement).value)"
                  />
                </div>
              </article>
            </div>

            <div v-else class="empty-state">
              这个模块当前没有可由向导管理的快速设置项。
            </div>
          </section>

          <section v-else class="review-panel">
            <div class="review-head">
              <div>
                <strong>{{ changedSettings.length ? `${changedSettings.length} 项会被更新` : '没有待更新的设置' }}</strong>
                <span>向导只会写入你在模块中启用并修改过的项目。</span>
              </div>
            </div>

            <div v-if="reviewGroups.length" class="review-groups">
              <article v-for="group in reviewGroups" :key="group.module.id" class="review-group">
                <h4>{{ group.module.title }}</h4>
                <div v-for="change in group.changes" :key="change.item.id" class="review-change">
                  <div>
                    <strong>{{ change.item.name }}</strong>
                    <code>{{ change.item.id }}</code>
                  </div>
                  <span>{{ formatValue(change.from) }}</span>
                  <b>→</b>
                  <span>{{ formatValue(change.to) }}</span>
                </div>
              </article>
            </div>

            <div v-else class="empty-state">
              你可以回到前面的模块调整项目，或者直接取消关闭向导。
            </div>
          </section>
        </div>

        <footer class="wizard-footer" :class="{ 'review-footer': currentStep.kind === 'review' }">
          <template v-if="currentStep.kind === 'review'">
            <div class="footer-actions">
              <button type="button" class="ghost-button" @click="emit('close')">取消</button>
              <button type="button" class="secondary-button" :disabled="!changedSettings.length" @click="emitApply">
                暂存
              </button>
              <button type="button" class="primary-button" :disabled="!changedSettings.length" @click="emitSave">
                保存
              </button>
            </div>
          </template>
          <template v-else>
            <button type="button" class="ghost-button" @click="emit('close')">取消</button>
            <div class="footer-actions">
              <button type="button" class="secondary-button" :disabled="activeStep === 0" @click="activeStep -= 1">
                上一步
              </button>
              <button type="button" class="primary-button" @click="activeStep += 1">
                下一步
              </button>
            </div>
          </template>
        </footer>
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { ConfigItem } from 'src/types/config';

type ProfileId = 'balanced' | 'focus' | 'roleHeavy' | 'aiProofread';
type ModuleId = 'editor' | 'smartEdit' | 'completion' | 'roles' | 'typoAi' | 'status';

interface WizardProfile {
  id: ProfileId;
  title: string;
  tag: string;
  description: string;
}

interface WizardModule {
  id: ModuleId;
  title: string;
  caption: string;
  description: string;
  settingIds: string[];
}

interface WizardStep {
  id: string;
  kind: 'profile' | 'module' | 'review';
  title: string;
  caption: string;
  description: string;
  moduleId?: ModuleId;
}

const props = defineProps<{
  configItems: ConfigItem[];
  currentScope: 'workspace' | 'global';
}>();

const emit = defineEmits<{
  close: [];
  apply: [settings: Record<string, any>];
  save: [settings: Record<string, any>];
}>();

const profiles: WizardProfile[] = [
  {
    id: 'balanced',
    title: '通用写作',
    tag: '推荐',
    description: '适合大多数小说项目，兼顾排版、角色联动和状态栏信息。',
  },
  {
    id: 'focus',
    title: '专注起草',
    tag: '简洁',
    description: '减少界面噪音，保留缩进、括号和基础写作辅助。',
  },
  {
    id: 'roleHeavy',
    title: '角色密集',
    tag: '角色',
    description: '强化角色列表、查询键和别名相关能力。',
  },
  {
    id: 'aiProofread',
    title: 'AI 校对',
    tag: 'AI',
    description: '开启错别字和 LLM 相关辅助，适合后期检查。',
  },
];

const modules: WizardModule[] = [
  {
    id: 'editor',
    title: '编辑器显示',
    caption: '字体、折行、缩进',
    description: '调整 VS Code 编辑器中最影响写作手感的显示选项。',
    settingIds: [
      'editor.wordWrap',
      'editor.wrappingIndent',
      'editor.minimap.enabled',
      'editor.fontSize',
      'editor.fontFamily',
      'editor.insertSpaces',
      'editor.tabSize',
      'editor.detectIndentation',
    ],
  },
  {
    id: 'smartEdit',
    title: '智能编辑',
    caption: '自动括号、回车、排版',
    description: '控制插件在输入时自动补齐、跳出和整理文本的行为。',
    settingIds: [
      'andrea.typeset.enableAutoPairs',
      'andrea.typeset.enableSmartEnter',
      'andrea.typeset.enableSmartExit',
      'andrea.typeset.indentFirstTwoSpaces',
      'andrea.typeset.blankLinesBetweenParas',
      'andrea.typeset.trimTrailingSpaces',
    ],
  },
  {
    id: 'completion',
    title: '补全与查询键',
    caption: '补全触发、罗马字、拼音',
    description: '配置角色补全、查询键生成和别名匹配相关行为。',
    settingIds: [
      'AndreaNovelHelper.completion.triggerMode',
      'AndreaNovelHelper.completion.segmenterType',
      'AndreaNovelHelper.lookupKeys.autoGeneratePinyin',
      'AndreaNovelHelper.lookupKeys.autoGenerateRomanized',
      'AndreaNovelHelper.lookupKeys.treatPinyinAsAlias',
      'AndreaNovelHelper.lookupKeys.treatRomanizedAsAlias',
      'AndreaNovelHelper.lookupKeys.useLlmRomanization',
    ],
  },
  {
    id: 'roles',
    title: '角色列表',
    caption: '分组、详情、同步',
    description: '设置角色列表的分组规则、详情折行和文档角色同步策略。',
    settingIds: [
      'AndreaNovelHelper.docRoles.groupBy',
      'AndreaNovelHelper.docRoles.respectAffiliation',
      'AndreaNovelHelper.docRoles.respectType',
      'AndreaNovelHelper.docRoles.typeOrder',
      'AndreaNovelHelper.allRoles.syncWithDocRoles',
      'AndreaNovelHelper.roles.details.enableRoleExpansion',
      'AndreaNovelHelper.roles.details.enableWrapping',
      'AndreaNovelHelper.package.roleNodes.details.enableWrapping',
    ],
  },
  {
    id: 'typoAi',
    title: 'AI 与错字系统',
    caption: 'LLM、扫描、调试',
    description: '管理错别字检测、自动扫描和 LLM 客户端相关选项。',
    settingIds: [
      'AndreaNovelHelper.typo.enabled',
      'AndreaNovelHelper.typo.mode',
      'AndreaNovelHelper.typo.autoIdentifyOnOpen',
      'AndreaNovelHelper.typo.autoScanOnChange',
      'AndreaNovelHelper.typo.clientLLM.enabled',
      'AndreaNovelHelper.typo.debug.llmTrace',
    ],
  },
  {
    id: 'status',
    title: '状态栏',
    caption: '字数、排版、Git',
    description: '决定底部状态栏显示多少写作和项目状态信息。',
    settingIds: [
      'AndreaNovelHelper.wordCount.statusBar.mode',
      'AndreaNovelHelper.wordCount.statusBar.compact',
      'andrea.typeset.statusBar.compact',
      'AndreaNovelHelper.autoGit.compactStatus',
    ],
  },
];

const profilePresets: Record<ProfileId, Record<string, any>> = {
  balanced: {
    'editor.wordWrap': 'on',
    'editor.wrappingIndent': 'none',
    'editor.minimap.enabled': false,
    'editor.insertSpaces': true,
    'editor.tabSize': 4,
    'editor.detectIndentation': false,
    'andrea.typeset.indentFirstTwoSpaces': true,
    'andrea.typeset.blankLinesBetweenParas': 1,
    'andrea.typeset.enableAutoPairs': true,
    'andrea.typeset.enableSmartEnter': true,
    'andrea.typeset.enableSmartExit': true,
    'andrea.typeset.trimTrailingSpaces': true,
    'AndreaNovelHelper.completion.triggerMode': 'loose',
    'AndreaNovelHelper.completion.segmenterType': 'auto',
    'AndreaNovelHelper.docRoles.groupBy': 'affiliation',
    'AndreaNovelHelper.docRoles.respectAffiliation': true,
    'AndreaNovelHelper.docRoles.respectType': true,
    'AndreaNovelHelper.docRoles.typeOrder': ['主角', '主要角色', '反派', '配角', '联动角色', '词汇', '敏感词', '正则表达式', 'unknown'],
    'AndreaNovelHelper.allRoles.syncWithDocRoles': true,
    'AndreaNovelHelper.roles.details.enableRoleExpansion': true,
    'AndreaNovelHelper.roles.details.enableWrapping': true,
    'AndreaNovelHelper.wordCount.statusBar.mode': 'detailed',
    'AndreaNovelHelper.wordCount.statusBar.compact': false,
    'andrea.typeset.statusBar.compact': false,
    'AndreaNovelHelper.autoGit.compactStatus': false,
  },
  focus: {
    'editor.wordWrap': 'on',
    'editor.wrappingIndent': 'none',
    'editor.minimap.enabled': false,
    'editor.fontSize': 17,
    'editor.insertSpaces': true,
    'editor.tabSize': 4,
    'editor.detectIndentation': false,
    'andrea.typeset.indentFirstTwoSpaces': true,
    'andrea.typeset.blankLinesBetweenParas': 1,
    'andrea.typeset.enableAutoPairs': true,
    'andrea.typeset.enableSmartEnter': true,
    'andrea.typeset.enableSmartExit': true,
    'andrea.typeset.trimTrailingSpaces': true,
    'AndreaNovelHelper.wordCount.statusBar.mode': 'simple',
    'AndreaNovelHelper.wordCount.statusBar.compact': true,
    'andrea.typeset.statusBar.compact': true,
    'AndreaNovelHelper.autoGit.compactStatus': true,
  },
  roleHeavy: {
    'editor.wrappingIndent': 'none',
    'AndreaNovelHelper.completion.triggerMode': 'loose',
    'AndreaNovelHelper.completion.segmenterType': 'auto',
    'AndreaNovelHelper.lookupKeys.autoGeneratePinyin': true,
    'AndreaNovelHelper.lookupKeys.autoGenerateRomanized': true,
    'AndreaNovelHelper.lookupKeys.treatPinyinAsAlias': false,
    'AndreaNovelHelper.lookupKeys.treatRomanizedAsAlias': false,
    'AndreaNovelHelper.lookupKeys.useLlmRomanization': false,
    'AndreaNovelHelper.docRoles.groupBy': 'affiliation',
    'AndreaNovelHelper.docRoles.respectAffiliation': true,
    'AndreaNovelHelper.docRoles.respectType': true,
    'AndreaNovelHelper.docRoles.typeOrder': ['主角', '主要角色', '反派', '配角', '联动角色', '词汇', '敏感词', '正则表达式', 'unknown'],
    'AndreaNovelHelper.allRoles.syncWithDocRoles': true,
    'AndreaNovelHelper.roles.details.enableRoleExpansion': true,
    'AndreaNovelHelper.roles.details.enableWrapping': true,
    'AndreaNovelHelper.package.roleNodes.details.enableWrapping': true,
  },
  aiProofread: {
    'editor.wrappingIndent': 'none',
    'AndreaNovelHelper.typo.enabled': true,
    'AndreaNovelHelper.typo.mode': 'llm',
    'AndreaNovelHelper.typo.autoIdentifyOnOpen': false,
    'AndreaNovelHelper.typo.autoScanOnChange': false,
    'AndreaNovelHelper.typo.clientLLM.enabled': true,
    'AndreaNovelHelper.typo.debug.llmTrace': false,
  },
};

const defaultEnabledModules: Record<ProfileId, ModuleId[]> = {
  balanced: ['editor', 'smartEdit', 'completion', 'roles', 'status'],
  focus: ['editor', 'smartEdit', 'status'],
  roleHeavy: ['completion', 'roles'],
  aiProofread: ['typoAi'],
};

const activeStep = ref(0);
const selectedProfile = ref<ProfileId>('balanced');
const enabledModules = ref<ModuleId[]>([]);
const draftSettings = reactive<Record<string, any>>({});

const profileStep: WizardStep = {
  id: 'profile',
  kind: 'profile',
  title: '选择写作场景',
  caption: '只决定预设',
  description: '先选择一个写作场景。它只会填充后续模块的建议值，不会直接保存任何设置。',
};

const reviewStep: WizardStep = {
  id: 'review',
  kind: 'review',
  title: '确认变更',
  caption: '暂存或保存',
  description: '检查向导将要写入的项目。暂存只更新当前快速设置界面，保存会写入 VS Code 设置。',
};

const itemMap = computed(() => {
  const map = new Map<string, ConfigItem>();
  props.configItems.forEach((item) => map.set(item.id, item));
  return map;
});

const wizardSteps = computed<WizardStep[]>(() => [
  profileStep,
  ...modules.map((module) => ({
    id: module.id,
    kind: 'module' as const,
    title: module.title,
    caption: module.caption,
    description: module.description,
    moduleId: module.id,
  })),
  reviewStep,
]);

const currentStep = computed<WizardStep>(() => wizardSteps.value[activeStep.value] ?? profileStep);
const currentModule = computed(() => {
  const step = currentStep.value;
  if (step.kind !== 'module' || !step.moduleId) {
    return undefined;
  }
  return modules.find((module) => module.id === step.moduleId);
});

const changedSettings = computed(() => {
  const changes: Array<{ module: WizardModule; item: ConfigItem; from: any; to: any }> = [];
  for (const module of modules) {
    if (!isModuleEnabled(module.id)) {
      continue;
    }
    for (const item of moduleItems(module.id)) {
      const target = getTargetValue(item);
      if (!isSameValue(item.value, target)) {
        changes.push({ module, item, from: item.value, to: target });
      }
    }
  }
  return changes;
});

const reviewGroups = computed(() => modules
  .map((module) => ({
    module,
    changes: changedSettings.value.filter((change) => change.module.id === module.id),
  }))
  .filter((group) => group.changes.length > 0));

applyProfilePreset(selectedProfile.value);

function selectProfile(profile: ProfileId): void {
  selectedProfile.value = profile;
  applyProfilePreset(profile);
}

function buildPreset(profile: ProfileId): Record<string, any> {
  return profilePresets[profile];
}

function applyProfilePreset(profile: ProfileId): void {
  const preset = buildPreset(profile);
  Object.keys(draftSettings).forEach((key) => {
    delete draftSettings[key];
  });
  enabledModules.value = [...defaultEnabledModules[profile]];
  modules.forEach((module) => {
    module.settingIds.forEach((id) => {
      const item = itemMap.value.get(id);
      if (!item) {
        return;
      }
      draftSettings[id] = Object.prototype.hasOwnProperty.call(preset, id) ? preset[id] : item.value;
    });
  });
}

function moduleItems(moduleId: ModuleId): ConfigItem[] {
  const module = modules.find((entry) => entry.id === moduleId);
  if (!module) {
    return [];
  }
  return module.settingIds
    .map((id) => itemMap.value.get(id))
    .filter((item): item is ConfigItem => Boolean(item));
}

function isModuleEnabled(moduleId: ModuleId): boolean {
  return enabledModules.value.includes(moduleId);
}

function toggleModule(moduleId: ModuleId, checked: boolean): void {
  if (checked && !enabledModules.value.includes(moduleId)) {
    enabledModules.value = [...enabledModules.value, moduleId];
    return;
  }
  if (!checked) {
    enabledModules.value = enabledModules.value.filter((id) => id !== moduleId);
  }
}

function resetModule(moduleId: ModuleId): void {
  const preset = buildPreset(selectedProfile.value);
  moduleItems(moduleId).forEach((item) => {
    draftSettings[item.id] = Object.prototype.hasOwnProperty.call(preset, item.id) ? preset[item.id] : item.value;
  });
  if (!enabledModules.value.includes(moduleId)) {
    enabledModules.value = [...enabledModules.value, moduleId];
  }
}

function getTargetValue(item: ConfigItem): any {
  return Object.prototype.hasOwnProperty.call(draftSettings, item.id) ? draftSettings[item.id] : item.value;
}

function setTargetValue(id: string, value: any): void {
  draftSettings[id] = value;
}

function emitApply(): void {
  emit('apply', targetSettings());
}

function emitSave(): void {
  emit('save', targetSettings());
}

function targetSettings(): Record<string, any> {
  return changedSettings.value.reduce<Record<string, any>>((settings, change) => {
    settings[change.item.id] = change.to;
    return settings;
  }, {});
}

function coerceEnumValue(item: ConfigItem, rawValue: string): any {
  const match = item.enum?.find((option) => String(option) === rawValue);
  return match ?? rawValue;
}

function enumLabel(item: ConfigItem, option: any): string {
  const index = item.enum?.findIndex((entry) => entry === option) ?? -1;
  const description = index >= 0 ? item.enumDescriptions?.[index] : undefined;
  return description ? `${option} - ${description}` : String(option);
}

function sourceLabel(item: ConfigItem): string {
  if (item.valueSource === 'workspace') {
    return '工作区';
  }
  if (item.valueSource === 'global') {
    return '全局';
  }
  return '默认';
}

function sourceTooltip(item: ConfigItem): string {
  const source = sourceLabel(item);
  if (item.valueSource === 'default') {
    return '当前值来自默认设置，VS Code 设置文件中还没有显式写入这个项目。';
  }
  return `当前生效值来自${source}设置。工作区设置会覆盖全局设置。`;
}

function plainDescription(description: string): string {
  return (description || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_>#-]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function formatInputValue(value: any): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatValue(value: any): string {
  if (value === undefined) {
    return '未设置';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? '开启' : '关闭';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function isSameValue(left: any, right: any): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
</script>

<style scoped>
.wizard-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
}

.wizard-panel {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  width: min(1160px, 96vw);
  height: min(760px, 92vh);
  overflow: hidden;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
}

.wizard-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 32px 28px;
  background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent);
  border-right: 1px solid var(--vscode-panel-border);
}

.wizard-sidebar h2,
.wizard-header h3,
.review-group h4 {
  margin: 0;
}

.wizard-sidebar h2 {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0;
}

.wizard-sidebar p,
.wizard-header p,
.profile-option small,
.wizard-step small,
.setting-copy p,
.review-head span {
  color: var(--vscode-descriptionForeground);
}

.wizard-sidebar p {
  margin: 6px 0 0;
}

.wizard-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  margin-top: 36px;
  padding-right: 4px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.wizard-step {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 4px 12px;
  width: 100%;
  padding: 12px;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}

.wizard-step:hover,
.wizard-step.active {
  background: color-mix(in srgb, var(--vscode-list-hoverBackground) 72%, transparent);
  border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 55%, transparent);
}

.wizard-step span {
  grid-row: span 2;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-radius: 50%;
}

.wizard-step.complete span {
  background: var(--vscode-testing-iconPassed);
}

.wizard-step strong {
  align-self: end;
}

.wizard-main {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.wizard-header,
.wizard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 28px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.wizard-footer {
  border-top: 1px solid var(--vscode-panel-border);
  border-bottom: 0;
}

.wizard-footer.review-footer {
  justify-content: flex-end;
}

.wizard-kicker {
  display: block;
  margin-bottom: 8px;
  color: var(--vscode-textLink-foreground);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.wizard-header p {
  max-width: 680px;
  margin: 8px 0 0;
}

.wizard-body {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 28px;
  scrollbar-gutter: stable;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.profile-option {
  display: grid;
  gap: 10px;
  min-height: 150px;
  padding: 20px;
  color: inherit;
  text-align: left;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  cursor: pointer;
}

.profile-option:hover,
.profile-option.selected {
  border-color: var(--vscode-textLink-foreground);
}

.profile-option span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  min-width: 44px;
  min-height: 32px;
  padding: 3px 8px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.profile-option strong {
  font-size: 20px;
}

.module-editor {
  display: grid;
  gap: 16px;
}

.module-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 70%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
}

.module-toggle,
.switch-control {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.setting-list,
.review-groups {
  display: grid;
  gap: 10px;
}

.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
  gap: 18px;
  align-items: center;
  padding: 16px 18px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 68%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
}

.setting-row.muted {
  opacity: 0.55;
}

.setting-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.scope-pill {
  padding: 2px 7px;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-radius: 999px;
  font-size: 11px;
}

.setting-copy code,
.review-change code {
  display: block;
  margin-top: 6px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.setting-copy p {
  margin: 8px 0 0;
  line-height: 1.5;
}

.setting-control {
  display: grid;
  gap: 8px;
}

.setting-control small {
  color: var(--vscode-descriptionForeground);
}

.setting-control input[type='text'],
.setting-control input[type='number'],
.setting-control select {
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
}

.switch-control {
  justify-content: space-between;
  min-height: 34px;
  padding: 6px 10px;
  color: var(--vscode-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
}

.review-panel {
  display: grid;
  gap: 16px;
}

.review-head {
  padding: 16px 18px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
}

.review-head div {
  display: grid;
  gap: 6px;
}

.review-group {
  display: grid;
  gap: 8px;
}

.review-group h4 {
  padding: 4px 2px;
  color: var(--vscode-textLink-foreground);
}

.review-change {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(90px, 150px) 18px minmax(90px, 150px);
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 68%, transparent);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
}

.review-change span {
  min-width: 0;
  padding: 6px 8px;
  overflow: hidden;
  color: var(--vscode-input-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--vscode-input-background);
  border-radius: 4px;
}

.review-change b {
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
  text-align: center;
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 220px;
  color: var(--vscode-descriptionForeground);
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 55%, transparent);
  border: 1px dashed var(--vscode-panel-border);
  border-radius: 8px;
}

.footer-actions {
  display: flex;
  gap: 10px;
}

.icon-button,
.ghost-button,
.secondary-button,
.primary-button {
  min-height: 34px;
  padding: 0 14px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}

.icon-button {
  min-width: 34px;
  padding: 0;
  color: var(--vscode-icon-foreground);
  background: transparent;
  font-size: 24px;
}

.ghost-button {
  color: var(--vscode-foreground);
  background: transparent;
  border-color: var(--vscode-panel-border);
}

.secondary-button {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}

.primary-button:hover,
.secondary-button:hover {
  background: var(--vscode-button-hoverBackground);
}

button:disabled,
input:disabled,
select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 860px) {
  .wizard-panel {
    grid-template-columns: 1fr;
    height: 94vh;
  }

  .wizard-sidebar {
    display: none;
  }

  .profile-grid,
  .setting-row,
  .review-change {
    grid-template-columns: 1fr;
  }

  .wizard-header,
  .wizard-footer,
  .wizard-body {
    padding: 18px;
  }
}
</style>
