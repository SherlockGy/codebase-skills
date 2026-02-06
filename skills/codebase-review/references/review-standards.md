# 代码质量审查标准 — 完整检测模式

本文档包含 15 大类 52 项检查规则的详细检测模式，供代码审查阶段使用。

---

## 一、业务逻辑类

### 1. 竞态条件（并发写入无保护）

**代码模式**：
```java
// 读-改-写操作无锁保护
int stock = inventory.getStock();
if (stock >= quantity) {
    inventory.setStock(stock - quantity);  // 并发时可能超卖
    inventoryMapper.update(inventory);
}

// 扣款操作无分布式锁
BigDecimal balance = account.getBalance();
account.setBalance(balance.subtract(amount));
accountMapper.update(account);
```

**Grep 检测模式**：
- `getStock|getBalance|getAmount|getQuantity|getCount` 后跟 `set.*` 和 `update`
- 涉及库存、余额、额度等数值的读-改-写序列

**识别信号**：
- 读取数据 → 判断 → 更新，三步不在同一个原子操作中
- 无 `@Lock`、`Redisson`、`SELECT ... FOR UPDATE` 保护
- 涉及金额、库存、额度等关键数值

**严重度**：Critical

---

### 2. 异常吞没导致数据不一致

**代码模式**：
```java
try {
    orderService.updateStatus(orderId, PAID);
    inventoryService.deduct(orderId);      // 若此处异常
    pointsService.addPoints(userId, points); // 此处不执行
} catch (Exception e) {
    log.error("处理失败", e);  // 但订单状态已改为 PAID
    // 缺少回滚逻辑
}
```

**Grep 检测模式**：
- `catch\s*\(\s*(Exception|Throwable)` 块中只有 `log\.(error|warn)`，无 `throw` / 无回滚
- 多个写操作不在同一 `@Transactional` 中

**识别信号**：
- catch 块只打日志，无 throw、无 rollback
- 多个写操作在 catch 中仅日志记录

**严重度**：High

---

### 3. 状态跳跃（状态机校验缺失）

**代码模式**：
```java
public void shipOrder(Long orderId) {
    Order order = orderMapper.selectById(orderId);
    order.setStatus(OrderStatus.SHIPPED);  // 未检查是否为 PAID
    orderMapper.update(order);
}
```

**Grep 检测模式**：
- `setStatus\(` 前无 `getStatus\(\)` 校验
- `\.set(State|Status)\(` 直接调用

**识别信号**：
- setStatus() 前无 getStatus() 校验
- 枚举状态有多个值，但流转时未做合法性检查

**严重度**：Medium

---

### 4. 金额精度丢失

**代码模式**：
```java
double total = price * quantity;
double discount = total * 0.85;
// 正确做法应使用 BigDecimal
```

**Grep 检测模式**：
- `(float|double)\s+\w*(amount|price|balance|fee|total|money|cost|payment|refund)`
- 金额字段使用 `\*|/` 运算符而非 `BigDecimal.multiply|divide`

**识别信号**：
- float/double 类型的变量名含资金相关关键词
- 金额计算用算术运算符

**严重度**：Critical（资金场景）/ Medium（非资金场景）

---

### 5. 越权访问（缺少数据归属校验）

**代码模式**：
```java
@GetMapping("/orders/{id}")
public Order getOrder(@PathVariable Long id) {
    return orderService.getById(id);  // 未校验 order.getUserId() == 当前用户
}
```

**Grep 检测模式**：
- `@(Get|Post|Put|Delete)Mapping.*\{id\}` 对应方法中只用 ID 查询
- `getById|selectById|findById` 无 userId 条件

**识别信号**：
- 查询方法只用业务 ID，不带 userId 条件
- Controller 层直接暴露通过 ID 获取敏感数据的接口

**严重度**：Critical

---

### 6. 敏感信息泄露

**代码模式**：
```java
log.info("用户信息: {}", user);          // toString 可能含身份证、手机号
log.error("支付失败, 卡号: {}", cardNo);  // 完整银行卡号

catch (Exception e) {
    return Result.fail(e.getMessage());   // 可能暴露 SQL、堆栈
}
```

**Grep 检测模式**：
- `log\.(info|debug|warn|error).*\b(user|password|card|token|secret|mobile|phone|idCard|身份证|手机|银行卡)`
- `e\.getMessage\(\)` 直接作为 API 响应

**识别信号**：
- 日志中直接输出含敏感字段的对象
- 异常 message 直接作为 API 响应返回

**严重度**：High

---

## 二、运行时稳定性类

