# 业务流程深度分析方法论

本文档定义了**业务流程级 bug** 的系统分析方法。这类 bug 无法通过代码模式匹配发现，必须通过**跨方法、跨服务的推理链**识别。

---

## 为什么需要这个分析

| 层次 | 发现方式 | 举例 | 当前覆盖 |
|------|----------|------|----------|
| **代码模式级** | Grep 匹配 pattern | float 处理金额、catch 吞异常 | ✓ 52 项规则 |
| **业务流程级** | 跨方法推理链 | 库存扣了但支付失败未回补 | **本文档** |

**代码模式级**：每行代码单独看都是对的，但组合起来有问题。
**业务流程级**：需要理解多个步骤的交互、失败的级联效应、并发的冲突。

---

## 分析总纲：故障注入思维

核心思维模式：**在业务流程的每一个步骤，系统性地假设故障发生，推理后果**。

```
对于流程中的每一步 Step[i]：
  1. 如果 Step[i] 执行成功后 Step[i+1] 失败 → 系统处于什么状态？该状态是否一致？
  2. 如果 Step[i] 超时（成功与否未知）→ 重试是否安全？
  3. 如果 Step[i] 被并发执行 → 结果是否确定？
  4. 如果 Step[i] 的输入数据为边界值 → 行为是否正确？
```

---

## 分析步骤

### 步骤 B1：业务流程重建

**目标**：从代码中提取完整的业务流程图。

**方法**：

1. **从已有报告获取**（优先）：
   - trace-report.md 的调用链 → 直接作为流程骨架
   - scan-report.md 的入口列表 → 识别流程起点

2. **从代码获取**（无报告时）：
   - 找到所有 Controller 端点 / MQ Listener / Scheduled Job
   - 追踪每个入口的完整调用链
   - 识别链中的所有**副作用操作**

**对于每个业务流程，必须填写以下模板**：

```
流程名称：[如：创建订单]
触发入口：[Controller.method / @RabbitListener / @Scheduled]
执行步骤：
  Step 1: [操作描述] → 副作用：[DB写入/RPC/消息/缓存]
  Step 2: [操作描述] → 副作用：[DB写入/RPC/消息/缓存]
  Step 3: [操作描述] → 副作用：[DB写入/RPC/消息/缓存]
涉及实体状态变更：[Order: CREATED → PAID]
共享资源：[inventory 表, account 表, Redis 库存缓存]
事务边界：[@Transactional 覆盖 Step 1-2, Step 3 在事务外]
数据对象流动：
  入口数据：[OrderDTO(userId✓, items✓, addressId✓)]
  Step 1 产出：[Order(id✓, status=CREATED, paymentInfo=null)]
  Step 2 查询：[User → defaultAddress 可能为 null]
  Step 3 转换：[Order → OrderVO(shippingInfo 仅实物商品有值)]
  最终返回：[OrderVO]
```

**关键识别方法**：

识别副作用操作（每一步的"不可逆动作"）：
- **数据库写入**：`mapper.insert/update/delete`、`repository.save/delete`
- **外部调用**：`xxxClient.xxx()`、`RestTemplate.xxx()`、`xxxTemplate.send()`
- **状态变更**：`setStatus()`、`setState()`
- **资源操作**：`lock()`、`acquire()`、缓存写入
- **通知发送**：邮件、短信、推送、Webhook

识别数据对象的**字段填充条件**（每一步对数据对象做了什么）：
- **创建/构造**：`new Entity()`、Builder 模式 → 哪些字段被 set？哪些保持 null？
- **查询填充**：`selectById()` / `getByXxx()` → 结果可能为 null？哪些字段可能为 null？
- **条件赋值**：`if (type == X) { dto.setField(...) }` → 其他分支该字段为 null
- **转换/映射**：DTO → Entity → VO → 哪些字段在转换中丢失？
- **集合操作**：`filter()` / `map()` / `findFirst()` → 可能产出空集/null？
- **跨服务返回**：RPC 返回的 DTO 哪些字段可能未填充？（性能优化/接口版本差异）

---

### 步骤 B2：单流程故障分析

**目标**：对每个流程的每一步，系统性地进行故障注入推理。

**方法**：对流程中的每一步，逐一假设该步骤失败，分析后果。

#### B2.1 逐步故障注入

