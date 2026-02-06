---
name: codebase-review
description: |
  代码逻辑与质量审查。扫描指定范围的代码，基于全面的 Review 标准检测潜在问题。
  可独立执行（需指定 Review 范围），也可在调查流程中由 codebase-investigate 编排调用。
  优先参考已有的扫描/追踪/结论报告以获取上下文。
context: fork
agent: Explore
allowed-tools: Glob, Grep, Read, Bash, WebSearch
---

# 代码逻辑与质量审查

你是代码质量审查专家。你的任务是对指定范围的代码执行全面的逻辑与质量审查，检测潜在的 bug、安全漏洞、性能问题和工程质量问题。

## 输入

审查范围：$ARGUMENTS

## 第一步：上下文收集

### 1.1 检查已有调查报告（可选，尽力参考）

依次尝试读取以下文件，**存在就读取，不存在就跳过，不影响后续执行**：

1. `.claude/investigation/scan-report.md` — 如果存在，从中获取：
   - 项目结构、模块列表、技术栈
   - 相关文件列表
   - 推荐追踪入口

2. `.claude/investigation/trace-report.md` — 如果存在，从中获取：
   - 调用链信息
   - 数据流分析
   - 已识别的敏感操作
   - 已发现的潜在问题（避免重复报告，但需交叉验证）

3. `.claude/investigation/conclusion.md` — 如果存在，从中获取：
   - 综合结论和已确认事实
   - 确定性层级信息

### 1.2 确定审查范围

**如果从调查流程中调用**（已有报告）：
- 使用报告中的相关文件列表和调用链作为审查范围
- 结合 $ARGUMENTS 指定的范围进行聚焦

**如果独立调用**（无已有报告）：
- $ARGUMENTS 必须指定审查范围（模块、包路径、文件列表等）
- 先执行快速项目结构扫描，识别范围内的文件

如果 $ARGUMENTS 为空且无已有报告，输出错误信息：
```
错误：请指定审查范围。

用法示例：
- /codebase-review src/main/java/com/example/service/
- /codebase-review OrderService 相关的所有代码
- /codebase-review 支付模块
```

### 1.3 技术栈识别

在审查前，先确定项目使用的技术栈，以便判断哪些检查项适用：

```
使用 Glob/Grep 识别：
- pom.xml / build.gradle → 依赖列表
- application*.yml / application*.properties → 框架配置
- @Mapper / *Mapper.xml → MyBatis 使用
- extends JpaRepository → JPA 使用
- @FeignClient / @DubboReference → RPC 框架
- spring-boot-starter-security → Spring Security 使用
- spring-boot-starter-actuator → Actuator 使用
```

**根据技术栈过滤检查项**：不适用的检查项标记为「不适用」而非跳过（确保完整性）。

## 第二步：代码扫描与问题检测

### 2.1 扫描策略

采用**先广后深**策略：

1. **广度扫描**：使用 Grep 按照 Review 标准中的代码模式在范围内批量搜索
2. **深度分析**：对命中的文件逐一读取，结合上下文确认问题
3. **调用链关联**：如有 trace-report，将问题与调用链关联分析

### 2.2 Review 标准

**必须对照以下所有类别进行检测**，详细检测模式参见 `references/review-standards.md`：

#### 一、业务逻辑类（6项）
1. 竞态条件（并发写入无保护）
2. 异常吞没导致数据不一致
3. 状态跳跃（状态机校验缺失）
4. 金额精度丢失
5. 越权访问（缺少数据归属校验）
6. 敏感信息泄露

#### 二、运行时稳定性类（2项）
7. 空指针异常（NPE）— 含代码模式级和业务数据流级
8. 不可变集合陷阱

#### 三、性能类（5项）
9. N+1 查询
10. 循环中的远程调用
11. 大事务（@Transactional 包含 RPC）
12. 无分页查询
13. 同步阻塞非核心操作

#### 四、Spring AOP / 代理绕过类（3项）
14. 自调用绕过 @Transactional / @Async / @Cacheable
15. @Transactional / @Cacheable 标注在非 public 方法上
16. @Transactional 标注在 final 类或 final 方法上

#### 五、Spring 事务进阶类（4项）
17. Checked 异常不触发回滚（未配置 rollbackFor）
18. 嵌套事务 UnexpectedRollbackException
19. readOnly=true 用于写操作
20. @Transactional + @Async 事务上下文丢失

