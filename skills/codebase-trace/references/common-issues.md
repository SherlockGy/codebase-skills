# 常见潜在问题识别模式

在追踪调用链过程中，顺带标记以下明显问题。只标记追踪路径上看到的，不额外发起全局扫描。

## 业务逻辑类

### 1. 竞态条件（并发写入无保护）

**代码模式**：
```java
// 危险：读-改-写操作无锁保护
int stock = inventory.getStock();
if (stock >= quantity) {
    inventory.setStock(stock - quantity);  // 并发时可能超卖
    inventoryMapper.update(inventory);
}

// 危险：扣款操作无分布式锁
BigDecimal balance = account.getBalance();
account.setBalance(balance.subtract(amount));
accountMapper.update(account);
```

**识别信号**：
- 读取数据 → 判断 → 更新，三步不在同一个原子操作中
- 涉及库存、余额、额度等数值的扣减操作
- 无 `@Lock`、`Redisson`、`SELECT ... FOR UPDATE` 保护

**严重度**：高

---

### 2. 异常吞没导致数据不一致

**代码模式**：
```java
// 危险：catch 后未回滚，前序操作已生效
try {
    orderService.updateStatus(orderId, PAID);
    inventoryService.deduct(orderId);      // 若此处异常
    pointsService.addPoints(userId, points); // 此处不执行
} catch (Exception e) {
    log.error("处理失败", e);  // 但订单状态已改为 PAID
    // 缺少回滚逻辑
}
```

**识别信号**：
- `catch (Exception e)` 块中只有日志，无 `throw` / 无回滚
- 多个写操作不在同一 `@Transactional` 中，且异常被吞

**严重度**：高

---

### 3. 状态跳跃（状态机校验缺失）

**代码模式**：
```java
// 危险：未校验当前状态，直接设置目标状态
public void shipOrder(Long orderId) {
    Order order = orderMapper.selectById(orderId);
    order.setStatus(OrderStatus.SHIPPED);  // 未检查是否为 PAID
    orderMapper.update(order);
}
```

**识别信号**：
- `setStatus()` 前无 `getStatus()` 校验
- 枚举状态有多个值，但流转时未做合法性检查

**严重度**：中

---

### 4. 金额精度丢失

**代码模式**：
```java
// 危险：float/double 处理金额
double total = price * quantity;
double discount = total * 0.85;

// 正确做法应使用 BigDecimal
```

**识别信号**：
- `float` / `double` 类型的变量名含 amount、price、balance、fee、total
- 金额计算用 `*` `/` 而非 `BigDecimal.multiply()` / `BigDecimal.divide()`

**严重度**：高（资金场景）/ 中（非资金场景）

---

### 5. 越权访问（缺少数据归属校验）

**代码模式**：
```java
// 危险：按 ID 查询未校验数据归属
@GetMapping("/orders/{id}")
public Order getOrder(@PathVariable Long id) {
    return orderService.getById(id);  // 未校验 order.getUserId() == 当前用户
}
```

**识别信号**：
- 查询方法只用业务 ID（orderId、accountId），不带 userId 条件
- Controller 层直接暴露通过 ID 获取敏感数据的接口

**严重度**：高

---

### 6. 敏感信息泄露

**代码模式**：
```java
// 危险：日志中打印完整敏感信息
log.info("用户信息: {}", user);          // toString 可能含身份证、手机号
log.error("支付失败, 卡号: {}", cardNo);  // 完整银行卡号

// 危险：异常信息直接返回前端
catch (Exception e) {
    return Result.fail(e.getMessage());   // 可能暴露 SQL、堆栈
}
```

**识别信号**：
- `log.*` 中直接输出含敏感字段的对象
- 异常 message 直接作为 API 响应返回

**严重度**：中

---

## 运行时稳定性类

### 7. 空指针异常（NPE）

**代码模式**：
```java
// 危险：自动拆箱 NPE —— 包装类型为 null 时拆箱为基本类型直接崩溃
Integer quantity = order.getQuantity(); // 数据库字段允许 null
int total = quantity * price;           // NPE：null Integer 拆箱为 int

Long userId = request.getUserId();
long id = userId;                       // NPE：前端未传时为 null

Boolean enabled = config.getEnabled();
if (enabled) { ... }                    // NPE：null Boolean 拆箱

// 危险：查询结果未判空 —— 数据不存在时直接操作返回值
Order order = orderMapper.selectById(orderId);
order.setStatus(PAID);                  // orderId 不存在时 NPE

User user = userService.getByMobile(mobile);
String name = user.getName();           // 手机号未注册时 NPE

// 危险：Map.get() 结果未判空
Map<String, Config> configMap = loadConfig();
String value = configMap.get(key).getValue(); // key 不存在时 NPE

// 危险：链式调用 NPE —— 调用链中任一环节返回 null 即崩溃
String cityName = user.getAddress().getCity().getName();
BigDecimal amount = order.getPayment().getChannel().getFee();

// 危险：Optional 误用
Optional<User> userOpt = userRepository.findById(userId);
User user = userOpt.get(); // 未检查 isPresent() 直接 get()，等效于 NPE
```