对于流程 `Step 1 → Step 2 → Step 3`，分析：

```
场景 A：Step 1 成功，Step 2 失败
  ├── Step 1 的副作用是否已提交？（在事务内还是外？）
  ├── 如果已提交，是否有补偿/回滚机制？
  ├── 系统数据此时是否一致？
  └── 用户看到什么？能否重试？

场景 B：Step 1 成功，Step 2 成功，Step 3 失败
  ├── Step 1+2 的副作用是否已提交？
  ├── 如果已提交，是否有补偿？
  └── 部分成功的状态下，其他流程读取数据是否有问题？

场景 C：Step 2 超时（不确定是否成功）
  ├── 调用方如何处理超时？
  ├── 如果重试，Step 2 是否幂等？
  └── 如果不重试，系统处于什么状态？
```

#### B2.2 重点检查项

**不完整的补偿操作**：
```java
// 典型危险模式
@Transactional
public void createOrder(OrderRequest req) {
    Order order = orderMapper.insert(buildOrder(req));     // DB 写入（事务内）
    inventoryClient.deduct(req.getSkuId(), req.getQty());  // RPC（事务外！）
    // 如果 RPC 失败，事务回滚了 order，但如果 RPC 成功后下面的步骤失败呢？
    // 如果 RPC 超时，实际成功了，但事务回滚了，库存被扣但订单不存在
}
```
检查要点：
- 事务边界是否覆盖了所有需要原子性的操作
- 事务外的副作用（RPC/MQ）失败时，事务内的操作是否需要回滚
- 事务回滚时，事务外已执行的操作是否有补偿

**缺失的幂等保护**：
```java
// 支付回调 — 可能被多次调用
@PostMapping("/payment/callback")
public void onPaymentSuccess(PaymentResult result) {
    Order order = orderMapper.selectById(result.getOrderId());
    order.setStatus(PAID);           // 重复回调会重复设置
    orderMapper.update(order);
    pointsService.addPoints(userId, 100);  // 重复回调会重复发积分！
}
```
检查要点：
- 回调/Webhook 处理是否有幂等检查（检查当前状态/使用唯一键）
- 消息消费是否有去重机制
- 定时任务重复触发时是否安全

**异步操作的数据一致性**：
```java
@Transactional
public void createOrder(OrderRequest req) {
    orderMapper.insert(order);
    // 消息在事务提交前就发了！
    // 消费者可能在事务提交前就消费到消息，查不到 order
    rabbitTemplate.convertAndSend("order.created", order.getId());
}
```
检查要点：
- 消息/事件是否在事务提交后发送（`@TransactionalEventListener` vs `@EventListener`）
- 消费者处理时，前置数据是否已持久化
- 异步操作失败时，主流程数据是否需要补偿

---

### 步骤 B3：跨流程冲突分析

**目标**：找到共享状态的流程对，分析并发冲突。

**方法**：

1. **识别共享状态**：从 B1 的流程清单中，找到操作同一实体/表的不同流程
2. **分析最坏交叉**：两个流程同时执行时，操作的交叉顺序是否导致不一致

#### B3.1 构建共享状态矩阵

```
             | 订单表 | 库存表 | 账户表 | 积分表 |
创建订单      |  写    |  写    |        |        |
取消订单      |  写    |  写    |        |        |
支付回调      |  写    |        |  写    |  写    |
退款          |  写    |  写    |  写    |  写    |
定时超时取消  |  写    |  写    |        |        |
```

矩阵中**同一列有多个"写"**的流程对，就是潜在冲突点。

#### B3.2 逐对分析

对每一对冲突流程，分析：

```
冲突对：[取消订单] vs [支付回调]
共享状态：订单表（status 字段）
冲突场景：
  时刻 T1: 用户点击取消，读取 order.status == CREATED
  时刻 T2: 支付回调到达，读取 order.status == CREATED
  时刻 T3: 取消流程设置 status = CANCELLED
  时刻 T4: 支付回调设置 status = PAID  ← 覆盖了取消！
后果：用户以为取消了，但订单变成 PAID，钱被扣但用户不知道
保护检查：是否有乐观锁/状态机校验/分布式锁？
```

#### B3.3 典型冲突模式