### 7. 空指针异常（NPE）

#### 代码模式级 NPE

```java
// 自动拆箱 NPE
Integer quantity = order.getQuantity(); // 数据库字段允许 null
int total = quantity * price;           // NPE

Long userId = request.getUserId();
long id = userId;                       // NPE

Boolean enabled = config.getEnabled();
if (enabled) { ... }                    // NPE

// 查询结果未判空
Order order = orderMapper.selectById(orderId);
order.setStatus(PAID);                  // orderId 不存在时 NPE

// Map.get() 结果未判空
String value = configMap.get(key).getValue(); // key 不存在时 NPE

// 链式调用 NPE
String cityName = user.getAddress().getCity().getName();

// Optional 误用
User user = userOpt.get(); // 未检查 isPresent()
```

#### 业务数据流级 NPE

```java
// 状态依赖字段
Order order = orderMapper.selectById(orderId);
String transactionId = order.getPaymentInfo().getTransactionId();  // 未支付时 NPE

// 可选业务关系
String address = user.getDefaultAddress().getFullAddress();  // 新用户无地址 NPE

// 跨服务数据不完整
UserDTO user = userClient.getBasicInfo(userId);
String deptName = user.getDepartment().getName();  // 未填充字段 NPE

// 条件赋值遗漏
String trackingNo = orderDTO.getShippingInfo().getTrackingNo();  // 虚拟商品无物流 NPE
```

**Grep 检测模式**：
- `(Integer|Long|Boolean|Double|Float|Short|Byte)\s+\w+.*=.*get` 后跟基本类型赋值
- `selectById|findById|getBy\w+` 结果直接调用方法
- `\.get\(\w+\)\.\w+` 链式调用
- `\.get\(\)` 前无 `isPresent`

**严重度**：High（核心链路）/ Medium（边缘逻辑）

---

### 8. 不可变集合陷阱

**代码模式**：
```java
List<String> list = Arrays.asList("a", "b", "c");
list.add("d");    // UnsupportedOperationException

List<String> list = List.of("a", "b");
list.add("c");    // UnsupportedOperationException

List<String> single = Collections.singletonList("only");
single.add("another");  // UnsupportedOperationException

List<String> sub = list.subList(0, 2);
list.add("new");
sub.get(0);       // ConcurrentModificationException
```

**Grep 检测模式**：
- `Arrays\.asList\(` 返回值被传递或后续调用 `add|remove`
- `List\.of\(|Collections\.singletonList\(|Collections\.emptyList\(` 后续修改操作
- `\.subList\(` 返回值在原 List 修改后使用

**严重度**：High

---

## 三、性能类

### 9. N+1 查询

**代码模式**：
```java
List<Order> orders = orderMapper.selectByUserId(userId);
for (Order order : orders) {
    List<OrderItem> items = itemMapper.selectByOrderId(order.getId());  // N 次查询
}
```

**Grep 检测模式**：
- `for\s*\(.*:.*\)` 或 `\.forEach\(` 或 `\.stream\(\)` 内调用 `Mapper|Repository|Dao` 方法
- 循环变量作为查询参数

**严重度**：High

---

### 10. 循环中的远程调用

**代码模式**：
```java
for (Order order : orders) {
    UserInfo user = userClient.getUser(order.getUserId());  // N 次 RPC
}
```

**Grep 检测模式**：
- 循环内出现 `RestTemplate|FeignClient|Thrift|Dubbo|xxxClient\.\w+`
- 循环内出现 `xxxTemplate\.send`

**严重度**：High

---

### 11. 大事务（@Transactional 包含 RPC）

**代码模式**：
```java
@Transactional
public void createOrder(OrderRequest request) {
    orderMapper.insert(order);
    inventoryClient.deduct(skuId, quantity);  // RPC 在事务内
    paymentClient.createPayment(orderId, amount);  // RPC 在事务内
}
```

**Grep 检测模式**：
- `@Transactional` 方法内存在 `Client\.\w+\(|RestTemplate\.\w+\(|Template\.send`
- 事务方法内有 `Thread\.sleep`

**严重度**：High

---

### 12. 无分页查询

**代码模式**：
```java
List<Order> allOrders = orderMapper.selectAll();
List<User> users = userRepository.findAll();
```

**Grep 检测模式**：
- 方法名 `findAll|selectAll|listAll|getAll` 无分页参数
- MyBatis XML 中 `SELECT.*FROM.*` 无 `LIMIT`
- 返回类型为 `List<>` 且无 `pageNum|pageSize|Pageable` 参数

**严重度**：Medium（小表）/ High（大表）