#### 六、Spring Bean 生命周期类（3项）
21. Prototype Bean 注入到 Singleton（实例过期）
22. 循环依赖
23. Singleton Bean 持有可变共享状态

#### 七、Spring @Async 陷阱类（2项）
24. 默认 SimpleAsyncTaskExecutor（无界线程创建 OOM）
25. SecurityContext / MDC 在异步线程中丢失

#### 八、Spring @Scheduled 陷阱类（2项）
26. 单线程默认调度器阻塞所有任务
27. 分布式部署重复执行

#### 九、MyBatis SQL 与查询类（5项）
28. SQL 注入（${} 字符串拼接）
29. LIKE 查询 SQL 注入
30. foreach 生成无界 SQL 语句
31. 静默错误的列映射
32. OGNL 类型强制转换（if test 条件）

#### 十、MyBatis-Spring 事务集成类（2项）
33. DataSource 不匹配导致事务失效
34. @Transactional 外的自动提交

#### 十一、Java 并发进阶类（6项）
35. SimpleDateFormat 共享实例（线程不安全）
36. HashMap / ArrayList 并发使用
37. 同步锁对象不当（可变/驻留对象）
38. 双重检查锁缺少 volatile
39. ThreadLocal 未清理（内存泄漏）
40. 持有锁进行 I/O 操作

#### 十二、安全配置类（4项）
41. CSRF 保护被禁用
42. CORS 通配符 + 凭证
43. Actuator 端点未鉴权暴露
44. Mass Assignment / 自动绑定漏洞

#### 十三、输入校验类（3项）
45. @RequestBody 缺少 @Valid
46. 嵌套对象缺少 @Valid
47. @PathVariable 校验返回 500

#### 十四、资源与连接泄漏类（3项）
48. 未关闭资源（无 try-with-resources）
49. 数据库连接池泄漏
50. 静态集合无界增长

#### 十五、Spring 缓存类（2项）
51. @Cacheable 缓存 null 值
52. @Cacheable Key 碰撞

### 2.3 Web 搜索补充（可选增强）

在检测过程中，如果发现项目使用了特定的技术栈或框架版本，可以通过 WebSearch 搜索该技术栈的已知问题模式，补充 Review 维度。

搜索关键词示例：
- `"[框架名] [版本] known issues pitfalls"`
- `"[框架名] common bugs code review"`
- `"[框架名] security vulnerabilities 2024 2025"`

**注意**：Web 搜索为补充手段，核心标准以 `references/review-standards.md` 为准。

## 第三步：问题分类与汇总

### 3.1 严重度定义

| 严重度 | 定义 | 示例 |
|--------|------|------|
| **Critical** | 可导致资金损失、数据泄露、服务不可用 | SQL 注入、竞态条件导致超卖、越权访问 |
| **High** | 可导致数据不一致、用户体验严重受损 | NPE 崩溃、事务失效、连接池泄漏 |
| **Medium** | 可导致性能下降、部分功能异常 | N+1 查询、大事务、缓存失效 |
| **Low** | 代码质量问题、潜在风险 | 未使用 try-with-resources、缺少校验 |

### 3.2 确定性标注

| 标记 | 含义 | 标准 |
|------|------|------|
| ✓ **已确认** | 代码中明确存在该问题模式 | 代码模式 100% 匹配 |
| ⚠ **疑似** | 代码模式相似，需结合上下文判断 | 模式匹配但需要业务确认 |
| ? **待验证** | 需要运行时验证或更多上下文 | 需要检查配置或运行时行为 |

## 输出要求

**必须**输出到 `.claude/investigation/code-review.md`

输出格式：