| 冲突模式 | 流程对示例 | 后果 |
|----------|-----------|------|
| **状态竞争覆盖** | 取消 vs 支付回调 | 后执行的覆盖先执行的 |
| **重复资源释放** | 退款 vs 超时取消 | 库存回补两次 |
| **幻读导致重复创建** | 并发创建同一业务实体 | 唯一约束冲突或数据重复 |
| **先读后写的 TOCTOU** | 库存检查 vs 库存扣减 | 超卖 |
| **定时任务 vs 用户操作** | 超时取消 vs 用户付款 | 已付款的订单被取消 |

---

### 步骤 B4：异步与分布式分析

**目标**：分析消息驱动和分布式场景的一致性风险。

#### B4.1 消息时序分析

```
检查所有 MQ 发送和消费点：
  发送方：在什么上下文发送？事务内还是外？
  消费方：处理时依赖什么前置数据？
  时序风险：消费者是否可能在前置数据就绪前收到消息？
```

**常见时序问题**：

| 问题 | 代码特征 | 后果 |
|------|----------|------|
| 事务未提交就发消息 | `@Transactional` 内 `template.send()` | 消费者查不到数据 |
| 消息乱序 | 多个消息依赖处理顺序 | 状态跳跃 |
| 消息重复消费 | 无消费幂等设计 | 数据重复 |
| 消息丢失无补偿 | 无重试、无定时对账 | 数据不一致长期存在 |

#### B4.2 分布式事务分析

```
对于涉及多个服务的操作：
  本地 DB + 远程 RPC：是否有 Saga / TCC / 最终一致性保证？
  本地 DB + MQ 发送：是否使用事务性消息 / Outbox 模式？
  多个 RPC 调用：失败时已成功的调用是否有补偿？
```

---

### 步骤 B5：状态机完整性分析

**目标**：验证实体状态流转的完整性和安全性。

**方法**：

1. **提取状态定义**：从枚举类中提取所有状态值
2. **提取状态转换**：从代码中找到所有 `setStatus()` 调用
3. **构建状态转换矩阵**：标注每个转换的触发条件和保护机制
4. **验证完整性**：

```
对于状态枚举中的每一对 (源状态, 目标状态)：
  如果代码中存在这个转换 → 检查：前置校验是否充分？
  如果代码中不存在这个转换 → 检查：是否应该存在？是否遗漏了？

对于每个状态：
  是否有"进入"此状态的路径？（无 → 死状态）
  是否有"离开"此状态的路径？（无 → 终态，是否合理？）
  是否有流程把实体留在此状态永不处理？（悬挂状态）
```

**状态转换矩阵模板**：

```
当前状态 ╲ 操作    | 支付   | 取消   | 发货  | 退款   | 超时取消
─────────────────┼────────┼────────┼───────┼────────┼─────────
CREATED           | → PAID | → CANCELLED |  ✗   |   ✗   | → CANCELLED
PAID              |   ✗    |   ✗    | → SHIPPED | → REFUNDING |   ✗
SHIPPED           |   ✗    |   ✗    |   ✗   | → REFUNDING |   ✗
REFUNDING         |   ✗    |   ✗    |   ✗   | → REFUNDED |   ✗
CANCELLED         |   ✗    |   ✗    |   ✗   |   ✗   |   ✗
COMPLETED         |   ✗    |   ✗    |   ✗   | → REFUNDING |   ✗

检查每个 ✗：代码中是否真的阻止了这个转换？
检查每个 →：代码中转换前是否校验了当前状态？
```

---

### 步骤 B6：边界条件与时间维度分析

**目标**：找到特定数据值或时间窗口才触发的 bug。

#### B6.1 数据边界分析

```
对于每个业务操作的输入参数：
  金额 = 0 时行为是否正确？
  数量 = 0 / 负数时行为是否正确？
  列表为空时行为是否正确？
  字符串为空/超长/含特殊字符时行为是否正确？
  ID 不存在时行为是否正确？
  关联对象不存在时行为是否正确？
```

#### B6.2 时间维度分析

```
长时间运行的流程：
  如果 Token/Session 在流程中途过期？
  如果缓存在流程中途过期？
  如果分布式锁在流程中途过期（但操作尚未完成）？

定时任务与在线流程的交叉：
  如果定时超时取消任务在用户正在支付时触发？
  如果定时对账任务在批量处理中途遇到正在变更的数据？

跨日/跨月边界：
  如果操作发生在 23:59:59 和 00:00:01 之间？
  如果账期切换时正在处理交易？
```

