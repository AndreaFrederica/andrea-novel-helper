# 文件中定义优先级

## 概述

系统支持在角色文件中直接定义优先级，这样可以强制提升或降低某个角色的优先级。

## 支持的优先级字段

### 1. JSON5/OJSON5 文件

在角色对象中添加 `_priority` 字段：

```json5
[
    {
        name: "张三",
        uuid: "test-uuid-123",
        _priority: 5000,  // 自定义优先级
        type: "角色",
        color: "#FF0000",
        aliases: ["小三"],
        description: "高优先级角色"
    },
    {
        name: "李四",
        uuid: "test-uuid-456",
        _priority: -100,  // 低优先级（负数）
        type: "角色",
        color: "#00FF00"
    }
]
```

### 2. Markdown 文件

在角色定义中添加 `_priority` 字段：

```markdown
# 张三

- **UUID**: test-uuid-123
- **类型**: 角色
- **颜色**: #FF0000
- **_priority**: 5000
- **别名**:
  - 小三
- **描述**: 高优先级角色
```

### 3. TXT 文件（使用注释）

```txt
# 角色
name: 张三
uuid: test-uuid-123
_priority: 5000  # 通过注释定义（需要解析器支持）
```

## 优先级系统层次

1. **文件中定义的优先级**（最高优先级）
   - `_priority` 字段在文件中直接定义
   - 优先级为0时表示不设置

2. **位置优先级**（如果启用）
   - 外部文件：+100（默认）
   - 内部文件：0（默认）

3. **文件名优先级**（如果启用）
   - `!!!` 前缀：+3000
   - `!!` 前缀：+2000
   - `__` 前缀：+1000

4. **文件类型优先级**（如果启用）
   - `.ojson5`：+3
   - `.json5`：+2
   - `.md`：+1
   - `.txt`：+0

5. **默认优先级**
   - 默认为0

## 优先级记录

每个角色加载后，会自动计算并保存以下信息：

```typescript
interface Role {
    // ... 原有属性
    _priority?: number;          // 文件中定义的原始优先级
    _computedPriority?: number;  // 计算后的总优先级
    _priorityBreakdown?: {      // 优先级构成
        total: number,
        source: {
            fileDefined?: number,  // 文件中定义的
            location?: number,     // 位置优先级
            fileName?: number,     // 文件名优先级
            fileType?: number,     // 文件类型优先级
            default?: number       // 默认优先级
        }
    };
}
```

### 合并时的优先级处理

当两个相同UUID的角色合并时：

1. **计算优先级**：保留优先级高的角色作为基础角色
2. **合并优先级属性**：
   - `_priority`：取两个文件中定义的最大值
   - `_computedPriority`：使用基础角色的计算值
   - `_priorityBreakdown`：使用基础角色的构成，但合并各来源的最大值

示例：
```json5
// zhangsan.json5
{
    "name": "张三",
    "uuid": "char-001",
    "_priority": 100,
    "color": "#FF0000"
}

// __zhangsan.md
{
    "name": "张三",
    "uuid": "char-001",
    "color": "#00FF00"
}
```

合并后的角色：
```json5
{
    "name": "张三",
    "uuid": "char-001",
    "_priority": 100,        // 取最大值
    "color": "#FF0000",      // 基础角色的颜色
    "_computedPriority": 1000, // 来自基础角色
    "_priorityBreakdown": {
        "total": 1000,
        "source": {
            "fileName": 1000   // 来自文件名前缀
        }
    }
}
```

## 实际示例

### 示例1：紧急角色覆盖

```json5
[
    {
        name: "张三",
        uuid: "main-character-001",
        _priority: 10000,  // 极高优先级，覆盖所有其他定义
        type: "主角",
        color: "#FF0000"
    }
]
```

### 示例2：多源文件优先级

文件1：`zhangsan.json5`
```json5
[
    {
        name: "张三",
        uuid: "char-001",
        _priority: 500,  // 中等优先级
        type: "角色",
        color: "#FF0000"
    }
]
```

文件2：`__zhangsan.md`
```markdown
# 张三

- **UUID**: char-001
- **类型**: 角色
- **颜色**: #00FF00
```

配置：
```json
{
  "AndreaNovelHelper.rolePriority": {
    "strategy": "custom",
    "enableFileNamePriority": true,
    "enableLocationPriority": false,
    "enableFileTypePriority": false
  }
}
```

优先级计算：
- `zhangsan.json5`：500（文件定义）
- `__zhangsan.md`：1000（文件名前缀）

结果：MD文件胜出，颜色为绿色。

## 调试信息

在控制台中可以看到详细的优先级计算过程：

```
[SmartRoleAdder] 优先级对比: 张三(500) vs 张三(1000)
[SmartRoleAdder] 张三 优先级构成: { fileDefined: 500 }
[SmartRoleAdder] 张三 优先级构成: { fileName: 1000 }
```

## 使用建议

1. **紧急覆盖**：使用 `_priority` 字段设置高值（如 10000）
2. **版本控制**：使用文件名前缀（`__`、`!!`）进行版本管理
3. **模块化**：使用位置优先级区分外部和内部角色
4. **调试**：查看控制台输出了解优先级计算过程