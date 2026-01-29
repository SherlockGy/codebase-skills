# Codebase Skills

Claude Code 插件：代码库理解与需求规划工具集。

专为 **Java + Spring** 项目设计，支持深度代码分析、业务逻辑追踪、术语表管理和需求改动规划。

## 特性

- **谦逊原则**：所有结论标注调查范围和确定性层级（✓ 已确认 / ⚠ 推断 / ? 待验证）
- **分阶段工作流**：扫描 → 追踪 → 结论，通过 `context: fork` 强制阶段隔离，防止应付式输出
- **业务/技术区分**：自动识别项目类型（财务/账单 vs 框架/基础设施），采用不同分析策略
- **敏感操作追踪**：
  - 数据库表操作分级（高/中/低敏感度）
  - 下游接口识别（HTTP/Thrift/gRPC/Dubbo）
  - 支持企业封装变体（如 `XxxHelper.XxxClient`）
- **业务规则发现**：从代码中识别业务规则，**用户确认后才沉淀到知识库**（发现 ≠ 沉淀）
- **术语表管理**：静态基础 + 动态发现的混合模式
- **Git 演进分析**：自动检测兼容性注释，追溯历史变更

---

## 安装

### 方式 1：从 GitHub 安装（推荐）

```bash
# 克隆仓库
git clone https://github.com/SherlockGy/codebase-skills.git

# 添加为本地 marketplace
cd codebase-skills
claude plugin marketplace add "./"

# 安装插件（选择安装范围）
claude plugin install codebase-skills@codebase-skills-marketplace --scope user

# 验证安装
claude plugin list
```

**安装范围说明**：
| Scope | 配置位置 | 用途 |
|-------|----------|------|
| `user` | `~/.claude/settings.json` | 所有项目可用（个人使用） |
| `project` | `.claude/settings.json` | 团队共享（提交到版本控制） |
| `local` | `.claude/settings.local.json` | 项目专用（gitignore） |

### 方式 2：临时加载（开发/测试用）

```bash
# 启动 Claude 时加载插件目录
claude --plugin-dir /path/to/codebase-skills
```

### 方式 3：复制到 skills 目录

```bash
# 复制 skills 到个人目录
cp -r codebase-skills/skills/* ~/.claude/skills/

# 复制 hooks 配置（可选）
cp codebase-skills/hooks/hooks.json ~/.claude/hooks/
```

---

## Skills 列表

| Skill | 命令 | 说明 | 用户可调用 |
|-------|------|------|-----------|
| codebase-investigate | `/codebase-investigate` | 主入口，自动编排分析流程 | ✓ |
| codebase-scan | — | 阶段1：快速扫描项目结构 | 内部 |
| codebase-trace | — | 阶段2：深度追踪 + 敏感操作 | 内部 |
| codebase-conclude | — | 阶段3：综合结论 | 内部 |
| glossary-manager | `/glossary-manager` | 术语表管理 | ✓ |
| knowledge-manager | `/knowledge-manager` | 业务规则与知识库管理 | ✓ |
| change-planner | `/change-planner` | 需求改动规划 | ✓ |

---

## 使用示例

### 代码分析

```
/codebase-investigate 分析订单创建的完整流程
```

输出包含：
- 调用链追踪（ASCII 图形式）
- 数据流分析（对象生命周期）
- 敏感操作清单（DB表 + 下游接口）
- 业务规则发现（待用户确认）
- 确定性层级标注
- 调查范围声明

### 术语表管理

```bash
# 查看术语表
/glossary-manager 查看

# 添加术语
/glossary-manager 添加 冲正 "交易的逆向操作，用于撤销原交易"

# 从代码中发现术语
/glossary-manager 发现
```

### 知识库管理

```bash
# 查看已有规则
/knowledge-manager 查看

# 添加已确认的规则
/knowledge-manager 添加 "订单超时取消" "创建后30分钟未支付自动取消" --confirmed

# 确认待定规则
/knowledge-manager 确认 P001

# 从代码中发现规则（不会自动写入）
/knowledge-manager 发现
```

**重要**：发现的规则不会自动写入知识库，需要用户明确确认后才会沉淀。

### 需求规划

```
/change-planner 实现订单超时自动取消功能
```

输出包含：
- `proposal.md` — 需求理解和范围
- `impact-analysis.md` — 影响分析
- `plan.md` — 实现计划
- `tasks.md` — 任务清单

---

## 输出方式

**文件为主，对话框通知**：
- 所有报告输出到文件（便于保存、分享、版本控制）
- 对话框仅通知用户文件位置和简要摘要

完成后的对话框通知示例：
```
✅ 分析完成

结论文件：`.claude/investigation/conclusion.md`

简要发现：
- 订单创建流程涉及 12 个文件，3 个外部服务调用
- 5 个已确认事实，2 个待验证假设

详细内容请查看报告文件。
```

## 输出位置

所有输出文件位于**目标项目的根目录**：

| 类型 | 位置 | 说明 |
|------|------|------|
| 扫描报告 | `.claude/investigation/scan-report.md` | 项目结构、相关文件 |
| 追踪报告 | `.claude/investigation/trace-report.md` | 调用链、数据流、敏感操作 |
| 综合结论 | `.claude/investigation/conclusion.md` | 最终分析结论 |
| 知识库 | `.claude/knowledge/rules.md` | 业务规则 |
| 改动规划 | `.claude/changes/[需求名]/` | proposal.md, plan.md 等 |
| 术语表 | `glossary.md` | 项目术语定义 |
| 追踪日志 | `.claude/investigation/scope-tracking.log` | 调查范围记录 |