---

### 步骤 B7：数据流空值传播分析

**目标**：追踪数据对象在业务流程中的完整生命周期，找出因流程交互、条件分支、数据过滤、跨服务传递导致的 NPE 风险。

> 这类 NPE **无法从单个代码片段发现**。`user.getAddress().getCity()` 这行代码本身无法判断是否安全——必须追踪 `user` 对象从何而来、`address` 字段在什么条件下被填充、当前业务场景是否满足该条件。

#### B7.1 数据对象生命周期追踪

**对流程中的每个关键数据对象，建立字段状态表**：

```
对象：Order
生命周期追踪：

| 阶段 | 操作 | 字段变化 | 条件 |
|------|------|----------|------|
| 创建 | new Order() | id=null, status=null, paymentInfo=null, shippingInfo=null | 无条件 |
| 填充 | buildOrder(dto) | id=生成, userId=✓, status=CREATED, items=✓ | 无条件 |
| 条件填充 | if(实物) setShipping() | shippingInfo=✓ 仅实物商品 | type==PHYSICAL |
| 持久化 | mapper.insert() | 同上 | |
| 支付回调 | setPaymentInfo() | paymentInfo=✓ | 支付成功后 |
| 退款引用 | refund(orderId) | 访问 paymentInfo.transactionId | **假设已支付** |

→ 风险：如果退款接口被调用时订单尚未支付（status=CREATED），paymentInfo 为 null → NPE
→ 风险：虚拟商品订单的 shippingInfo 为 null，如果统一的订单详情接口访问 shippingInfo.trackingNo → NPE
```

#### B7.2 五种数据流 NPE 模式

**模式 1：状态依赖字段**
```
字段 X 仅在状态 S 之后才被填充
下游方法在未校验状态的情况下访问字段 X
```
分析方法：
1. 在 B7.1 的字段状态表中找到「条件填充」的字段
2. 追踪所有访问该字段的下游方法
3. 检查下游方法是否校验了对应状态/条件

典型场景：
- `order.getPaymentInfo()` — 仅支付后有值，退款流程是否校验了已支付状态？
- `order.getShippingInfo()` — 仅实物商品有值，通用的订单导出是否区分了商品类型？
- `user.getVipInfo()` — 仅 VIP 用户有值，权益计算是否判空？

**模式 2：集合操作缩减为空**
```
Step A: 查询得到列表 List<X>
Step B: 过滤/筛选 → 可能为空列表
Step C: 取第一个元素 / 聚合操作 → NPE 或异常
```
分析方法：
1. 追踪所有 `stream().filter().findFirst()` / `get(0)` / `iterator().next()` 调用
2. 向上追溯数据来源——过滤条件是否可能排除所有元素？
3. 检查是否有 `.orElse()` / `.orElseThrow()` / 空集检查

典型场景：
```java
// 查询用户所有地址，筛选默认地址
List<Address> addresses = addressMapper.selectByUserId(userId);
Address defaultAddr = addresses.stream()
    .filter(Address::isDefault)
    .findFirst()
    .get();  // 如果用户没有设置默认地址 → NoSuchElementException
// 更隐蔽：
String city = addresses.stream()
    .filter(Address::isDefault)
    .findFirst()
    .map(Address::getCity)      // 到这里还安全
    .orElse(null);              // 返回 null
// ... 若干方法调用后 ...
shippingService.ship(city.trim());  // 远离数据源的 NPE
```

**模式 3：跨服务 DTO 字段缺失**
```
上游服务为了性能/接口版本差异，返回的 DTO 部分字段为 null
下游服务不知道哪些字段可能为空，直接访问嵌套字段
```
分析方法：
1. 识别所有跨服务调用（RPC/HTTP）及其返回类型
2. 检查上游服务的实现——是否所有字段都被填充？有没有"精简版"查询？
3. 检查下游代码——是否对返回值的嵌套字段做了判空？

典型场景：
```java
// 上游 UserService 的批量查询为了性能不填充详情
UserDTO user = userClient.getBasicInfo(userId);
// user.getDepartment() == null（批量查询不查部门）
String deptName = user.getDepartment().getName();  // NPE

// 更隐蔽：上游某个版本开始不再填充某字段，下游代码无感知
```

