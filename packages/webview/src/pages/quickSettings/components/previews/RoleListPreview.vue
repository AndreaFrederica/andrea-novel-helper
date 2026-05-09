<template>
  <div class="role-list-preview">
    <div class="role-list-preview__header">
      <span>{{ title }}</span>
      <span v-if="effectiveSynced" class="sync-badge">{{ t('quickSettings.roleListPreview.synced') }}</span>
    </div>

    <div class="tree-panel">
      <template v-for="node in treeNodes" :key="node.id">
        <div class="tree-row tree-row--group">
          <span class="twisty">⌄</span>
          <span class="tree-icon">{{ node.icon }}</span>
          <span class="tree-label">{{ node.label }}</span>
          <span class="tree-count">{{ node.count }}</span>
        </div>

        <template v-for="child in node.children" :key="child.id">
          <div
            class="tree-row"
            :class="child.kind === 'type' ? 'tree-row--type' : 'tree-row--role'"
            :style="{ paddingLeft: child.kind === 'type' ? '28px' : '44px' }"
          >
            <span class="twisty">{{ child.kind === 'type' ? '⌄' : '' }}</span>
            <span class="tree-icon">{{ child.icon }}</span>
            <span class="tree-label">{{ child.label }}</span>
            <span v-if="child.kind === 'type'" class="tree-count">{{ child.count }}</span>
            <span v-else class="role-type">{{ child.meta }}</span>
          </div>

          <div
            v-for="role in child.children"
            :key="role.id"
            class="tree-row tree-row--role"
            style="padding-left: 58px"
          >
            <span class="twisty"></span>
            <span class="role-dot" :style="{ backgroundColor: role.color }"></span>
            <span class="tree-label">{{ role.label }}</span>
            <span class="role-type">{{ role.meta }}</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

type MatchType = 'affiliation' | 'type'
type RoleListScope = 'docRoles' | 'allRoles'

interface CustomGroupRule {
  name: string
  matchType: MatchType
  patterns: string[]
}

interface RoleListSettings {
  groupBy: string
  respectAffiliation: boolean
  respectType: boolean
  primaryGroup: string
  typeOrder: string[]
  useCustomGroups: boolean
  customGroups: CustomGroupRule[]
  syncWithDocRoles?: boolean
}

interface SampleRole {
  name: string
  type: string
  affiliation: string
  color: string
}

interface TreeRoleNode {
  id: string
  kind: 'role'
  label: string
  meta: string
  color: string
}

interface TreeChildNode {
  id: string
  kind: 'type' | 'role'
  icon: string
  label: string
  meta?: string
  count?: number
  children: TreeRoleNode[]
}

interface TreeGroupNode {
  id: string
  icon: string
  label: string
  count: number
  children: TreeChildNode[]
}

interface HierarchyTypeGroup {
  type: string
  roles: SampleRole[]
}

interface HierarchyGroup {
  affiliation: string
  types: HierarchyTypeGroup[]
}

const props = defineProps<{
  scope: RoleListScope
  title: string
  settings: RoleListSettings
  docSettings?: RoleListSettings
}>()

const { t } = useI18n()

const sampleRoles: SampleRole[] = [
  { name: '林秋', type: '主角', affiliation: '调查组', color: '#4ea1ff' },
  { name: '沈灯', type: '配角', affiliation: '调查组', color: '#87c38f' },
  { name: '旧城档案', type: '词汇', affiliation: '设定', color: '#c792ea' },
  { name: '禁用称呼', type: '敏感词', affiliation: '校对', color: '#ff8a65' },
  { name: '第七号回廊', type: '正则表达式', affiliation: '校对', color: '#f6c177' },
  { name: '顾问先生', type: '联动角色', affiliation: '外部协作', color: '#f78fb3' },
]

const defaultRoleTypeOrder = ['主角', '主要角色', '反派', '配角', '联动角色', '词汇', '敏感词', '正则表达式', 'unknown']

const effectiveSynced = computed(() => {
  return props.scope === 'allRoles' && props.settings.syncWithDocRoles === true && props.docSettings
})

const effectiveSettings = computed(() => {
  if (effectiveSynced.value && props.docSettings) return props.docSettings
  return props.settings
})

const treeNodes = computed<TreeGroupNode[]>(() => {
  return renderHierarchy(buildHierarchy(new Set(sampleRoles), effectiveSettings.value), effectiveSettings.value.useCustomGroups)
})