---

### 13. 同步阻塞非核心操作

**代码模式**：
```java
public Order createOrder(OrderRequest request) {
    Order order = doCreateOrder(request);
    emailService.sendOrderConfirmation(order);    // 同步发邮件
    smsService.sendNotification(order.getUserId()); // 同步发短信
    return order;
}
```

**Grep 检测模式**：
- 主流程方法内调用 `send|notify|log|audit` 类方法
- 无 `@Async`、无 MQ 异步化

**严重度**：Medium

---

## 四、Spring AOP / 代理绕过类

### 14. 自调用绕过 AOP 注解

**代码模式**：
```java
@Service
public class OrderService {
    public void process() {
        this.doProcess();  // 自调用，@Transactional 不生效
    }

    @Transactional
    public void doProcess() {
        // 事务不会开启！
    }
}
```

**Grep 检测模式**：
- 同一类中方法 A 调用方法 B，且方法 B 有 `@Transactional|@Async|@Cacheable|@Secured|@PreAuthorize`
- `this\.` 调用带 AOP 注解的方法
- 无 `this.` 前缀但调用同类中带注解的方法

**识别方法**：
1. 找到带 AOP 注解的方法
2. 在同一类中搜索对该方法的内部调用
3. 如果存在，标记为自调用绕过

**严重度**：Critical

---

### 15. AOP 注解标注在非 public 方法上

**代码模式**：
```java
@Transactional
private void doSave(Order order) {  // private 方法，注解无效
    orderMapper.insert(order);
}

@Cacheable("orders")
protected Order findOrder(Long id) {  // protected 方法，注解无效
    return orderMapper.selectById(id);
}
```

**Grep 检测模式**：
- `@(Transactional|Cacheable|CacheEvict|CachePut|Async)\s*\n\s*(private|protected)`
- 非 public 方法上的 AOP 注解

**严重度**：Critical

---

### 16. AOP 注解标注在 final 类或方法上

**代码模式**：
```java
@Service
public final class OrderService {  // final 类，CGLIB 无法代理
    @Transactional
    public void save(Order order) { }  // 注解无效
}

@Service
public class OrderService {
    @Transactional
    public final void save(Order order) { }  // final 方法，无法被覆盖
}
```

**Grep 检测模式**：
- `final\s+class.*@(Service|Component|Repository|Controller)` 或反序
- `@Transactional.*\n.*final\s+\w+\s+\w+\(` final 方法上的事务注解

**严重度**：Critical

---

## 五、Spring 事务进阶类

### 17. Checked 异常不触发回滚

**代码模式**：
```java
@Transactional  // 默认只回滚 RuntimeException
public void process() throws BusinessException {  // BusinessException extends Exception
    orderMapper.insert(order);
    if (invalidCondition) {
        throw new BusinessException("业务错误");  // 不会触发回滚！
    }
}
```

**Grep 检测模式**：
- `@Transactional\s*$` 或 `@Transactional\(\s*\)` —— 无 `rollbackFor` 参数
- 同一方法声明 `throws` checked 异常
- 方法内 `throw new \w+Exception` 且该异常不是 `RuntimeException` 子类

**正确写法**：`@Transactional(rollbackFor = Exception.class)`

**严重度**：Critical

---

### 18. 嵌套事务 UnexpectedRollbackException

**代码模式**：
```java
@Transactional
public void outerMethod() {
    try {
        innerService.innerMethod();  // @Transactional(propagation = REQUIRED)
    } catch (Exception e) {
        log.error("内部失败", e);  // 吞没异常
        // 但事务已被标记为 rollback-only
        // outerMethod 提交时抛出 UnexpectedRollbackException
    }
}
```

**Grep 检测模式**：
- `@Transactional` 方法中 try-catch 调用另一个 `@Transactional` 方法
- catch 块中未重新抛出异常

**严重度**：Medium

---

### 19. readOnly=true 用于写操作

**代码模式**：
```java
@Transactional(readOnly = true)
public void updateOrder(Order order) {
    orderMapper.update(order);  // 运行时异常！
}
```

**Grep 检测模式**：
- `@Transactional\(.*readOnly\s*=\s*true` 方法内含 `insert|update|delete|save|remove` 调用

**严重度**：Medium

---

### 20. @Transactional + @Async 事务上下文丢失

**代码模式**：
```java
// 场景1：事务方法调用异步方法
@Transactional
public void process() {
    orderMapper.insert(order);
    asyncService.sendNotification(order);  // @Async 方法在新线程，无事务
}

// 场景2：同一方法同时标注
@Async
@Transactional
public void process() {  // 行为不可预期
}
```

