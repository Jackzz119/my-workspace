# mention 派活：语法、坑与回执

规则（什么时候必须 mention、先写描述再 assign、发完核回执）在 Multica 协议 §十二，这里是语法、UUID 来源与排障细节，发任何 mention 之前读。

## 语法：链接目标必须是真 UUID

    [@显示名](mention://<type>/<uuid>)

**方括号里的名字是给人看的，括号里的 UUID 才是路由依据。** UUID 一律现场查，不要凭记忆写：

| 目的 | type | UUID 来源 | 后端行为 |
| --- | --- | --- | --- |
| **触发某个 agent** | `agent` | `multica agent list --output json` 的 `id` | **给该 agent 排一个 run** |
| 交给 squad | `squad` | `multica squad list --output json` 的 `id` | 解析出 leader，**给 leader 排 run** |
| 关联到人 | `member` | `multica workspace member list --output json` 的 `user_id` | 只渲染链接，**不排 run** |
| 引用 issue | `issue` | issue 的 `id` | 只渲染链接，不排 run |

## 三个会让 mention 静默失效的坑

1. **写名字不写 UUID**——`mention://agent/<显示名>` 是死链，正则匹配失败，**彻底的静默无操作**，没有任何报错。
2. **UUID 形状对但不存在**——解析成功然后查库落空，报 `blocked` + `invocation_not_allowed`。这个码**和权限拒绝一模一样**，看到它先怀疑自己抄错了 UUID。
3. **`@all` 会压掉隐式路由**——`[@all](mention://all/all)` 是广播，会**抑制 issue assignee 的自动触发**。要请人干活就别只发 `@all`；同一条评论里的显式 `@agent` 仍然生效。

## 发完要看回执

创建评论的响应里有 `trigger_outcomes`，**那是唯一能看到 mention 有没有生效的地方**：

- 没出现在数组里 = 压根没解析成功（多半是坑 1）
- `blocked` + `reason_code` = 解析了但被拒（多半是坑 2）
- `coalesced` / `deferred` = 对方正忙，这次触发并进了它手上的任务——但正在跑的 run 可能早就读完了评论，**不保证读得到这条**
- `queued` = 排在对方活 run 后面，活 run 结束后**会再起一个 run**；也可能随后被平台合并掉（`cancelled`）
- **回执为空（`{}`）也可能是被去重了**：对方在同一条 issue 上有活 run 时，`status` 翻转和普通评论都不会排新 run，也不报错

协议里「先写进 issue 描述再 assign、评论里别再 @ 同一个 agent」那条，依据就是上面 `coalesced` / `deferred` 与去重这几种情况：assign 起的 run 一定读得到描述，补充的评论却可能读不到。

## 重新触发、去重与并行

- 重新触发首选 `multica issue rerun`；对同一个 agent 重复 assign 是静默的空操作；CLI 没有取消 task 的命令。
- 去重只发生在同一 agent × 同一 issue，不同 issue 的 run 会并行。