function buildHierarchy(seen: Set<SampleRole>, settings: RoleListSettings): HierarchyGroup[] {
  const {
    respectAffiliation = true,
    respectType = true,
    useCustomGroups = false,
    customGroups = [],
  } = settings
  const groupBy = normalizeGroupBy(settings.groupBy)
  const primaryGroup = normalizePrimaryGroup(settings.primaryGroup)
  const typeOrder = normalizeTypeOrder(settings.typeOrder)

  if (groupBy === 'none') {
    const roles = sortRoles(Array.from(seen))
    return [{ affiliation: t('quickSettings.roleListPreview.allRoles'), types: [{ type: '__FLAT__', roles }] }]
  }

  if (useCustomGroups && customGroups.length > 0) {
    return buildCustomGroups(seen, customGroups, respectAffiliation, respectType, typeOrder)
  }

  const map = new Map<string, Map<string, SampleRole[]>>()
  for (const role of seen) {
    let firstKey = ''
    let secondKey = ''
    if (groupBy === 'type') {
      firstKey = role.type || 'unknown'
      secondKey = respectAffiliation ? role.affiliation.trim() || t('quickSettings.roleListPreview.ungrouped') : ''
    } else if (respectAffiliation) {
      if (primaryGroup === 'type') {
        firstKey = role.type || 'unknown'
        secondKey = respectType ? role.affiliation.trim() || t('quickSettings.roleListPreview.ungrouped') : ''
      } else {
        firstKey = role.affiliation.trim() || t('quickSettings.roleListPreview.ungrouped')
        secondKey = respectType ? role.type || 'unknown' : ''
      }
    } else if (respectType) {
      firstKey = role.type || 'unknown'
      secondKey = ''
    } else {
      firstKey = t('quickSettings.roleListPreview.allRoles')
      secondKey = ''
    }

    if (!map.has(firstKey)) map.set(firstKey, new Map())
    const typeMap = map.get(firstKey)!
    if (!typeMap.has(secondKey)) typeMap.set(secondKey, [])
    typeMap.get(secondKey)!.push(role)
  }

  const firstLevelIsType = groupBy === 'type' || (!respectAffiliation && respectType) || (groupBy === 'affiliation' && respectAffiliation && primaryGroup === 'type')
  const secondLevelIsType = !firstLevelIsType && respectType
  const groups: HierarchyGroup[] = []
  for (const [firstKey, typeMap] of map) {
    const types: HierarchyTypeGroup[] = []
    for (const [secondKey, roles] of typeMap) {
      types.push({ type: secondKey === '' ? '__FLAT__' : secondKey, roles: sortRoles(roles) })
    }
    types.sort((a, b) => secondLevelIsType ? sortRoleType(a.type, b.type, typeOrder) : sortText(a.type, b.type))
    groups.push({ affiliation: firstKey, types })
  }
  groups.sort((a, b) => firstLevelIsType
    ? sortRoleType(a.affiliation, b.affiliation, typeOrder)
    : sortText(a.affiliation, b.affiliation))
  return groups
}

function buildCustomGroups(
  seen: Set<SampleRole>,
  customGroups: CustomGroupRule[],
  respectAffiliation: boolean,
  respectType: boolean,
  typeOrder: string[],
): HierarchyGroup[] {
  const grouped = new Map<string, SampleRole[]>()
  const other: SampleRole[] = []

  for (const group of customGroups) {
    if (group?.name) grouped.set(group.name, [])
  }

  for (const role of seen) {
    let matched = false
    for (const group of customGroups) {
      if (!group?.name || !Array.isArray(group.patterns)) continue
      const field = group.matchType === 'type' ? role.type || '' : role.affiliation || ''
      if (group.patterns.some(pattern => field.includes(pattern))) {
        grouped.get(group.name)?.push(role)
        matched = true
        break
      }
    }
    if (!matched) other.push(role)
  }

  if (other.length) grouped.set(t('quickSettings.roleListPreview.other'), other)

  const hasAffBased = customGroups.some(group => group?.matchType === 'affiliation')
  if (!respectAffiliation && hasAffBased) {
    const merged = Array.from(grouped.values()).flat()
    if (!merged.length) return []
    return [{ affiliation: t('quickSettings.roleListPreview.allRoles'), types: buildTypeGroups(merged, respectType, typeOrder) }]
  }

  const result: HierarchyGroup[] = []
  for (const [name, roles] of grouped) {
    if (roles.length) result.push({ affiliation: name, types: buildTypeGroups(roles, respectType, typeOrder) })
  }

  result.sort((a, b) => {
    if (a.affiliation === t('quickSettings.roleListPreview.other')) return 1
    if (b.affiliation === t('quickSettings.roleListPreview.other')) return -1
    return customGroups.findIndex(group => group.name === a.affiliation) -
      customGroups.findIndex(group => group.name === b.affiliation)
  })
  return result
}

function buildTypeGroups(roles: SampleRole[], respectType: boolean, typeOrder: string[]): HierarchyTypeGroup[] {
  const typeMap = new Map<string, SampleRole[]>()
  for (const role of roles) {
    const type = respectType ? role.type || 'unknown' : '__FLAT__'
    if (!typeMap.has(type)) typeMap.set(type, [])
    typeMap.get(type)!.push(role)
  }
  return Array.from(typeMap.entries())
    .map(([type, groupRoles]) => ({ type, roles: sortRoles(groupRoles) }))
    .sort((a, b) => sortRoleType(a.type, b.type, typeOrder))
}