**Grep 检测模式**：
- `@Transactional` 方法内调用 `@Async` 方法
- 同一方法同时有 `@Async` 和 `@Transactional`

**严重度**：High

---

## 六、Spring Bean 生命周期类

### 21. Prototype Bean 注入到 Singleton

**代码模式**：
```java
@Scope("prototype")
@Component
public class RequestContext { ... }

@Service  // 默认 singleton
public class OrderService {
    @Autowired
    private RequestContext requestContext;  // 始终是同一个实例！
}
```

**Grep 检测模式**：
- `@Scope\("prototype"\)` 或 `@Scope\(ConfigurableBeanFactory.SCOPE_PROTOTYPE\)` 标注的类
- 该类被 `@Autowired` 注入到未标注 `@Scope("prototype")` 的类中

**严重度**：Medium

---

### 22. 循环依赖

**代码模式**：
```java
@Service
public class OrderService {
    @Autowired
    private PaymentService paymentService;
}

@Service
public class PaymentService {
    @Autowired
    private OrderService orderService;  // 循环依赖
}
```

**Grep 检测模式**：
- `@Autowired` 或构造器注入形成的双向依赖
- `@Lazy` 注解的使用（通常是循环依赖的 workaround）

**严重度**：Medium

---

### 23. Singleton Bean 持有可变共享状态

**代码模式**：
```java
@Service
public class OrderService {
    private int counter = 0;  // 可变共享状态！
    private Map<String, Object> cache = new HashMap<>();  // 线程不安全！

    public void process() {
        counter++;  // 并发数据竞争
        cache.put(key, value);  // 并发 ConcurrentModificationException
    }
}
```

**Grep 检测模式**：
- `@(Service|Component|Repository|Controller)` 类中的非 final 实例字段
- 特别关注 `private\s+(int|long|boolean|Map|List|Set)\s+\w+\s*=`

**严重度**：High

---

## 七、Spring @Async 陷阱类

### 24. 默认 SimpleAsyncTaskExecutor（OOM 风险）

**代码模式**：
```java
@EnableAsync
@Configuration
public class AppConfig {
    // 未配置自定义线程池！
    // Spring 默认使用 SimpleAsyncTaskExecutor，每次创建新线程
}

@Async  // 无线程池限定符
public void sendEmail(String to) { ... }
```

**Grep 检测模式**：
- `@EnableAsync` 存在但无 `ThreadPoolTaskExecutor` 或 `AsyncConfigurer` Bean 定义
- `@Async` 未指定线程池名称（如 `@Async("customExecutor")`）

**严重度**：High

---

### 25. SecurityContext / MDC 在异步线程中丢失

**代码模式**：
```java
@Async
public void processOrder(Long orderId) {
    // SecurityContextHolder.getContext() 返回空！
    String userId = SecurityContextHolder.getContext()
        .getAuthentication().getName();  // NPE
}
```

**Grep 检测模式**：
- `@Async` 方法内使用 `SecurityContextHolder.getContext()` 或 `MDC.get(`
- 未配置 `DelegatingSecurityContextAsyncTaskExecutor`

**严重度**：High（安全上下文）/ Medium（MDC）

---

## 八、Spring @Scheduled 陷阱类

### 26. 单线程默认调度器阻塞

**代码模式**：
```java
// 多个 @Scheduled 方法但未配置线程池
@Scheduled(cron = "0 0 2 * * ?")
public void dailyJob() { /* 耗时操作 */ }

@Scheduled(fixedRate = 60000)
public void minuteJob() { /* 被 dailyJob 阻塞！ */ }
```

**Grep 检测模式**：
- 多个 `@Scheduled` 方法存在
- 无 `SchedulingConfigurer` 实现或 `spring.task.scheduling.pool.size` 配置
- 无自定义 `TaskScheduler` Bean

**严重度**：High

---

### 27. 分布式部署重复执行

**代码模式**：
```java
@Scheduled(cron = "0 0 2 * * ?")
public void sendDailyReport() {
    // 多节点部署时，每个节点都会执行！
    emailService.sendReport();
}
```

**Grep 检测模式**：
- `@Scheduled` 方法执行写操作（发送、更新、删除）
- 无 `@SchedulerLock`（ShedLock）、无分布式锁、无 Quartz 集群配置

**严重度**：High

---

## 九、MyBatis SQL 与查询类

### 28. SQL 注入（${} 字符串拼接）

