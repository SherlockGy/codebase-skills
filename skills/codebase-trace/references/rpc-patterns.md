# RPC 接口识别模式

## HTTP 接口

### RestTemplate

```java
// GET 请求
restTemplate.getForObject(url, ResponseType.class);
restTemplate.getForEntity(url, ResponseType.class);

// POST 请求
restTemplate.postForObject(url, request, ResponseType.class);
restTemplate.postForEntity(url, request, ResponseType.class);

// 通用请求
restTemplate.exchange(url, HttpMethod.GET, entity, ResponseType.class);
```

**识别模式**：`RestTemplate\.(get|post|put|delete|exchange)`

### WebClient (Spring WebFlux)

```java
webClient.get().uri(url).retrieve().bodyToMono(Type.class);
webClient.post().uri(url).bodyValue(request).retrieve().bodyToMono(Type.class);
```

**识别模式**：`WebClient\.(get|post|put|delete|patch)\(\)`

### Feign Client

```java
@FeignClient(name = "order-service", url = "${order.service.url}")
public interface OrderServiceClient {
    @GetMapping("/orders/{id}")
    Order getOrder(@PathVariable Long id);
}
```

**识别模式**：`@FeignClient`

---

## Thrift RPC

### 标准 Thrift

```java
// 创建客户端
TTransport transport = new TSocket("localhost", 9090);
TProtocol protocol = new TBinaryProtocol(transport);
OrderService.Client client = new OrderService.Client(protocol);

// 调用方法
Order order = client.getOrder(orderId);
```

**识别模式**：`new \w+Service\.Client\(`

### 企业封装变体（常见于大型公司）

```java
// 模式 1: XxxHelper.XxxClient
UserHelper.UserClient userClient = UserHelper.getUserClient();
Order order = userClient.getOrder(orderId);

// 模式 2: XxxServiceHelper.getClient()
OrderServiceHelper helper = new OrderServiceHelper();
OrderService.Client client = helper.getClient();

// 模式 3: 工厂模式
ThriftClientFactory.create(OrderService.Client.class);
```

**识别模式**：
- `\w+Helper\.\w+Client`
- `\w+ServiceHelper\.getClient\(\)`
- `ThriftClientFactory\.create\(`

### Thrift IDL 定义

```thrift
service OrderService {
    Order getOrder(1: i64 orderId),
    void createOrder(1: Order order),
}
```

---

## gRPC

### 同步调用

```java
// 创建 stub
ManagedChannel channel = ManagedChannelBuilder.forAddress("localhost", 9090).build();
OrderServiceGrpc.OrderServiceBlockingStub stub = OrderServiceGrpc.newBlockingStub(channel);

// 调用方法
OrderResponse response = stub.getOrder(request);
```

**识别模式**：`\w+Grpc\.new(Blocking|Future|)Stub\(`

### 异步调用

```java
OrderServiceGrpc.OrderServiceFutureStub futureStub = OrderServiceGrpc.newFutureStub(channel);
ListenableFuture<OrderResponse> future = futureStub.getOrder(request);
```

---

## Dubbo RPC

### 注解方式

```java
// 服务消费者
@DubboReference(version = "1.0.0", timeout = 3000)
private OrderService orderService;

// 旧版本注解
@Reference(version = "1.0.0")
private OrderService orderService;
```

**识别模式**：`@DubboReference|@Reference`

### XML 配置方式

```xml
<dubbo:reference id="orderService" interface="com.example.OrderService" />
```

### API 方式

```java
ReferenceConfig<OrderService> reference = new ReferenceConfig<>();
reference.setInterface(OrderService.class);
OrderService orderService = reference.get();
```

**识别模式**：`ReferenceConfig<`

---

## 消息队列（准 RPC）

### RabbitMQ

```java
// 发送消息
rabbitTemplate.convertAndSend(exchange, routingKey, message);

// RPC 模式
Object response = rabbitTemplate.convertSendAndReceive(exchange, routingKey, request);
```

**识别模式**：`rabbitTemplate\.convert(AndSend|SendAndReceive)`

### Kafka

```java
// 发送消息
kafkaTemplate.send(topic, message);

// 带回调
kafkaTemplate.send(topic, message).addCallback(callback);
```

**识别模式**：`kafkaTemplate\.send\(`

### RocketMQ

```java
// 同步发送
rocketMQTemplate.syncSend(topic, message);

// 异步发送
rocketMQTemplate.asyncSend(topic, message, callback);
```

**识别模式**：`rocketMQTemplate\.(sync|async)Send\(`

---

## 敏感度评估

| 协议 | 敏感度 | 说明 |
|------|--------|------|
| Thrift/gRPC | 高 | 内部服务调用，可能涉及核心业务 |
| Dubbo | 高 | 通常是核心业务服务 |
| Feign | 中-高 | 取决于调用的服务 |
| RestTemplate | 中 | 可能是外部 API 或内部服务 |
| 消息队列 | 中 | 异步处理，需要关注消息丢失风险 |

---

## 代码搜索命令

```bash
# 搜索所有 RPC 调用
grep -rE "(RestTemplate|WebClient|@FeignClient|@DubboReference|@Reference|\.Client\(|Grpc\.|rabbitTemplate|kafkaTemplate|rocketMQTemplate)" --include="*.java"

# 搜索 Thrift 企业封装
grep -rE "\w+Helper\.\w+Client|\w+ServiceHelper" --include="*.java"

# 搜索 gRPC
grep -rE "Grpc\.(newBlockingStub|newFutureStub|newStub)" --include="*.java"
```