**识别信号**：
- `Integer`/`Long`/`Boolean`/`Double` 等包装类型赋值给基本类型（自动拆箱），尤其是来源于数据库字段、RPC 响应、前端入参
- `selectById`/`findById`/`getByXxx` 等查询结果未做 null 检查即调用其方法
- `Map.get()`/`List.stream().findFirst().get()` 结果直接调用方法
- 链式方法调用超过 2 层且中间对象可能为 null
- `Optional.get()` 前无 `isPresent()` / `orElse()` / `orElseThrow()` 保护

**严重度**：高（核心链路、资金链路）/ 中（边缘逻辑）

**为什么特别危险**：
- 自动拆箱 NPE 在代码中**完全不可见**，没有显式的方法调用，极易遗漏
- 查询结果 NPE 在开发/测试环境数据完整时不会触发，到生产环境数据不一致时才爆发
- 链式调用 NPE 的堆栈信息无法区分是哪一层返回了 null，排查困难

---

## 性能类

### 8. N+1 查询

**代码模式**：
```java
// 危险：循环内逐条查询
List<Order> orders = orderMapper.selectByUserId(userId);
for (Order order : orders) {
    List<OrderItem> items = itemMapper.selectByOrderId(order.getId());  // N 次查询
    order.setItems(items);
}
```

**识别信号**：
- `for` / `forEach` / `stream` 循环内调用 Mapper/Repository 方法
- 循环变量作为查询参数

**严重度**：高（数据量大时）

---

### 9. 循环中的远程调用

**代码模式**：
```java
// 危险：循环内调用 RPC/HTTP
for (Order order : orders) {
    UserInfo user = userClient.getUser(order.getUserId());  // N 次 RPC
    order.setUserName(user.getName());
}
```

**识别信号**：
- 循环内出现 RestTemplate、FeignClient、Thrift Client、Dubbo 调用
- 循环内出现 `xxxTemplate.send`（MQ）

**严重度**：高

---

### 10. 大事务（@Transactional 包含 RPC）

**代码模式**：
```java
// 危险：事务内包含远程调用
@Transactional
public void createOrder(OrderRequest request) {
    Order order = buildOrder(request);
    orderMapper.insert(order);
    inventoryClient.deduct(request.getSkuId(), request.getQuantity());  // RPC 在事务内
    paymentClient.createPayment(order.getId(), order.getAmount());       // RPC 在事务内
    // 整个过程 DB 连接被占用，若 RPC 超时则长时间持有连接和锁
}
```

**识别信号**：
- `@Transactional` 方法内存在 HTTP/RPC/MQ 调用
- 事务方法内有 `Thread.sleep`、`xxxClient.xxx()`

**严重度**：高

---

### 11. 无分页查询

**代码模式**：
```java
// 危险：查询全量数据
List<Order> allOrders = orderMapper.selectAll();
List<User> users = userRepository.findAll();

// 在 MyBatis XML 中：
// <select id="selectAll" resultType="Order">
//   SELECT * FROM t_order  <!-- 无 LIMIT -->
// </select>
```

**识别信号**：
- 方法名为 `findAll`、`selectAll`、`listAll`
- SQL 查询无 `LIMIT`、无分页参数（pageNum、pageSize）
- 返回类型为 `List<>` 且无大小限制

**严重度**：中（小表）/ 高（大表）

---

### 12. 同步阻塞非核心操作

**代码模式**：
```java
// 危险：主流程中同步执行非核心操作
public Order createOrder(OrderRequest request) {
    Order order = doCreateOrder(request);
    emailService.sendOrderConfirmation(order);    // 同步发邮件
    smsService.sendNotification(order.getUserId()); // 同步发短信
    auditLogService.log("order_created", order);    // 同步写审计日志
    return order;
}
```

**识别信号**：
- 主流程方法内调用通知类服务（email、sms、push）
- 无 `@Async`、无 MQ 异步化
- 方法名含 send、notify、log 但在主链路同步调用

**严重度**：中

---

## 识别原则

1. **只标记明显问题**：需要代码模式直接可见，不做推测
2. **标注确定性**：
   - ✓ 已确认：代码中明确存在该模式
   - ⚠ 疑似：代码模式相似但需结合上下文判断
3. **不重复追踪已有章节**：敏感操作清单已覆盖的 DB/RPC 操作不重复列举，只标记其中的问题模式
4. **严重度判断**：结合上下文（是否在资金链路、是否在高频路径）
