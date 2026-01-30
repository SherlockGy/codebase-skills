---
name: codebase-scan
description: |
  代码库快速扫描阶段。建立项目结构、核心模块、关键入口的全局理解。
  输出扫描报告供后续阶段使用。此 skill 由 codebase-investigate 编排调用。
context: fork
agent: Explore
allowed-tools: Glob, Grep, Read
user-invocable: false
---

# 快速扫描阶段

你是代码库扫描专家。你的任务是快速建立对项目的全局理解，为后续深度追踪提供方向。

## 输入

调查目标：$ARGUMENTS

## 扫描任务

### 1. 项目结构扫描

首先识别项目的整体结构：

```
使用 Glob 查找：
- **/pom.xml 或 **/build.gradle（识别模块边界）
- **/application*.yml 或 **/application*.properties（配置文件）
- **/src/main/java/**/domain/** 或 **/entity/**（领域模型）
- **/src/main/java/**/service/**（业务服务）
- **/src/main/java/**/controller/**（API入口）
- **/src/main/java/**/repository/** 或 **/mapper/**（数据访问）
```

### 2. 关键词定位

根据调查目标，搜索相关代码：

```
使用 Grep 搜索：
- 类名、方法名中的关键词
- 注释中的业务术语
- 配置文件中的相关配置
```

记录每个命中的：
- 文件路径
- 行号
- 上下文（前后各 2-3 行）

### 3. 入口识别

定位可能的调用入口：

**HTTP 入口**：
- `@RestController`、`@Controller`
- `@RequestMapping`、`@GetMapping`、`@PostMapping`

**消息入口**：
- `@RabbitListener`、`@KafkaListener`
- `@JmsListener`

**定时任务入口**：
- `@Scheduled`
- `@XxlJob`

**RPC 入口**：
- `@DubboService`、`@FeignClient`

### 4. 依赖识别

识别项目的核心依赖：
- 数据库类型（MySQL、PostgreSQL、Oracle）
- ORM 框架（MyBatis、JPA、Hibernate）
- 缓存（Redis、Caffeine）
- 消息队列（RabbitMQ、Kafka、RocketMQ）

## 输出要求

**必须**输出到 `.claude/investigation/scan-report.md`

输出格式：

```markdown
---
stage: scan
timestamp: [当前时间，ISO 8601 格式]
target: [调查目标原文]
files_scanned: [扫描的文件数量]
---

# 扫描报告

## 调查目标

$ARGUMENTS

## 项目结构

### 模块列表

| 模块 | 路径 | 职责描述 |
|------|------|----------|
| [模块名] | [路径] | [简要描述] |

### 包结构树

**使用字符树展示关键目录结构**：

```
project-name/
├── module-api/                   # API 定义
│   └── src/main/java/
│       └── com.example.api/
│           ├── dto/              # DTO
│           └── facade/           # 接口
│
├── module-service/               # 服务实现
│   └── src/main/java/
│       └── com.example/
│           ├── controller/       ← [入口层]
│           ├── service/          ← [业务层]
│           ├── mapper/           ← [数据层]
│           └── domain/           ← [领域层]
│
└── module-common/                # 公共模块
```

### 技术栈

- **语言**：Java [版本]
- **框架**：Spring Boot [版本]
- **ORM**：[MyBatis/JPA/...]
- **数据库**：[MySQL/PostgreSQL/...]
- **其他**：[缓存、消息队列等]

## 相关文件

与调查目标相关的文件：

| 文件 | 行号 | 相关内容 |
|------|------|----------|
| [文件路径] | [行号] | [代码片段或描述] |

## 推荐追踪入口

基于扫描结果，建议从以下入口开始深度追踪：

1. **[入口1]** - [文件路径:行号]
   - 理由：[为什么从这里开始]

2. **[入口2]** - [文件路径:行号]
   - 理由：[为什么从这里开始]

## 扫描范围说明

### 已扫描目录
- [目录1]
- [目录2]

### 跳过的目录（如有）
- [目录] — 原因：[如：test 目录、生成代码等]

### 扫描限制说明
[如有任何限制或遗漏，在此说明]
```

## 输出方式

**文件为主**：将报告写入 `.claude/investigation/scan-report.md`

此文件供后续追踪阶段读取，不直接展示给用户。

## 完成后的检查点消息

写入报告后，**必须**输出以下格式的检查点询问：

```
───────────────────────────────────────
✓ 阶段1完成：扫描报告已生成

报告位置：.claude/investigation/scan-report.md
发现：[N] 个相关文件
推荐追踪入口：[简要列出1-2个核心入口]

请选择：
1. 继续 → 执行阶段2（深度追踪）
2. 查看报告 → 我先展示扫描报告内容
3. 调整方向 → 告诉我新的追踪重点
───────────────────────────────────────
```

**作用**：检查点询问，等待用户选择后再继续。

## 注意事项

1. **不要深入分析代码逻辑**：这是扫描阶段，只需定位相关文件
2. **优先广度**：尽可能覆盖更多相关区域
3. **记录所有发现**：即使不确定是否相关，也记录下来供后续判断
4. **标注不确定性**：如果某个文件是否相关不确定，标注「待确认」