**代码模式**：
```xml
<!-- 危险：直接拼接用户输入 -->
<select id="findUser" resultType="User">
    SELECT * FROM users WHERE name = '${name}'
</select>

<!-- 常见于 ORDER BY -->
<select id="listOrders" resultType="Order">
    SELECT * FROM orders ORDER BY ${orderBy}
</select>
```

**Grep 检测模式**：
- MyBatis XML 中 `\$\{` 的使用（区别于安全的 `#{`）
- `@Select|@Insert|@Update|@Delete` 注解中的 `\$\{`
- 特别关注 `WHERE.*\$\{|ORDER BY\s+\$\{|LIKE.*\$\{`

**严重度**：Critical

---

### 29. LIKE 查询 SQL 注入

**代码模式**：
```xml
<!-- 危险 -->
<select id="search" resultType="User">
    SELECT * FROM users WHERE name LIKE '%${keyword}%'
</select>

<!-- 安全写法 -->
<select id="search" resultType="User">
    SELECT * FROM users WHERE name LIKE CONCAT('%', #{keyword}, '%')
</select>
```

**Grep 检测模式**：
- `LIKE\s+['"]%\$\{` 或 `LIKE\s+\$\{.*%`
- LIKE 子句中使用 `${}` 而非 `#{}`

**严重度**：Critical

---

### 30. foreach 生成无界 SQL 语句

**代码模式**：
```xml
<insert id="batchInsert">
    INSERT INTO orders (id, name, amount) VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.id}, #{item.name}, #{item.amount})
    </foreach>
    <!-- 如果 list 有 10000 条，生成超长 SQL -->
</insert>

<select id="findByIds">
    SELECT * FROM orders WHERE id IN
    <foreach collection="ids" item="id" open="(" close=")" separator=",">
        #{id}
    </foreach>
    <!-- Oracle 限制 IN 子句 1000 个参数 -->
</select>
```

**Grep 检测模式**：
- `<foreach` 用于 INSERT VALUES 或 IN 子句
- Java 代码中调用方无集合大小限制或分批逻辑

**严重度**：Medium

---

### 31. 静默错误的列映射

**代码模式**：
```xml
<!-- 列名与 Java 字段名不匹配时，静默返回 null -->
<select id="findById" resultType="Order">
    SELECT order_no, total_amt FROM orders WHERE id = #{id}
    <!-- 如果 Java 字段名是 orderNo 和 totalAmount，映射失败但无报错 -->
</select>
```

**Grep 检测模式**：
- `resultType` 而非 `resultMap` 的使用
- SQL 列名含下划线但 Java 字段用驼峰（未开启 `mapUnderscoreToCamelCase`）
- SELECT 列名与 resultMap 中 column 属性不匹配

**严重度**：Medium

---

### 32. OGNL 类型强制转换（if test 条件）

**代码模式**：
```xml
<!-- 危险：单字符用单引号，OGNL 将其转为 char 的 int 值 -->
<if test="type == 'Y'">
    <!-- 实际比较的是 type == 89（'Y' 的 ASCII 值），不是字符串 "Y" -->
</if>

<!-- 安全写法 -->
<if test='type == "Y"'>
    <!-- 正确比较字符串 -->
</if>

<!-- 或者 -->
<if test="type == 'Y'.toString()">
</if>
```

**Grep 检测模式**：
- `test=".*==\s*'[A-Za-z0-9]'"` —— 单引号包裹单个字符的比较
- 特别关注状态码、类型码、标志位的比较

**严重度**：Medium

---

## 十、MyBatis-Spring 事务集成类

### 33. DataSource 不匹配导致事务失效

**代码模式**：
```java
@Configuration
public class DataSourceConfig {
    @Bean("primaryDS")
    public DataSource primaryDataSource() { ... }

    @Bean("secondaryDS")
    public DataSource secondaryDataSource() { ... }

    @Bean
    public SqlSessionFactory sqlSessionFactory(@Qualifier("primaryDS") DataSource ds) {
        // 使用 primaryDS
    }

    @Bean
    public PlatformTransactionManager transactionManager(@Qualifier("secondaryDS") DataSource ds) {
        // 使用 secondaryDS！事务管理器和 SqlSessionFactory 使用不同 DataSource
        return new DataSourceTransactionManager(ds);
    }
}
```

**Grep 检测模式**：
- 多个 `DataSource` Bean 定义
- `SqlSessionFactoryBean` 和 `DataSourceTransactionManager` 引用不同的 DataSource
- `@Qualifier` 注解指向不同的 DataSource Bean

**严重度**：Critical

---

### 34. @Transactional 外的自动提交

