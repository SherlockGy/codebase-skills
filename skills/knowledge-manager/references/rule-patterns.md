# 规则识别模式

## 识别信号

### 1. 条件判断中的业务约束

**代码模式**：
```java
if (refundAmount > order.getTotalAmount()) {
    throw new BusinessException("退款金额不能超过订单金额");
}

if (order.getStatus() != OrderStatus.PAID) {
    throw new IllegalStateException("只有已支付订单才能退款");
}

if (inventory.getStock() < quantity) {
    throw new InsufficientStockException("库存不足");
}
```

**提取的规则**：
- 退款金额限制：退款金额不能超过原订单金额
- 退款前置条件：只有已支付订单才能退款
- 库存约束：下单数量不能超过库存

**搜索模式**：
```
grep -r "throw new.*Exception" --include="*.java"
grep -r "if.*>.*throw" --include="*.java"
grep -r "if.*!=.*throw" --include="*.java"
```

### 2. 注释中的业务说明

**代码模式**：
```java
/**
 * 超时30分钟自动取消
 */
@Scheduled(cron = "0 */5 * * * ?")
public void cancelTimeoutOrders() { }

// 订单创建后24小时内可以取消
public void cancelOrder(Long orderId) { }

/*
 * 每日凌晨2点执行账单生成
 * 账期为自然月
 */
@Scheduled(cron = "0 0 2 * * ?")
public void generateBills() { }
```

**提取的规则**：
- 订单超时取消：创建后30分钟未支付自动取消
- 订单取消时限：订单创建后24小时内可以取消
- 账单生成时间：每日凌晨2点生成账单
- 账期定义：账期为自然月

**搜索模式**：
```
grep -r "超时\|自动取消\|之内\|之后\|每.*执行" --include="*.java"
grep -rB2 "@Scheduled" --include="*.java"
```

### 3. 常量定义

**代码模式**：
```java
public static final int ORDER_TIMEOUT_MINUTES = 30;
public static final int MAX_RETRY_TIMES = 3;
public static final BigDecimal MIN_PAYMENT_AMOUNT = new BigDecimal("0.01");
public static final int BILLING_DAY = 1;  // 每月1号出账
private static final double MAX_DISCOUNT_RATE = 0.5;  // 最大折扣50%
```

**提取的规则**：
- 订单超时时间：30分钟
- 最大重试次数：3次
- 最小支付金额：0.01元
- 出账日：每月1号
- 最大折扣率：50%

**搜索模式**：
```
grep -r "static final.*=" --include="*.java" | grep -i "timeout\|max\|min\|limit\|day"
```

### 4. 枚举状态定义

**代码模式**：
```java
public enum OrderStatus {
    CREATED,      // 已创建
    PAID,         // 已支付
    SHIPPED,      // 已发货
    COMPLETED,    // 已完成
    CANCELLED,    // 已取消
    REFUNDING,    // 退款中
    REFUNDED      // 已退款
}

public enum PaymentStatus {
    PENDING,      // 待支付
    SUCCESS,      // 支付成功
    FAILED,       // 支付失败
    CLOSED        // 已关闭
}
```

**提取的规则**：
- 订单状态流转：CREATED → PAID → SHIPPED → COMPLETED
- 订单可取消：CREATED 和 PAID 状态可以取消
- 支付状态流转：PENDING → SUCCESS/FAILED/CLOSED

**搜索模式**：
```
grep -rA20 "enum.*Status" --include="*.java"
grep -rA20 "enum.*State" --include="*.java"
```

### 5. 验证注解

**代码模式**：
```java
@NotNull(message = "订单ID不能为空")
private Long orderId;

@Min(value = 1, message = "数量至少为1")
@Max(value = 99, message = "单次购买不能超过99件")
private Integer quantity;

@Size(min = 6, max = 20, message = "密码长度6-20位")
private String password;

@Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
private String phone;
```

**提取的规则**：
- 订单ID必填
- 购买数量：1-99件
- 密码长度：6-20位
- 手机号格式：中国大陆手机号

**搜索模式**：
```
grep -r "@NotNull\|@Min\|@Max\|@Size\|@Pattern" --include="*.java"
```

### 6. 配置文件中的业务参数

**配置模式**：
```yaml
# application.yml
order:
  timeout-minutes: 30
  max-items-per-order: 100

payment:
  min-amount: 0.01
  max-amount: 100000

billing:
  period: MONTHLY
  generate-day: 1
```

**提取的规则**：
- 订单超时：30分钟
- 单笔订单最大商品数：100
- 支付金额范围：0.01 - 100000
- 账期：月度
- 出账日：每月1日

**搜索模式**：
```
grep -r "timeout\|max\|min\|limit\|period" application*.yml
```

## 规则类型分类

| 类型 | 说明 | 典型示例 |
|------|------|----------|
| **业务规则** | 业务逻辑约束 | 订单超时30分钟自动取消 |
| **数据约束** | 数据完整性规则 | 退款金额不能超过原订单金额 |
| **流程规则** | 状态流转约束 | 订单状态只能正向流转 |
| **时间规则** | 时间相关约束 | 每日凌晨2点生成账单 |
| **权限规则** | 操作权限约束 | 只有管理员可以调整价格 |
| **技术约束** | 技术层面的限制 | 接口幂等性要求 |

## 规则优先级

识别规则时，按以下优先级判断可信度：

| 优先级 | 来源 | 可信度 |
|--------|------|--------|
| 1 | 异常消息中的约束 | 高 — 是实际执行的规则 |
| 2 | 注释中的说明 | 中高 — 开发者的意图 |
| 3 | 常量定义 | 中 — 可能是配置参数 |
| 4 | 方法名暗示 | 低 — 需要确认含义 |

## 规则关系模式

### 前置条件

```
规则A 是 规则B 的前置条件

示例：
- 「支付成功」是「发货」的前置条件
- 「库存充足」是「下单成功」的前置条件
```

### 触发关系

```
规则A 触发 规则B

示例：
- 「退款成功」触发「库存回补」
- 「订单取消」触发「优惠券返还」
```

### 互斥关系

```
规则A 与 规则B 互斥

示例：
- 「已完成」与「退款中」互斥
- 「已取消」与「已发货」互斥
```

## 金融/账务领域常见规则

| 规则类型 | 典型规则 | 识别信号 |
|----------|----------|----------|
| 金额限制 | 单笔交易上限 | `MAX_AMOUNT`, `limit` |
| 余额校验 | 不允许负余额 | `balance < 0`, `InsufficientBalanceException` |
| 冲正规则 | 原交易必须存在且成功 | `reversal`, `original transaction` |
| 对账规则 | T+1 对账 | `reconcile`, `T+1` |
| 清算规则 | D+0/T+1 清算 | `settle`, `clearing` |

## 电商领域常见规则

| 规则类型 | 典型规则 | 识别信号 |
|----------|----------|----------|
| 库存规则 | 下单扣库存/支付扣库存 | `deduct`, `reserve`, `stock` |
| 优惠规则 | 满减、折扣、优惠券 | `discount`, `coupon`, `promotion` |
| 运费规则 | 满额免运费 | `freight`, `shipping`, `free shipping` |
| 退款规则 | 签收后7天可退 | `refund`, `return`, `7天` |
| 评价规则 | 确认收货后可评价 | `comment`, `review`, `rate` |
