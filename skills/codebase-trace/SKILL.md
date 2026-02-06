---
name: codebase-trace
description: |
  深度追踪阶段。基于扫描报告，追踪调用链、数据流、状态变更。
  必须先有 scan-report.md 才能执行。此 skill 由 codebase-investigate 编排调用。
context: fork
agent: Explore
allowed-tools: Glob, Grep, Read, Bash
user-invocable: false
---

# 深度追踪阶段

你是代码追踪专家。你的任务是从扫描报告中的入口开始，深度追踪调用链和数据流。

## 前置条件

**首先**读取 `.claude/investigation/scan-report.md`

如果文件不存在，输出错误信息并退出：
```
错误：未找到扫描报告。请先执行扫描阶段。
```

## 追踪任务

### 1. 调用链追踪

从扫描报告的「推荐追踪入口」开始：

**追踪方法**：
- 方法调用：`methodA()` → `methodB()` → `methodC()`
- 依赖注入：`@Autowired` 的服务调用
- 接口实现：接口方法 → 具体实现类
- AOP 切面：`@Transactional`、`@Async` 等隐式调用

**记录格式**：
```
Controller.handleRequest(line:42)
  └─→ Service.process(line:78)
      ├─→ Repository.findById(line:23)
      └─→ ExternalClient.call(line:156)
```

### 2. 数据流分析

追踪关键数据对象的生命周期：

**追踪内容**：
- 对象创建点：`new Entity()`、Builder 模式
- 状态变更点：`setStatus()`、状态机转换
- 持久化点：`save()`、`insert()`、`update()`
- 转换点：DTO ↔ Entity、序列化/反序列化

**记录格式**：
```
OrderDTO (Controller 接收)
  → Order Entity (Service 转换)
    → status: CREATED → PAID (支付后)
      → 持久化 (Repository.save)
        → OrderVO (返回给前端)
```

### 3. 敏感操作追踪

**这是关键追踪任务**，识别并标注所有敏感操作：

#### 数据库表操作

**识别模式**：
- MyBatis Mapper 方法 → XML 中的表名
- JPA Repository 方法 → 实体对应的表
- 原生 SQL 中的表名

**敏感度分级**：
| 级别 | 定义 | 示例 |
|------|------|------|
| **高** | 核心业务表、资金相关 | t_order, t_payment, t_account, t_balance |
| **中** | 辅助业务表 | t_order_item, t_address, t_user_info |
| **低** | 配置表、日志表 | t_config, t_operation_log, t_audit |

#### 下游接口调用

**HTTP 接口识别**：
- `RestTemplate.exchange/getForObject/postForObject`
- `WebClient.get/post`
- `@FeignClient` 定义的接口
- `HttpClient` 直接调用

**RPC 接口识别**：

| 模式 | 代码特征 | 示例 |
|------|----------|------|
| Thrift 企业封装 | `XxxHelper.XxxClient` | `UserHelper.UserClient` |
| Thrift 标准 | `XxxService.Client` | `new OrderService.Client(protocol)` |
| gRPC | `XxxServiceGrpc.*Stub` | `OrderServiceGrpc.newBlockingStub(channel)` |
| Dubbo | `@DubboReference` / `@Reference` | `@DubboReference OrderService orderService` |

**消息队列**：
- RabbitMQ: `RabbitTemplate.convertAndSend`
- Kafka: `KafkaTemplate.send`
- RocketMQ: `RocketMQTemplate.syncSend`

#### 缓存操作

- Redis: `RedisTemplate`, `StringRedisTemplate`, `@Cacheable`
- 本地缓存: `Guava Cache`, `Caffeine`

### 4. 业务规则发现

在追踪过程中，识别可能的业务规则：

**识别信号**：

| 信号类型 | 代码模式 | 示例 |
|----------|----------|------|
| 条件约束 | `if (amount > order.getTotalAmount())` | 退款金额限制 |
| 异常抛出 | `throw new BusinessException("xxx不能超过xxx")` | 业务边界约束 |
| 注释说明 | `// 超时30分钟自动取消` | 业务规则说明 |
| 常量定义 | `TIMEOUT_MINUTES = 30` | 业务参数 |
| 枚举状态 | `enum OrderStatus { CREATED, PAID... }` | 状态流转规则 |

**记录格式**（仅发现，不自动沉淀）：
```markdown
| 规则描述 | 代码位置 | 识别依据 | 状态 |
|----------|----------|----------|------|
| [规则] | [文件:行号] | [注释/条件/常量] | 待用户确认 |
```