**代码模式**：
```java
// 无 @Transactional 注解！
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    accountMapper.deduct(fromId, amount);   // 自动提交
    accountMapper.add(toId, amount);         // 如果这里失败，上一行已提交
}
```

**Grep 检测模式**：
- Service 方法中调用多个 `mapper\.\w+(insert|update|delete)` 但无 `@Transactional`
- 方法名含 `create|update|delete|save|transfer|process` 但无事务注解

**严重度**：High

---

## 十一、Java 并发进阶类

### 35. SimpleDateFormat 共享实例

**代码模式**：
```java
public class DateUtil {
    // 危险：static 共享实例，线程不安全
    private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd");

    public static String format(Date date) {
        return SDF.format(date);  // 并发时数据错乱
    }
}
```

**Grep 检测模式**：
- `static.*SimpleDateFormat`
- `static.*DateFormat`
- 同样适用于 `DocumentBuilder`、`Transformer`、`MessageFormat`

**正确替代**：`DateTimeFormatter`（线程安全）、`ThreadLocal<SimpleDateFormat>`

**严重度**：High

---

### 36. HashMap / ArrayList 并发使用

**代码模式**：
```java
@Service
public class CacheService {
    private Map<String, Object> cache = new HashMap<>();  // 线程不安全

    public void put(String key, Object value) {
        cache.put(key, value);  // 并发时可能死循环或数据丢失
    }
}
```

**Grep 检测模式**：
- `@(Service|Component|Controller|Repository)` 类中的 `HashMap|ArrayList|HashSet|LinkedList` 实例字段
- 非 `ConcurrentHashMap|CopyOnWriteArrayList|Collections\.synchronized` 的可变集合

**严重度**：High

---

### 37. 同步锁对象不当

**代码模式**：
```java
// 危险：String 驻留，不同类可能锁同一对象
synchronized("lock") { ... }

// 危险：Integer 缓存，-128~127 范围内共享
synchronized(userId) { ... }  // userId 是 Integer 类型

// 危险：非 final 字段可被重新赋值
private Object lock = new Object();
synchronized(lock) { ... }  // 如果 lock 被重新赋值，锁失效
```

**Grep 检测模式**：
- `synchronized\s*\(\s*"` —— 字符串字面量同步
- `synchronized\s*\(\s*\w+(Id|Code|Key)\s*\)` —— 可能是包装类型
- `synchronized\s*\(` 且锁对象非 `final` 字段

**严重度**：Medium

---

### 38. 双重检查锁缺少 volatile

**代码模式**：
```java
private Singleton instance;  // 缺少 volatile！

public Singleton getInstance() {
    if (instance == null) {
        synchronized (this) {
            if (instance == null) {
                instance = new Singleton();  // 另一个线程可能看到部分构造的对象
            }
        }
    }
    return instance;
}
```

**Grep 检测模式**：
- 双重 `if.*==\s*null` 嵌套在 `synchronized` 中
- 被赋值的字段无 `volatile` 修饰

**严重度**：High

---

### 39. ThreadLocal 未清理（内存泄漏）

**代码模式**：
```java
private static final ThreadLocal<UserContext> CONTEXT = new ThreadLocal<>();

public void setContext(UserContext ctx) {
    CONTEXT.set(ctx);  // 设置了但未清理
}

// 缺少 finally { CONTEXT.remove(); }
```

**Grep 检测模式**：
- `ThreadLocal.*\.set\(` 存在但无对应的 `\.remove\(\)` 在 finally 块中
- 无 `Filter` 或 `HandlerInterceptor` 执行 `ThreadLocal.remove()`
- `ThreadLocal.set(null)` 被当作清理手段（实际仍泄漏 key 引用）

**严重度**：High

---

### 40. 持有锁进行 I/O 操作

**代码模式**：
```java
synchronized(lock) {
    // 持有锁进行 I/O
    Order order = orderMapper.selectById(orderId);  // 数据库查询
    UserInfo user = userClient.getUser(userId);      // HTTP/RPC 调用
    Files.readAllBytes(path);                         // 文件操作
}
```

**Grep 检测模式**：
- `synchronized` 块或 `lock\(\)` 后包含数据库调用、HTTP/RPC 调用、文件操作
- 锁内有 `Mapper\.\w+|Repository\.\w+|Client\.\w+|RestTemplate\.\w+`

**严重度**：Medium

---

## 十二、安全配置类

### 41. CSRF 保护被禁用

**代码模式**：
```java
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf().disable();  // 禁用 CSRF 保护
        // 或
        http.csrf(csrf -> csrf.disable());
    }
}
```

