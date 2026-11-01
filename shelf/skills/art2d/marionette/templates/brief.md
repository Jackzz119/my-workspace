# 姿势图生成 brief（模板）

> 复制后把 `<…>` 换成本人物的值。「不变量」一段原样放进**每一张**的 prompt。

## 这是什么

生产素材，不是概念图：这些透明姿势图会原地叠放、由 2D 引擎切换和变形，组成会动的人物 <人物名>。
**姿势之间的一致性比任何单张的好看更重要**：身体、脸、比例的任何漂移，切换时都看得见。

## 依据

- 人物设定：<设定文档 / 角色表路径>（身份：<发型、发色、眼睛、标志物、衣服>）
- 画风锁：<画风描述，不点名画师或工作室>
- 已定稿画面（如有）：<场景图路径>——人物在里面的样子就是 anchor 的标准，出图前先看它

## 不变量（每张 prompt 原样复制）

Production transparent RGBA sprite, exactly <W>x<H> px, genuine transparent background (alpha 0 outside the
figure; no painted checkerboard, no solid backdrop, no glow, no cast shadow outside the figure). Single
<character> only: no table, chair, room, props other than the stated ones, other people, text or frame.
<Framing: centred at x=<cx>; top of hair at about y=<top>; shoulder silhouette about x=<x0> to x=<x1>.>
<Seated behind an invisible table: the torso is hidden below a perfectly horizontal cut at y=<cut_y, measured: the table's far edge on the scene converted through the anchor's registration>;
forearms, hands and held objects may rest on the invisible tabletop and extend to about y=<cut_y+100>.>
Shoulders, chest and the torso cut stay at exactly the same place and scale as the anchor; only head,
arms, hands, face and the stated props may change. Soft, even, slightly warm front-left light with gentle
form shading; no strong coloured rim light. Clean anti-aliased hair edges, no halo. <Style lock>.

## 文件（按顺序出）

| #   | 文件                       | 输入              | 内容                                                 |
| --- | -------------------------- | ----------------- | ---------------------------------------------------- |
| 1   | `<id>-<anchor>-open.png`   | 定稿画面 + 角色表 | anchor：<描述>。单独验收后再继续                     |
| 2   | `<id>-<anchor>-closed.png` | 1                 | 只把眼睛改成轻闭的眼睑，其余全部不变                 |
| 3   | `<id>-<pose>-open.png`     | 1                 | 以 1 为底编辑：只改 <部位>，<描述>                   |
| 4   | `<id>-<pose>-closed.png`   | 1 + 3             | 3 的闭眼版，只改眼睑                                 |
| …   |                            |                   |                                                      |
| n   | `<id>-<big-move>.png`      | 1                 | 大动作（如趴睡）：允许肩线变化，截断线仍在 y=<cut_y> |

闭眼帧 prompt 末尾追加：
`BLINK FRAME: change ONLY the eyes to gently closed relaxed eyelids. Keep every other pixel — glasses, eyebrows,
mouth, face outline, every hair strand, head angle, shoulders, arms, hands, props — unchanged. Do not reposition anything.`

## 验收与报告

逐张与 anchor 50% 叠图对照：肩膀、截断线、比例对齐；明显漂移的只重出那一张（原稿加 `-initial` 后缀保留）。
交一份报告：每张的尺寸、透明像素数、主体包围盒、固定几列（x=<probes>）的肩线漂移、截断线实测位置、
闭眼帧眼外变化、可见缺陷（手指、眼镜、发丝边缘）、重出了几版、选哪版及理由。报告用 <语言>。