**模式 4：多步转换字段丢失**
```
对象 A 转换为 B，B 转换为 C
A 的某个字段在 A→B 时没有映射到 B
下游通过 C 间接访问该字段 → null
```
分析方法：
1. 追踪 DTO/Entity/VO 之间的转换代码（BeanUtils.copyProperties、手动 set、MapStruct 等）
2. 对比源对象和目标对象的字段——是否有字段在转换中被遗漏？
3. 特别关注 `BeanUtils.copyProperties` —— 字段名不完全匹配时静默跳过

典型场景：
```java
// OrderDTO → Order 转换时遗漏了 couponInfo 字段
Order order = new Order();
order.setUserId(dto.getUserId());
order.setItems(convertItems(dto.getItems()));
// 忘记 order.setCouponInfo(dto.getCouponInfo())

// 后续结算时
BigDecimal discount = order.getCouponInfo().getDiscountAmount();  // NPE
```

**模式 5：Map 构建与查找不对称**
```
Step A: 查询列表，转为 Map<Key, Value>
Step B: 用另一个来源的 Key 去查 Map → Key 不存在 → null
Step C: 对 null 结果调用方法 → NPE
```
分析方法：
1. 找到所有 `stream().collect(Collectors.toMap(...))` 或循环构建 Map 的代码
2. 找到所有 `map.get(key)` 的使用处
3. 检查 key 的来源——是否保证一定在 Map 中存在？

典型场景：
```java
// 查询有库存的商品，构建 Map
List<Product> products = productMapper.selectInStock();
Map<Long, Product> productMap = products.stream()
    .collect(Collectors.toMap(Product::getId, p -> p));

// 用订单中的商品ID查 Map —— 但下单后商品可能已下架/缺货
for (OrderItem item : orderItems) {
    Product product = productMap.get(item.getProductId());
    String name = product.getName();  // 商品已下架，不在 Map 中 → NPE
}
```

#### B7.3 分析执行方法

**从流程模型出发**（结合 B1 的流程重建）：

```
对于每个业务流程：
  1. 列出流程中所有数据对象（入参 DTO、查询结果 Entity、中间变量、返回 VO）
  2. 对每个数据对象，追踪其字段在流程各步骤中的填充状态
  3. 标注「条件性非空」字段——仅在特定条件下被填充
  4. 追踪每个字段被下游访问的位置
  5. 交叉验证：「条件性非空」字段被访问时，是否有对应的条件/判空保护？

特别关注以下「危险传递模式」：
  - 方法 A 返回可能为 null 的结果 → 方法 B 接收后不判空直接传给方法 C → 方法 C 调用其方法 → NPE
    （NPE 发生在 C，根因在 A，排查困难）
  - 集合经过多次 filter/map → 最终可能为空 → 调用 .get(0) 或 .findFirst().get()
  - 跨方法的 Optional 拆包：方法 A 返回 Optional → 方法 B 调用 .get() 不检查
```

**从数据查询出发**（反向追踪）：

```
对于每个数据库查询 / RPC 调用：
  1. 返回值可能为 null？（selectById 查不到、findFirst 无结果）
  2. 返回的对象中哪些字段可能为 null？（LEFT JOIN、可选关联、partial DTO）
  3. 返回的集合可能为空？（带条件的查询、filter 后的结果）
  4. 向下追踪：这些可能为 null 的值被传递到哪里？最终在哪里被解引用？
```

#### B7.4 输出格式

数据流 NPE 使用独立编号 `NF-xxx`（Null Flow）：

```markdown
#### [NF-001] [NPE 模式] - [简短描述]

- **数据对象**：[Order / UserDTO / ...]
- **空值字段**：[paymentInfo / defaultAddress / ...]
- **NPE 模式**：状态依赖字段 / 集合缩减为空 / 跨服务字段缺失 / 转换丢失 / Map 查找不对称
- **严重度**：Critical / High / Medium
- **确定性**：✓ 已确认 / ⚠ 疑似 / ? 待验证

**空值传播链**：
```
[数据源] → [字段填充条件] → [传递路径] → [解引用点(NPE)]

