# 领域术语识别模式

## 识别规则

### 1. 类名中的业务词汇

**提取模式**：
- `OrderService` → `Order`（订单）
- `BillingCycle` → `Billing`, `Cycle`（账单、周期）
- `PaymentGateway` → `Payment`, `Gateway`（支付、网关）

**排除的技术后缀**：
- Service, Controller, Repository, Mapper
- DTO, VO, Entity, Model
- Config, Properties, Constants
- Handler, Listener, Processor

### 2. 字段名中的业务词汇

**驼峰命名解析**：
- `orderStatus` → `order`, `status`
- `billingPeriod` → `billing`, `period`
- `tradeAmount` → `trade`, `amount`

**常见业务字段模式**：
- `*Status`, `*State` → 状态枚举
- `*Amount`, `*Price` → 金额
- `*Time`, `*Date` → 时间
- `*Id`, `*No`, `*Code` → 标识

### 3. 注释中的中文术语

**匹配模式**：
```java
/**
 * 账期计算服务
 * 用于处理账单周期相关的业务逻辑
 */
```

提取：`账期`, `账单`, `周期`

### 4. 枚举值

**示例**：
```java
public enum OrderStatus {
    CREATED,      // 已创建
    PAID,         // 已支付
    SHIPPED,      // 已发货
    COMPLETED,    // 已完成
    CANCELLED     // 已取消
}
```

提取：`已创建`, `已支付`, `已发货`, `已完成`, `已取消`

## 金融/账务领域常见术语

| 术语 | 英文 | 常见代码位置 |
|------|------|-------------|
| 账期 | billing period | BillingCycle, BillingPeriod |
| 账单 | bill, invoice | Bill, Invoice |
| 冲正 | reversal | Reversal, Reverse |
| 对账 | reconciliation | Reconcile, Reconciliation |
| 清算 | settlement, clearing | Settlement, Clearing |
| 分账 | split payment | Split, Allocation |
| 挂账 | pending, suspend | Pending, Suspend |
| 核销 | write-off, verification | WriteOff, Verify |
| 应收 | receivable | Receivable, AR |
| 应付 | payable | Payable, AP |
| 余额 | balance | Balance |
| 流水 | transaction log | TransactionLog, Flow |
| 凭证 | voucher | Voucher |

## 电商领域常见术语

| 术语 | 英文 | 常见代码位置 |
|------|------|-------------|
| 订单 | order | Order |
| 商品 | product, item | Product, Item, Goods |
| 库存 | inventory, stock | Inventory, Stock |
| 购物车 | cart | Cart, ShoppingCart |
| 优惠券 | coupon | Coupon |
| 促销 | promotion | Promotion, Campaign |
| 运费 | freight, shipping | Freight, Shipping |
| 退款 | refund | Refund |
| 售后 | after-sale | AfterSale |
| 物流 | logistics | Logistics |

## 术语关系模式

### 层级关系

```
账期 (BillingPeriod)
  └── 账单 (Bill)
      └── 账单明细 (BillItem)
          └── 交易 (Transaction)
```

### 状态流转

```
订单状态流转：
CREATED → PAID → SHIPPED → COMPLETED
    ↓        ↓
CANCELLED  REFUNDING → REFUNDED
```

### 操作关系

```
交易 (Transaction)
  ├── 冲正 (Reversal) — 逆向操作
  ├── 对账 (Reconciliation) — 核对操作
  └── 清算 (Settlement) — 结算操作
```

## 术语发现启发式规则

1. **出现频率**：在代码中出现 3 次以上的业务词汇
2. **上下文一致性**：在注释和代码中含义一致
3. **非通用词汇**：排除 `data`, `info`, `detail` 等通用词
4. **领域相关性**：与项目主要业务领域相关