**重要**：发现的规则只记录到报告中，由用户决定是否通过 `/knowledge-manager` 沉淀到知识库。

### 5. Git 演进检查

在追踪过程中，检查代码是否存在以下模式：

**触发条件**：
- 注释含「兼容」「旧版本」「迁移」「临时」「TODO」「FIXME」
- 特殊条件分支（疑似 feature flag）
- 硬编码的 URL、IP、端口
- 被注释掉的代码块

**发现时执行**：
```bash
git log --oneline -10 -- <file>
```

记录关键的历史变更信息。

### 6. 潜在问题发现

在追踪调用链过程中，**顺带**标记以下明显问题（看到就记，不额外发起全局扫描）：

**业务逻辑类**：
- 竞态条件：读-改-写操作无锁保护（库存扣减、余额变更等）
- 异常吞没：catch 块只打日志，未回滚已生效的前序操作
- 状态跳跃：setStatus() 前未校验当前状态合法性
- 金额精度：float/double 处理金额
- 越权访问：按业务 ID 查询未校验数据归属（缺少 userId 条件）
- 敏感信息泄露：日志中打印完整敏感对象、异常 message 直接返回前端

**运行时稳定性类**：
- 空指针异常（NPE）：分两层识别——代码模式级：自动拆箱、查询结果未判空、Map.get() 未判空、链式调用、Optional 误用；业务数据流级（需结合调用链+数据流分析）：状态依赖字段在未达到该状态时被访问、可选业务关系被假设必然存在、跨服务 DTO 部分字段未填充而下游直接访问、条件分支中仅部分路径赋值
- 不可变集合陷阱：Arrays.asList() 返回内部类不支持 add/remove、List.of()/Collections.singletonList() 不可变、subList() 视图在原 List 变更后崩溃

**性能类**：
- N+1 查询：循环内逐条调用 Mapper/Repository
- 循环远程调用：循环内调用 RPC/HTTP/MQ
- 大事务：@Transactional 方法内包含 RPC/HTTP 调用
- 无分页查询：findAll/selectAll 无 LIMIT
- 同步阻塞：主流程中同步执行发邮件/短信/日志等非核心操作

参考详细模式：`references/common-issues.md`

**记录格式**（仅发现，不自动沉淀）：

```markdown
| 问题类型 | 严重度 | 位置 | 描述 | 确定性 |
|----------|--------|------|------|--------|
| 业务/性能 | 高/中 | [文件:行号] | [描述] | ✓/⚠ |
```

**重要**：
- 只标记追踪路径上**直接看到**的明显问题，不做推测
- 确定性标注：✓ 代码明确存在该模式、⚠ 模式相似但需结合上下文判断
- 与「敏感操作清单」不重复：已列出的 DB/RPC 操作不再重复，只标记其中的问题模式

## 输出要求

**必须**输出到 `.claude/investigation/trace-report.md`

输出格式：

```markdown
---
stage: trace
timestamp: [当前时间，ISO 8601 格式]
depends_on:
  - scan-report.md
files_traced: [深度读取的文件数量]
---

# 追踪报告

## 追踪起点

基于扫描报告中的推荐入口：
- [入口1]: [文件路径:行号]
- [入口2]: [文件路径:行号]

## 调用链

### 主调用链（ASCII 树）

```
[入口方法]
├─→ [方法1] (文件:行号)
│   └─→ [方法1.1] (文件:行号)
├─→ [方法2] (文件:行号)
└─→ [方法3] (文件:行号)
    └─→ [外部服务调用]
```

### 服务交互时序（Mermaid 序列图）

**当涉及多服务交互时，使用序列图**：

```mermaid
sequenceDiagram
    participant C as Controller
    participant S as Service
    participant R as Repository
    participant E as ExternalService

    C->>S: method(params)
    S->>R: query/save
    R-->>S: result
    S->>E: call external
    E-->>S: response
    S-->>C: return
```

### 关键节点说明

| 节点 | 位置 | 职责 |
|------|------|------|
| [方法名] | [文件:行号] | [职责描述] |

## 数据流

### 核心数据对象

**[对象名]** 的生命周期：

```
[创建点] → [转换点] → [状态变更] → [持久化] → [返回]
```

### 状态流转（Mermaid 状态图）

**当涉及状态机时，使用状态图**：

```mermaid
stateDiagram-v2
    [*] --> STATE_A: 创建
    STATE_A --> STATE_B: 事件1
    STATE_A --> STATE_C: 事件2
    STATE_B --> STATE_D: 事件3
    STATE_C --> [*]
    STATE_D --> [*]