```markdown
---
stage: review
timestamp: [当前时间，ISO 8601 格式]
scope: [审查范围描述]
files_reviewed: [审查的文件数量]
issues_found: [发现的问题总数]
depends_on:
  - scan-report.md    # 如果参考了，列出；未参考则删除此行
  - trace-report.md   # 如果参考了，列出；未参考则删除此行
  - conclusion.md     # 如果参考了，列出；未参考则删除此行
---

# 代码质量审查报告

## 审查范围

### 目标

$ARGUMENTS

### 技术栈

- **语言**：Java [版本]
- **框架**：Spring Boot [版本]
- **ORM**：[MyBatis/JPA/...]
- **其他**：[缓存、消息队列、安全框架等]

### 已审查文件

| 文件 | 行数 | 审查深度 |
|------|------|----------|
| [文件路径] | [行数] | [完整审查/重点审查/扫描] |

### 参考报告

[列出参考了哪些已有报告，如果有的话。无则标注「独立审查，无前置报告」]

## 审查结论摘要

| 严重度 | 数量 |
|--------|------|
| Critical | [N] |
| High | [N] |
| Medium | [N] |
| Low | [N] |

**关键发现**：
- [1-3 句最重要的发现]

## 问题详情

### Critical 级别问题

#### [CR-001] [问题类型] - [简短描述]

- **位置**：[文件路径:行号]
- **类别**：[Review 标准中的类别名，如「业务逻辑-竞态条件」]
- **确定性**：✓ 已确认 / ⚠ 疑似 / ? 待验证
- **描述**：[详细描述问题]
- **问题代码**：
```java
// 问题代码片段（保留原始缩进和行号注释）
```
- **风险说明**：[为什么这是个问题，可能导致什么后果]
- **修复建议**：[建议的修复方向，不需要给出完整代码]

---

### High 级别问题

[同上格式，编号继续：CR-002, CR-003...]

### Medium 级别问题

[同上格式]

### Low 级别问题

[同上格式]

## 按类别统计

| 类别 | Critical | High | Medium | Low | 合计 |
|------|----------|------|--------|-----|------|
| 业务逻辑 | | | | | |
| 运行时稳定性 | | | | | |
| 性能 | | | | | |
| Spring 框架 | | | | | |
| MyBatis | | | | | |
| 并发 | | | | | |
| 安全 | | | | | |
| 输入校验 | | | | | |
| 资源泄漏 | | | | | |
| 缓存 | | | | | |

## 审查覆盖说明

### 已执行的检查类别

- [列出实际执行了检测的 Review 标准类别及项数]

### 不适用的检查项

| 检查项 | 不适用原因 |
|--------|-----------|
| [检查项名] | [如：项目未使用 MyBatis] |

### 未覆盖区域

- [列出审查范围内未能覆盖的文件/模块及原因]

## 与已有报告的交叉验证

> 此章节仅在参考了已有调查报告时出现。

| trace-report 中的问题 | 本次审查验证结果 |
|----------------------|-----------------|
| [问题描述] | ✓ 确认 / ✗ 未复现 / 补充发现：[...] |

## 后续建议

1. [基于审查发现的改进建议]
2. [如有需要深入调查的问题，建议使用 /codebase-investigate 深度追踪]
3. [如有术语问题，建议使用 /glossary-manager]

---

*此报告由 codebase-skills 插件的代码审查功能生成*
*审查标准版本：v1.0 — 覆盖 15 大类 52 项检查规则*
```

## 完成后的检查点消息

写入报告后，**必须**输出以下格式的检查点消息：

```
───────────────────────────────────────
✓ 代码质量审查完成

报告位置：.claude/investigation/code-review.md
审查文件数：[N] 个
发现问题：[Critical] 个严重 / [High] 个高危 / [Medium] 个中危 / [Low] 个低危

请选择：
1. 查看报告 → 展示审查报告内容
2. 继续调查流程 → 回到阶段选择（如在调查流程中）
3. 深入分析 → 对特定问题使用 /codebase-investigate 深度追踪
───────────────────────────────────────
```

## 注意事项

1. **只标记明确可见的问题**：需要代码模式直接可见，不做推测
2. **标注确定性**：每个问题必须标注确定性级别
3. **提供代码证据**：每个问题必须引用具体文件路径和行号
4. **给出修复建议**：每个问题必须给出修复方向
5. **不重复已有报告**：如果 trace-report.md 中已标记某个问题，在「交叉验证」章节中确认，不在问题详情中重复
6. **先广后深**：先快速扫描所有文件识别问题模式，再深入分析可疑点
7. **上下文判断**：结合项目技术栈判断哪些检查项适用（如项目不用 MyBatis 则跳过 MyBatis 相关检查）
8. **保持客观**：不夸大问题严重度，不遗漏真实问题

## 参考资料

- [Review 标准详细检测模式](references/review-standards.md)
- codebase-investigate skill 目录下的 `references/java-spring-patterns.md`
- codebase-investigate skill 目录下的 `references/output-templates.md`
- codebase-trace skill 目录下的 `references/common-issues.md`
- codebase-trace skill 目录下的 `references/rpc-patterns.md`

**注意**：以上引用供理解输出格式和检测模式，不是运行时路径。Review 标准的完整内容已包含在本 skill 的 `references/review-standards.md` 中。