**Grep 检测模式**：
- `csrf\(\)\.disable\(\)` 或 `csrf\(.*disable`
- `csrf\(AbstractHttpConfigurer::disable\)`

**判断上下文**：纯 API 服务（无 cookie/session）禁用 CSRF 是合理的；浏览器应用禁用则是高危

**严重度**：High（浏览器应用）/ Low（纯 API）

---

### 42. CORS 通配符 + 凭证

**代码模式**：
```java
CorsConfiguration config = new CorsConfiguration();
config.addAllowedOrigin("*");      // 或 addAllowedOriginPattern("*")
config.setAllowCredentials(true);   // 允许携带凭证 + 通配符 = 危险
```

**Grep 检测模式**：
- `addAllowedOrigin\("\*"\)` 或 `allowedOriginPatterns\("\*"\)` 结合 `setAllowCredentials\(true\)`
- `@CrossOrigin` 注解中 `origins = "*"` 结合 `allowCredentials = "true"`

**严重度**：Critical

---

### 43. Actuator 端点未鉴权暴露

**代码模式**：
```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: "*"  # 暴露所有端点
```

**Grep 检测模式**：
- `management.endpoints.web.exposure.include=\*` 或 YAML 等价
- `management.security.enabled=false`（Spring Boot 1.x）
- 无 Spring Security 规则保护 `/actuator/**` 路径

**严重度**：Critical

---

### 44. Mass Assignment / 自动绑定漏洞

**代码模式**：
```java
@PostMapping("/users")
public User createUser(@ModelAttribute User user) {  // 直接绑定到实体
    // 攻击者可以传入 role=ADMIN 参数
    return userRepository.save(user);
}
```

**Grep 检测模式**：
- `@ModelAttribute` 绑定到 JPA 实体或含敏感字段的对象
- Controller 方法参数直接使用 Entity 类而非 DTO
- 无 `@InitBinder` 配置 `setAllowedFields` 或 `setDisallowedFields`

**严重度**：Critical

---

## 十三、输入校验类

### 45. @RequestBody 缺少 @Valid

**代码模式**：
```java
@PostMapping("/orders")
public Order createOrder(@RequestBody OrderDTO dto) {  // 缺少 @Valid
    // OrderDTO 中的 @NotNull, @Size 等校验注解不会生效！
    return orderService.create(dto);
}
```

**Grep 检测模式**：
- `@RequestBody\s+\w+` 无 `@Valid` 或 `@Validated` 修饰
- DTO 类中有 `@NotNull|@NotBlank|@Size|@Min|@Max|@Email|@Pattern` 但 Controller 参数无校验触发

**严重度**：High

---

### 46. 嵌套对象缺少 @Valid

**代码模式**：
```java
public class OrderDTO {
    @NotNull
    private Long userId;

    private AddressDTO address;  // 缺少 @Valid，AddressDTO 中的校验不会触发

    // AddressDTO 中有 @NotBlank private String street;
}
```

**Grep 检测模式**：
- DTO 类中的复杂类型字段（非基本类型/String）无 `@Valid` 注解
- 该字段的类型中包含 Bean Validation 注解

**严重度**：Medium

---

### 47. @PathVariable 校验返回 500

**代码模式**：
```java
// Controller 类未标注 @Validated
@RestController
public class OrderController {
    @GetMapping("/orders/{id}")
    public Order getOrder(@PathVariable @Min(1) Long id) {
        // @Min 校验不会触发（类上缺少 @Validated）
        // 或者触发了但返回 500 而不是 400（缺少 ExceptionHandler）
    }
}
```

**Grep 检测模式**：
- `@(PathVariable|RequestParam).*@(Min|Max|Size|Pattern)` 但 Controller 类无 `@Validated`
- 无 `@ExceptionHandler.*ConstraintViolationException`

**严重度**：Medium

---

## 十四、资源与连接泄漏类

### 48. 未关闭资源（无 try-with-resources）

**代码模式**：
```java
// 危险：异常时资源泄漏
FileInputStream fis = new FileInputStream(file);
BufferedReader reader = new BufferedReader(new InputStreamReader(fis));
String line = reader.readLine();
reader.close();  // 如果 readLine() 抛异常，永远不会执行

// 正确写法
try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
    String line = reader.readLine();
}
```

**Grep 检测模式**：
- `new FileInputStream|new BufferedReader|new FileWriter|new Socket` 不在 try-with-resources 中
- `dataSource\.getConnection\(\)` 不在 try-with-resources 中
- `response\.getEntity\(\)\.getContent\(\)` 不在 try-with-resources 中

**严重度**：High

