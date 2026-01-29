# Java Spring 常见模式

## 分层架构

### 标准分层

```
Controller (API 入口)
    ↓
Service (业务逻辑)
    ↓
Repository/Mapper (数据访问)
    ↓
Database
```

### 识别特征

**Controller 层**：
- `@RestController`、`@Controller`
- `@RequestMapping`、`@GetMapping`、`@PostMapping`
- 接收 DTO，返回 VO

**Service 层**：
- `@Service`
- `@Transactional`
- 业务逻辑，调用多个 Repository

**Repository 层**：
- `@Repository`、`@Mapper`
- MyBatis: `*Mapper.java` + `*Mapper.xml`
- JPA: `extends JpaRepository`

## 常见入口类型

### HTTP 入口

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @PostMapping
    public OrderVO createOrder(@RequestBody CreateOrderDTO dto) { }
}
```

### 消息队列入口

```java
@RabbitListener(queues = "order.queue")
public void handleOrderMessage(OrderMessage message) { }

@KafkaListener(topics = "order-topic")
public void handleOrderEvent(OrderEvent event) { }
```

### 定时任务入口

```java
@Scheduled(cron = "0 0 2 * * ?")
public void dailyBillingJob() { }

@XxlJob("orderSyncHandler")
public void syncOrders() { }
```

### RPC 入口

```java
@DubboService
public class OrderServiceImpl implements OrderService { }

@FeignClient(name = "order-service")
public interface OrderClient { }
```

## 数据访问模式

### MyBatis

**Mapper 接口**：
```java
@Mapper
public interface OrderMapper {
    Order selectById(Long id);
    int insert(Order order);
}
```

**XML 映射**：
```xml
<select id="selectById" resultType="Order">
    SELECT * FROM orders WHERE id = #{id}
</select>
```

### JPA

```java
public interface OrderRepository extends JpaRepository<Order, Long> {
    List<Order> findByStatus(OrderStatus status);

    @Query("SELECT o FROM Order o WHERE o.userId = :userId")
    List<Order> findByUserId(@Param("userId") Long userId);
}
```

## 事务模式

### 声明式事务

```java
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    inventoryService.deduct(order.getItems());
}

@Transactional(rollbackFor = Exception.class)
public void processPayment(Payment payment) { }

@Transactional(propagation = Propagation.REQUIRES_NEW)
public void logOperation(OperationLog log) { }
```

### 事务边界识别

- `@Transactional` 标注的方法是事务边界
- 注意 `propagation` 属性影响事务传播
- 自调用不会触发事务（需要通过代理调用）

## 缓存模式

### Spring Cache

```java
@Cacheable(value = "orders", key = "#id")
public Order getOrderById(Long id) { }

@CacheEvict(value = "orders", key = "#order.id")
public void updateOrder(Order order) { }

@CachePut(value = "orders", key = "#order.id")
public Order saveOrder(Order order) { }
```

### Redis 直接操作

```java
@Autowired
private RedisTemplate<String, Object> redisTemplate;

public void cacheOrder(Order order) {
    redisTemplate.opsForValue().set("order:" + order.getId(), order, 1, TimeUnit.HOURS);
}
```

## 异步模式

### @Async

```java
@Async
public CompletableFuture<Result> asyncProcess(Request request) { }

@Async("customExecutor")
public void asyncNotify(Notification notification) { }
```

### 消息驱动

```java
@Autowired
private RabbitTemplate rabbitTemplate;

public void sendOrderCreatedEvent(Order order) {
    rabbitTemplate.convertAndSend("order.exchange", "order.created", order);
}
```

## 配置模式

### 配置属性

```java
@ConfigurationProperties(prefix = "app.order")
public class OrderProperties {
    private int maxRetryTimes;
    private Duration timeout;
}
```

### 条件配置

```java
@ConditionalOnProperty(name = "app.feature.enabled", havingValue = "true")
@Configuration
public class FeatureConfig { }
```

## 常见问题模式

### 循环依赖

**症状**：启动时报循环依赖错误
**原因**：A 依赖 B，B 依赖 A
**解决**：`@Lazy`、重构、使用 setter 注入

### N+1 查询

**症状**：查询列表时产生大量 SQL
**原因**：在循环中查询关联数据
**解决**：使用 JOIN 查询、批量查询

### 事务失效

**症状**：数据未回滚
**原因**：自调用、异常被吞、非 public 方法
**解决**：通过代理调用、正确抛出异常