function renderHierarchy(groups: HierarchyGroup[], useCustomGroups: boolean): TreeGroupNode[] {
  const specialTypes = new Set(['敏感词', '词汇', '正则表达式'])
  const typeOrder = normalizeTypeOrder(effectiveSettings.value.typeOrder)
  const nodes: TreeGroupNode[] = []
  const specialMap = new Map<string, Map<string, SampleRole[]>>()

  for (const group of groups) {
    const children: TreeChildNode[] = []
    for (const typeGroup of group.types) {
      if (typeGroup.type === '__FLAT__') {
        children.push(...typeGroup.roles.map(role => toInlineRole(role)))
        continue
      }

      if (!useCustomGroups && specialTypes.has(typeGroup.type)) {
        if (!specialMap.has(typeGroup.type)) specialMap.set(typeGroup.type, new Map())
        const affMap = specialMap.get(typeGroup.type)!
        if (!affMap.has(group.affiliation)) affMap.set(group.affiliation, [])
        affMap.get(group.affiliation)!.push(...typeGroup.roles)
        continue
      }

      children.push({
        id: `${group.affiliation}:${typeGroup.type}`,
        kind: 'type',
        icon: '▦',
        label: typeGroup.type,
        count: typeGroup.roles.length,
        children: typeGroup.roles.map(role => toRoleNode(role, typeGroup.type)),
      })
    }
    if (children.length) {
      nodes.push({
        id: group.affiliation,
        icon: '▣',
        label: group.affiliation,
        count: countChildren(children),
        children,
      })
    }
  }

  if (!useCustomGroups && specialMap.size) {
    const specialChildren: TreeChildNode[] = []
    for (const [type, affMap] of Array.from(specialMap.entries()).sort((a, b) => sortRoleType(a[0], b[0], typeOrder))) {
      for (const [affiliation, roles] of Array.from(affMap.entries()).sort((a, b) => sortText(a[0], b[0]))) {
        specialChildren.push({
          id: `special:${type}:${affiliation}`,
          kind: 'type',
          icon: '◇',
          label: `${type} / ${affiliation}`,
          count: roles.length,
          children: sortRoles(roles).map(role => toRoleNode(role, type)),
        })
      }
    }
    nodes.push({
      id: 'special',
      icon: '◆',
      label: t('quickSettings.roleListPreview.specialRoot'),
      count: countChildren(specialChildren),
      children: specialChildren,
    })
  }

  return nodes
}

function toInlineRole(role: SampleRole): TreeChildNode {
  return {
    id: `role:${role.name}`,
    kind: 'role',
    icon: '',
    label: role.name,
    meta: role.type,
    children: [],
  }
}

function toRoleNode(role: SampleRole, type: string): TreeRoleNode {
  return {
    id: `role:${type}:${role.name}`,
    kind: 'role',
    label: role.name,
    meta: role.affiliation,
    color: role.color,
  }
}

function countChildren(children: TreeChildNode[]): number {
  return children.reduce((sum, child) => sum + (child.kind === 'type' ? child.children.length : 1), 0)
}

function sortRoles(roles: SampleRole[]): SampleRole[] {
  return roles.slice().sort((a, b) => sortText(a.name, b.name))
}

function sortText(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans', { numeric: true, sensitivity: 'base' })
}

function normalizeTypeOrder(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : defaultRoleTypeOrder
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    const text = String(item ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result.length ? result : [...defaultRoleTypeOrder]
}

function sortRoleType(a: string, b: string, typeOrder: string[]): number {
  const ar = roleTypeRank(a, typeOrder)
  const br = roleTypeRank(b, typeOrder)
  if (ar !== br) return ar - br
  return sortText(a, b)
}

function roleTypeRank(value: string, typeOrder: string[]): number {
  const text = String(value || '').trim()
  const exact = typeOrder.indexOf(text)
  if (exact >= 0) return exact
  const lower = text.toLocaleLowerCase()
  const partial = typeOrder.findIndex(item => {
    const token = item.toLocaleLowerCase()
    return Boolean(token && lower.includes(token))
  })
  return partial >= 0 ? partial : typeOrder.length
}

function normalizeGroupBy(value: string): 'affiliation' | 'type' | 'none' {
  if (value === 'type' || value === 'none') return value
  return 'affiliation'
}

function normalizePrimaryGroup(value: string): 'affiliation' | 'type' {
  return value === 'type' ? 'type' : 'affiliation'
}
</script>

<style scoped>
.role-list-preview {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-list-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground, #999);
}

.sync-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  font-size: 10px;
}

.tree-panel {
  height: 250px;
  overflow: auto;
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px;
  background-color: var(--vscode-sideBar-background, #252526);
  padding: 6px 0;
}

.tree-row {
  display: grid;
  grid-template-columns: 16px 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #e0e0e0));
}

.tree-row--group {
  font-weight: 600;
}

.tree-row--type {
  color: var(--vscode-foreground, #e0e0e0);
}

.tree-row--role {
  color: var(--vscode-descriptionForeground, #999);
}

.twisty,
.tree-icon {
  color: var(--vscode-descriptionForeground, #999);
}

.tree-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-count,
.role-type {
  color: var(--vscode-descriptionForeground, #999);
  font-size: 11px;
}

.role-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(127, 127, 127, 0.4);
}
</style>