---

### 49. 数据库连接池泄漏

**代码模式**：
```java
public void query() {
    Connection conn = dataSource.getConnection();
    Statement stmt = conn.createStatement();
    ResultSet rs = stmt.executeQuery(sql);
    // 处理结果...
    conn.close();  // 如果中间抛异常，连接不会归还连接池
}
```

**Grep 检测模式**：
- `dataSource\.getConnection\(\)` 且 Connection 变量不在 try-with-resources 中
- `DriverManager\.getConnection\(` 手动管理连接

**严重度**：Critical

---

### 50. 静态集合无界增长

**代码模式**：
```java
public class EventRegistry {
    private static final Map<String, Object> CACHE = new ConcurrentHashMap<>();

    public static void register(String key, Object value) {
        CACHE.put(key, value);  // 只增不减，内存泄漏
    }
    // 无 remove、clear 或容量限制
}
```

**Grep 检测模式**：
- `static.*(Map|List|Set|Queue)\s*<.*>\s+\w+\s*=\s*new` 且只有 `put|add` 无 `remove|clear|evict`
- 无 `maximumSize|expireAfter|CacheBuilder|Caffeine` 容量限制

**严重度**：Medium

---

## 十五、Spring 缓存类

### 51. @Cacheable 缓存 null 值

**代码模式**：
```java
@Cacheable("users")
public User findById(Long id) {
    return userMapper.selectById(id);  // 可能返回 null
    // null 被缓存后，即使数据后来存在了，也一直返回 null
}
```

**Grep 检测模式**：
- `@Cacheable` 无 `unless = "#result == null"` 条件
- 方法可能返回 null（查询方法无 Optional 包装）

**正确写法**：`@Cacheable(value = "users", unless = "#result == null")`

**严重度**：Medium

---

### 52. @Cacheable Key 碰撞

**代码模式**：
```java
@Cacheable("orders")
public Order findByIdAndType(Long id, String type) {
    // 如果不指定 key，默认使用 SimpleKey(id, type)
    // 如果参数是自定义对象且没有 hashCode/equals，缓存失效
}

// 不同方法使用同一 cache name 但无参数区分
@Cacheable("config")
public String getConfig1() { ... }

@Cacheable("config")
public String getConfig2() { ... }  // Key 碰撞！都是 SimpleKey.EMPTY
```

**Grep 检测模式**：
- 多个 `@Cacheable` 使用相同 cache name 但方法签名不同
- `@Cacheable` 参数为自定义对象，该对象类无 `hashCode|equals` 方法
- 无参方法的 `@Cacheable` 使用相同 cache name

**严重度**：Medium

---

## 通用检测命令

以下 Grep 模式可用于批量快速扫描：

```bash
# 业务逻辑类
grep -rn "catch\s*(Exception|Throwable)" --include="*.java"
grep -rn "(float|double)\s+\w*(amount|price|balance|fee|total)" --include="*.java"

# Spring AOP 绕过
grep -rn "@Transactional" --include="*.java" | grep -v "public"
grep -rn "final class.*@Service\|@Service.*final class" --include="*.java"

# Spring 事务
grep -rn "@Transactional\s*$\|@Transactional()" --include="*.java"
grep -rn "@Transactional.*readOnly.*true" --include="*.java"

# MyBatis SQL 注入
grep -rn '\$\{' --include="*.xml" | grep -v "<!-"
grep -rn "LIKE.*\$\{" --include="*.xml"

# 并发问题
grep -rn "static.*SimpleDateFormat" --include="*.java"
grep -rn "ThreadLocal.*\.set(" --include="*.java"

# 安全配置
grep -rn "csrf.*disable\|\.csrf()\.disable()" --include="*.java"
grep -rn "exposure.include.*\*\|include: \"\*\"" --include="*.yml" --include="*.yaml" --include="*.properties"

# 资源泄漏
grep -rn "new FileInputStream\|new BufferedReader\|getConnection()" --include="*.java"

# 校验缺失
grep -rn "@RequestBody" --include="*.java" | grep -v "@Valid\|@Validated"
```

---

## 识别原则

1. **只标记明显问题**：代码模式直接可见，不做推测
2. **标注确定性**：
   - ✓ 已确认：代码中明确存在该模式
   - ⚠ 疑似：代码模式相似但需结合上下文判断
   - ? 待验证：需要运行时验证
3. **上下文判断**：结合技术栈和业务场景判断严重度
4. **不重复**：如已有报告中已标记的问题，引用而非重复
5. **先广后深**：先用 Grep 批量扫描，再逐一确认
