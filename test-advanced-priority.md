# 高级角色优先级系统

## 概述

新的优先级系统支持独立的优先级组件，可以灵活组合使用。

## 优先级组件

### 1. 基础策略
- `loadOrder`：按加载顺序（默认，最简单）
- `custom`：使用自定义优先级组合

### 2. 可选的优先级组件

#### 2.1 文件名优先级 (`enableFileNamePriority`)
```json
{
  "enableFileNamePriority": true,
  "fileNamePriority": {
    "prefixes": {
      "!!!": 3000,        // 最高优先级
      "!!": 2000,         // 高优先级
      "__": 1000,         // 中等优先级
      "override_": 1500,  // 覆盖文件
      "config_": 500      // 配置文件
    },
    "naturalSort": true   // file1 < file2 < file10
  }
}
```

#### 2.2 文件类型优先级 (`enableFileTypePriority`)
```json
{
  "enableFileTypePriority": true,
  "fileTypePriority": {
    ".md": 1,        // 最低优先级
    ".json5": 2,     // 中等优先级
    ".ojson5": 3,    // 高优先级
    ".txt": 0        // 最低优先级
  }
}
```

#### 2.3 位置优先级 (`enableLocationPriority`)
```json
{
  "enableLocationPriority": true,
  "locationPriority": {
    "external": 100,  // 外部文件（有__init__.ojson5的目录）
    "internal": 0     // 内部文件（novel-helper目录）
  }
}
```

## 配置示例

### 示例1：仅使用文件名优先级
```json
{
  "AndreaNovelHelper.rolePriority": {
    "strategy": "custom",
    "enableFileNamePriority": true,
    "enableFileTypePriority": false,
    "enableLocationPriority": false
  }
}
```

### 示例2：文件类型 + 位置优先级
```json
{
  "AndreaNovelHelper.rolePriority": {
    "strategy": "custom",
    "enableFileNamePriority": false,
    "enableFileTypePriority": true,
    "enableLocationPriority": true,
    "fileTypePriority": {
      ".ojson5": 10,
      ".json5": 5,
      ".md": 1
    },
    "locationPriority": {
      "external": 1000,  // 外部文件极高优先级
      "internal": 0
    }
  }
}
```

### 示例3：全部启用
```json
{
  "AndreaNovelHelper.rolePriority": {
    "strategy": "custom",
    "enableFileNamePriority": true,
    "enableFileTypePriority": true,
    "enableLocationPriority": true,
    "defaultPriority": 0
  }
}
```

## 优先级计算

当 `strategy` 为 `custom` 时，总优先级 = 默认优先级 + 各组件优先级之和：

```
总优先级 = defaultPriority
          + (位置优先级 if enableLocationPriority)
          + (文件名优先级 if enableFileNamePriority)
          + (文件类型优先级 if enableFileTypePriority)
```

## 实际案例

### 场景：外部配置覆盖内部设置
文件结构：
- `novel-helper/characters/zhangsan.md` (内部)
- `external-characters/__zhangsan.json5` (外部)

配置：
```json
{
  "strategy": "custom",
  "enableFileNamePriority": true,
  "enableLocationPriority": true,
  "fileNamePriority": {
    "__": 1000
  },
  "locationPriority": {
    "external": 100,
    "internal": 0
  }
}
```

优先级计算：
- 内部文件：0
- 外部文件：100 + 1000 = 1100

结果：外部文件优先，覆盖内部设置。

## 注意事项

1. **默认关闭**：所有自定义优先级默认关闭，确保向后兼容
2. **灵活组合**：可以根据需要只启用某些优先级组件
3. **外部文件检测**：通过 `__init__.ojson5` 文件判断外部目录
4. **自然排序**：支持 file1 < file2 < file10 的自然排序