```

### 状态变更点

| 位置 | 变更内容 | 触发条件 |
|------|----------|----------|
| [文件:行号] | [状态A → 状态B] | [条件描述] |

## 敏感操作清单

### 数据库表操作

| 表名 | 操作类型 | 位置 | 敏感度 | 说明 |
|------|----------|------|--------|------|
| [表名] | SELECT/INSERT/UPDATE/DELETE | [文件:行号] | 高/中/低 | [说明] |

### 下游接口调用

| 服务 | 接口/方法 | 协议 | 位置 | 说明 |
|------|----------|------|------|------|
| [服务名] | [方法名] | HTTP/Thrift/gRPC/Dubbo/MQ | [文件:行号] | [说明] |

**识别的 RPC 模式**：
- `XxxHelper.XxxClient` 形式（Thrift 企业封装）
- `XxxService.Client` 形式（Thrift 标准）
- `@FeignClient` / `@DubboReference`

### 缓存操作

| 缓存类型 | 操作 | 位置 | Key 模式 |
|----------|------|------|----------|
| [Redis/本地] | [读/写/删] | [文件:行号] | [key 格式] |

## 业务规则发现

> **注意**：以下规则仅为代码中发现的潜在业务规则，**不会自动沉淀到知识库**。
> 如需沉淀，请用户调用 `/knowledge-manager` 确认添加。

| 规则描述 | 代码位置 | 识别依据 | 状态 |
|----------|----------|----------|------|
| [规则] | [文件:行号] | [注释/条件判断/常量/枚举] | 待用户确认 |

## 潜在问题发现

> **注意**：以下问题仅为追踪路径上直接观察到的明显模式，不做推测。
> 如无明显问题，此章节可标注「追踪路径上未发现明显问题」。

| 问题类型 | 严重度 | 位置 | 描述 | 确定性 |
|----------|--------|------|------|--------|
| 业务-[子类型] / 性能-[子类型] | 高/中 | [文件:行号] | [问题描述] | ✓ 已确认 / ⚠ 疑似 |

## 关键决策点

代码中的分支逻辑和判断条件：

| 位置 | 条件 | 分支说明 |
|------|------|----------|
| [文件:行号] | [if 条件] | [各分支的行为] |

## Git 演进发现

### 发现的历史痕迹

| 文件 | 发现 | 历史说明 |
|------|------|----------|
| [文件] | [注释/代码模式] | [git log 结果摘要] |

### 需要关注的历史变更

[如有重要的历史变更，详细描述]

## 追踪范围说明

### 已追踪路径
- [路径1描述]
- [路径2描述]

### 未追踪路径（及原因）
- [路径] — 原因：[如：异步处理、定时任务等需要单独追踪]

### 追踪深度
- 最大调用深度：[N] 层
- 是否到达边界：[是/否，如有说明原因]
```

## 输出方式

**文件为主**：将报告写入 `.claude/investigation/trace-report.md`

此文件供后续结论阶段读取，不直接展示给用户。

## 完成后的检查点消息

写入报告后，**必须**输出以下格式的检查点询问：

```
───────────────────────────────────────
✓ 阶段2完成：追踪报告已生成

报告位置：.claude/investigation/trace-report.md
追踪深度：[N] 层调用链
敏感操作：[M] 个数据库表，[K] 个下游接口
潜在问题：[P] 个（如有）

请选择：
1. 继续 → 执行阶段3（综合结论）
2. 查看报告 → 我先展示追踪报告内容
3. 补充追踪 → 告诉我需要深入追踪的路径
───────────────────────────────────────
```

**作用**：检查点询问，等待用户选择后再继续。

## 可视化要求

**强烈鼓励使用可视化图表**：

| 内容 | 推荐图表 |
|------|----------|
| 调用链 | ASCII 树 + Mermaid 序列图 |
| 状态流转 | Mermaid 状态图 |
| 数据流 | ASCII 箭头图 |
| 模块关系 | 包结构树 |

参考以下模板文档：
- 本 skill 目录下的 `references/rpc-patterns.md`
- codebase-investigate skill 目录下的 `references/output-templates.md`

**注意**：这些引用供你理解输出格式，不是运行时路径。

## 注意事项

1. **深度优先**：沿着调用链追踪到底，不要浅尝辄止
2. **记录所有分支**：即使是异常处理、边界条件也要记录
3. **标注不确定性**：如果某个调用链不确定，标注「待确认」
4. **保留原始代码引用**：关键代码片段要记录文件路径和行号