---

## 配置

### Hooks

插件包含以下 hooks（位于 `hooks/hooks.json`）：

| Hook | 触发时机 | 功能 |
|------|----------|------|
| 调查范围追踪 | Read/Grep 后 | 记录所有文件读取操作到日志 |
| 输出格式验证 | 写入报告后 | 验证 YAML frontmatter 格式 |

**验证 hooks 是否加载**：
```
/hooks
```

### 自定义配置

如需修改默认行为，可以：

1. **调整敏感度分级**：编辑 `skills/codebase-trace/references/rpc-patterns.md`
2. **添加领域术语模式**：编辑 `skills/glossary-manager/references/domain-patterns.md`
3. **自定义风险评估**：编辑 `skills/change-planner/references/risk-matrix.md`

---

## 设计理念

### 三层约束架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Skill 结构约束                                     │
│  - 每个阶段独立 skill，context: fork 隔离                    │
│  - 下一阶段必须读取上一阶段输出文件                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Hook 验证约束                                      │
│  - 追踪所有 Read/Grep 操作                                   │
│  - 验证输出文件格式                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: 内容格式约束                                       │
│  - 必须包含「调查范围」章节                                  │
│  - 必须标注确定性层级                                        │
└─────────────────────────────────────────────────────────────┘
```

### 确定性层级

借鉴物理学的适用性声明：

| 标记 | 含义 | 示例 |
|------|------|------|
| ✓ 已确认 | 代码明确表达的事实 | "方法 A 调用了方法 B"（代码可见） |
| ⚠ 推断 | 基于代码模式的合理推断 | "这个字段可能用于缓存"（命名暗示） |
| ? 待验证 | 需要进一步确认的假设 | "可能存在并发问题"（需要测试） |

### 工作流编排

```
用户调用 /codebase-investigate
         │
         ▼
┌─────────────────────────────────────────────┐
│  主入口自动编排：                            │
│  1. 判断复杂度                              │
│  2. 调用 /codebase-scan → scan-report.md   │
│  3. 调用 /codebase-trace → trace-report.md │
│  4. 调用 /codebase-conclude → 最终结论      │
└─────────────────────────────────────────────┘
```

用户可以在任意阶段后说「暂停」，查看中间报告并调整方向。

---

## 目录结构

```
codebase-skills/
├── .claude-plugin/
│   ├── plugin.json           # 插件清单
│   └── marketplace.json      # Marketplace 配置
├── hooks/
│   └── hooks.json            # Hook 配置
├── skills/
│   ├── codebase-investigate/ # 主入口
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   │   ├── track-investigation.js
│   │   │   └── validate-output.js
│   │   └── references/
│   │       ├── java-spring-patterns.md
│   │       └── output-templates.md
│   ├── codebase-scan/        # 快速扫描
│   ├── codebase-trace/       # 深度追踪
│   │   └── references/
│   │       └── rpc-patterns.md
│   ├── codebase-conclude/    # 综合结论
│   ├── glossary-manager/     # 术语表
│   │   └── references/
│   │       └── domain-patterns.md
│   ├── knowledge-manager/    # 知识库
│   │   └── references/
│   │       └── rule-patterns.md
│   └── change-planner/       # 改动规划
│       └── references/
│           └── risk-matrix.md
└── README.md
```

---

## 适用场景

### 推荐使用

- Java + Spring 项目的代码理解
- 财务/账单/交易等业务系统分析
- 接手遗留代码时的快速上手
- 需求改动的影响范围评估
- 团队知识库的持续积累

### 暂不支持

- 非 Java 项目（后续可扩展）
- MyBatis XML 深度解析（按需添加）
- 微服务全链路追踪（需要结合 APM 工具）

---

## 常见问题

### Q: 为什么使用 `context: fork`？

A: 防止 AI 跳过中间步骤。子代理无法访问前序对话，必须从文件读取上下文，强制性的文件依赖确保阶段不被跳过。

### Q: 发现的规则为什么不自动保存？

A: 设计原则是「发现 ≠ 沉淀」。自动保存可能引入错误的规则，用户确认后才沉淀确保知识库的准确性。

### Q: 如何添加新的 RPC 模式识别？

A: 编辑 `skills/codebase-trace/references/rpc-patterns.md`，添加新的正则模式和示例代码。

### Q: Hooks 没有生效？

A: 1) 确保重启了 Claude Code 会话；2) 运行 `/hooks` 检查是否加载；3) 检查 hooks.json 格式是否正确。

---

## 贡献

欢迎提交 Issue 和 PR：

- 新的 RPC 模式识别
- 其他语言/框架支持
- 更多领域的术语模式
- Bug 修复和文档改进

---

## 许可

MIT License

---

## 相关链接

- [Claude Code 官方文档](https://docs.anthropic.com/claude-code)
- [Skills 开发指南](https://docs.anthropic.com/claude-code/skills)
- [Plugins 参考](https://docs.anthropic.com/claude-code/plugins)