具体：
Step 1: Order 创建 → paymentInfo = null（状态 CREATED，支付前无值）
Step 2: 订单入库 → paymentInfo 仍为 null
Step 3: RefundService.refund(orderId) → 查询 Order
Step 4: order.getPaymentInfo().getTransactionId()  ← NPE（未校验 status >= PAID）

触发条件：退款接口被调用时订单状态为 CREATED（未支付）
```

**现有保护**：[是否有判空/状态校验，位置]
**修复方向**：[建议]
```

---

## 输出格式

业务流程分析的发现使用独立的格式，与代码模式级问题区分：

```markdown
## 业务流程风险分析

### 已识别的业务流程

| 流程 | 入口 | 步骤数 | 副作用数 | 事务覆盖 |
|------|------|--------|----------|----------|
| [名称] | [入口] | [N] | [M] | [完整/部分/无] |

### 流程级风险发现

#### [BF-001] [风险类型] - [简短描述]

- **涉及流程**：[流程名称]
- **风险类型**：[补偿缺失/幂等缺失/并发冲突/状态不一致/消息时序/分布式事务]
- **确定性**：✓ 已确认 / ⚠ 疑似 / ? 待验证

**故障场景推演**：
```
Step 1: [操作] → 结果：成功 → 副作用：[已提交的变更]
Step 2: [操作] → 结果：失败/超时
此时系统状态：[描述不一致的状态]
用户感知：[用户看到什么]
数据后果：[哪些数据不一致]
```

**现有保护机制**：[分析代码中是否有保护，如有列出位置]
**缺失的保护**：[需要但不存在的保护]
**修复方向**：[建议的修复策略]

---

### 跨流程冲突发现

#### [BC-001] [冲突类型] - [简短描述]

- **冲突流程**：[流程A] vs [流程B]
- **共享状态**：[表/字段/缓存 Key]
- **确定性**：✓ 已确认 / ⚠ 疑似 / ? 待验证

**冲突时序推演**：
```
T1: [流程A] 读取 [状态] = [值]
T2: [流程B] 读取 [状态] = [值]
T3: [流程A] 写入 [状态] = [新值A]
T4: [流程B] 写入 [状态] = [新值B]  ← 覆盖了 A 的写入
后果：[描述]
```

**现有保护机制**：[乐观锁/悲观锁/分布式锁/状态校验？]
**缺失的保护**：[需要但不存在的保护]

---

### 状态机完整性发现

#### [SM-001] [问题类型] - [简短描述]

- **实体**：[Order / Payment / ...]
- **状态枚举**：[枚举类位置]
- **问题类型**：[缺失校验/非法转换/悬挂状态/死状态]

**状态转换矩阵**：
[矩阵表格]

**发现的问题**：
[具体问题描述，包含代码位置]

---

### 数据流 NPE 发现

#### [NF-001] [NPE 模式] - [简短描述]

- **数据对象**：[Order / UserDTO / ...]
- **空值字段**：[paymentInfo / defaultAddress / ...]
- **NPE 模式**：状态依赖字段 / 集合缩减为空 / 跨服务字段缺失 / 转换丢失 / Map 查找不对称
- **严重度**：Critical / High / Medium
- **确定性**：✓ 已确认 / ⚠ 疑似 / ? 待验证

**空值传播链**：
[数据源] → [字段填充条件] → [传递路径] → [解引用点(NPE)]

**触发条件**：[什么业务场景下触发]
**现有保护**：[是否有判空/状态校验，位置]
**修复方向**：[建议]
```

---

## 分析完整性自检

完成业务流程分析后，对照以下清单自检：

```
□ 是否识别了范围内所有业务流程？
□ 每个流程的副作用操作是否完整列出？
□ 每个流程的事务边界是否明确标注？
□ 是否对每个步骤都进行了故障注入分析？
□ 是否识别了所有共享状态的流程对？
□ 是否分析了跨流程并发冲突？
□ 是否检查了消息/事件的时序风险？
□ 是否验证了状态机的完整性？
□ 是否考虑了重试/幂等性？
□ 是否考虑了时间维度（超时、过期、跨日）？
□ 是否追踪了关键数据对象的字段填充状态？
□ 是否识别了「条件性非空」字段被无条件访问的位置？
□ 是否分析了集合操作缩减为空的 NPE 风险？
□ 是否检查了跨服务 DTO 字段缺失问题？
```
