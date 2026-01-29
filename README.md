# Codebase Skills

代码库理解与需求规划工具集。支持 Java + Spring 项目的深度分析、业务逻辑追踪、术语表管理和改动规划。

## 特性

- **谦逊原则**：所有结论标注调查范围和确定性层级
- **分阶段工作流**：扫描 → 追踪 → 结论，防止应付式输出
- **业务/技术区分**：自动识别项目类型，采用不同分析策略
- **术语表管理**：静态基础 + 动态发现的混合模式
- **敏感操作追踪**：数据库表操作分级 + 下游接口识别（HTTP/Thrift/gRPC/Dubbo）
- **业务规则发现**：从代码中识别业务规则，用户确认后沉淀到知识库
- **Git 演进分析**：自动检测兼容性注释，追溯历史变更

## 安装

### 方式 1：通过本地 Marketplace 安装（推荐）

```bash
# 1. 添加本地 marketplace
cd C:\Users\sherl\Desktop
claude plugin marketplace add "./codebase-skills"

# 2. 安装插件
claude plugin install codebase-skills@codebase-skills-marketplace --scope user

# 3. 验证安装
claude plugin list
```

### 方式 2：临时加载（开发/测试用）

```bash
# 启动 Claude 时加载插件目录
claude --plugin-dir "C:\Users\sherl\Desktop\codebase-skills"
```

## Skills 列表

| Skill | 命令 | 说明 |
|-------|------|------|
| codebase-investigate | `/codebase-investigate` | 主入口，代码库分析 |
| codebase-scan | （内部） | 阶段1：快速扫描 |
| codebase-trace | （内部） | 阶段2：深度追踪 + 敏感操作追踪 |
| codebase-conclude | （内部） | 阶段3：综合结论 |
| glossary-manager | `/glossary-manager` | 术语表管理 |
| knowledge-manager | `/knowledge-manager` | 业务规则与知识库管理 |
| change-planner | `/change-planner` | 需求改动规划 |

## 使用示例

### 代码分析

```
/codebase-investigate 分析订单创建的完整流程
```

输出包含：
- 调用链追踪
- 数据流分析
- 确定性层级标注
- 调查范围声明

### 术语表管理

```
/glossary-manager 查看术语表
/glossary-manager 添加术语 冲正 "交易的逆向操作"
/glossary-manager 扫描发现术语
```

### 知识库管理

```
/knowledge-manager 查看知识库
/knowledge-manager 添加规则 "订单超时取消" "创建后30分钟未支付自动取消" --confirmed
/knowledge-manager 确认规则 P001
/knowledge-manager 发现规则
```

**注意**：发现的规则不会自动写入知识库，需要用户明确确认后才会沉淀。

### 需求规划

```
/change-planner 实现订单超时自动取消功能
```

输出包含：
- 需求理解（proposal.md）
- 影响分析（impact-analysis.md）
- 实现计划（plan.md）
- 任务清单（tasks.md）

## 输出位置

- **调查产物**：项目根目录 `.claude/investigation/`
- **知识库**：项目根目录 `.claude/knowledge/`
- **改动规划**：项目根目录 `.claude/changes/[需求名称]/`
- **术语表**：项目根目录 `glossary.md`

## 配置

### Hooks（可选）

插件包含以下 hooks：
- **调查范围追踪**：记录所有 Read/Grep 操作
- **输出格式验证**：验证报告文件格式

启用方式：将 `hooks/settings.json` 合并到你的 hooks 配置中。

## 设计理念

### 三层约束架构

1. **Skill 结构约束**：阶段隔离 + 文件依赖
2. **Hook 验证约束**：追踪调查范围 + 验证输出格式
3. **内容格式约束**：确定性层级 + 调查范围声明

### 确定性层级

- ✓ **已确认**：代码明确表达的事实
- ⚠ **推断**：基于代码模式的合理推断
- ? **待验证**：需要进一步确认的假设

### 防止应付式输出

- 使用 `context: fork` 隔离各阶段
- 下一阶段必须读取上一阶段的输出文件
- 无前序输出 = 无法继续

## 许可

MIT
