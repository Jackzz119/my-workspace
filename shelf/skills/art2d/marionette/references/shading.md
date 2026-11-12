# 阴影：活物身上的明暗与它投在别处的影子（分支能力）

生成的平面图常常光对了、里面却是平的：下巴和胸口连成一片、毛是一整张、坐在家具上像贴纸。这一支补的就是这些。

**一句话**：跟光无关、跟着画走的（毛缝）**导出时烘焙**进每一帧；跟光和姿势有关的（一个部位投在另一个部位上的影子、
部位投在家具上的影子、角色挡掉的环境光）**运行时每帧**从网格当下的形状算。

## 为什么不全靠 shader 按光的方向算

| 做法 | 问题 |
| --- | --- |
| 从画里推法线 / 高度（Laigter、SpriteIlluminator 的 bevel + emboss），每像素 N·L | 毛发上一照就像塑料；亮度当高度会把白底上的灰斑读成坑；2D 光的高度只有「掠射」到「正面」，照不出从画面后方来的光（Godot 2D light 的 height 0–1） |
| 深度 / 法线模型（Depth Anything V2、Marigold、StableNormal）、重打光模型（IC-Light） | 没在画出来的毛上验证过；重打光是重画像素，帧和帧之间会漂，五张嘴的哈欠一换图就跳；许可证要逐个看（DSINE 不能商用） |
| 每种光、每个姿势烘焙一张阴影图 | 头一转、一打哈欠，烘在胸口上的下巴影子还留在原地 |
| **混合**（本支） | 不依赖光的烘焙、随网格走；依赖光和姿势的每帧算，跟着头走、跟着灯走 |

## 一、烘焙：毛缝（`scripts/shade.py`，export 时做）

在**对数亮度**上做带通（`fine` 减 `coarse` px 的高斯，两次模糊都按 alpha 归一化，轮廓不会被当成缝）：比它所在那团毛更暗的地方，
按 `strength` 再暗一点，最暗到 `floor`。线性光里乘，alpha 不动。三处不碰：

- **斑块交界**：白到灰是颜料，不是缝。在粗模糊的梯度上认出交界（`EDGE`），那里不加深
- **`skip` 框**：眼睛、鼻子、嘴——它们的暗线是画出来的结构，不是深度
- **透明处**

```json
"shade": { "fine": 5, "coarse": 24, "strength": 1.5, "floor": 0.8, "skip": [[600, 445, 850, 548], [650, 560, 815, 750]] }
```

- 尺度按**毛团**定，不按像素定：`fine` / `coarse` 是画布 px，要落在一团毛的宽度上（Shadou 画布 1024、显示约 0.4 倍：5 / 24）。
  太细（2.5 / 9）只加深灰斑里的细毛，白毛上几乎看不出——在显示尺寸上比，不在原图上比
- `python shade.py <in.png> <out.png> --sheet <sheet.jpg> --crop …` 出「原图｜乘子｜结果」三联，先在一张上调好再写进 `rig.json`
- **第 1 条铁律的例外**：这是流水线唯一改像素颜色的地方，所以划得很窄——只加深画里已有的暗缝，不加新东西、不移动、不改形状；
  每一帧同一组参数（同一处毛得到同一个乘子，溶解时不闪）；删掉 `shade` 就整体关掉。光流和权重在没加深的帧上量，加深不移动任何东西
- export 给清单里的每个文件名加内容哈希（`?v=`）：图名不变、内容变了，CDN 和浏览器也会重新拿（Cloudflare 默认让浏览器缓存 4 小时）

## 二、运行时：部位投在身上的影子（下巴、尾巴）

**每帧的轮廓**：每个姿势一张小图 = 这张画的 alpha × 投影部位的权重（头、尾巴；权重和网格变形用的是同一套多边形与渐变），
用这个姿势**自己的网格**（共享 geometry）画——头转、头抬、嘴张开，它都跟着；每帧画进一张 1/4 分辨率的离屏图。

**在角色自己的受光滤镜里**，把屏幕坐标换回画布坐标，取这张图：

```glsl
near  = max(0, soft(q - o, r) - soft(q, r));              // 轮廓往背光方向推 o，减去轮廓自己：下巴下面那一带
wide  = max(0, soft(q - 1.8 * o, 2.4 * r) - soft(q, 2.4 * r)); // 更远、更软、更淡：影子离开投影物越远越宽
light *= 1 - min(fur * (k * near + k * wideShare * wide), cap); // fur：本来就暗的毛少压一点
```

- `soft(q, r)`：九个点取平均（中心加重）；离屏图本身的低分辨率再给一层双线性柔化
- `o`：远离光源（光从后上方来：主要往下，向背光侧偏一点）；强度 `k` = 窗和房间的底（灯关了也有）+ 灯的份额 × 灯亮多少
- Shadou 的数（画布 px）：`side 8, drop 26, blur 14, wideBlur 34, floor 0.28, lamp 0.22, wide 0.5, cap 0.42`
- **为什么是「推开的轮廓减去轮廓自己」**：试过两种都错——
  ① 「轮廓外才收影子」的硬切：沿部位的多边形画出一条线；
  ② 不推开、各向同性地模糊一圈当接触阴影：整个头外面一圈灰，像描了边。
  相减的写法两边都软，影子从下颌底下渐渐长出来，侧面竖直的边推下去还在自己身上，所以不会在脸颊外画线

**PixiJS v8**：`new Mesh({ geometry: poseMesh.geometry, texture: casterTexture })`、混合 `add`（溶解时份额相加）、
`alpha` / `visible` 每帧照抄姿势网格；`RenderTexture.create({ width, height, resolution: 0.25 })`，在 step 里
`renderer.render({ container: casters, target, clear: true })`（在这一帧主渲染之前）；离屏图作为滤镜的纹理资源；
屏幕 → 画布的矩阵用 `toGlobal` 取三个点算，求逆后传两个 uniform。

## 三、运行时：部位投在家具上的影子（垂在毯子上的尾巴）

这个部位的轮廓（根以下、部位范围内的 alpha），两遍盒式模糊，做成**和画同尺寸**的纹理，用**同一个网格**画、往背光方向挪几 px：
尾巴摆，影子跟着摆。角色的图层有滤镜时，影子在滤镜里用**黑色 + alpha**（普通混合下等于乘 1 − alpha）——
`multiply` 在滤镜里不起作用（滤镜的那张图起点是透明的）。窗边的猫：alpha 0.4，往右下挪 (4, 2) px，模糊 3 px。

## 四、它挡掉的环境光（坐在被窗照亮的毯子上的猫）

角色坐在被某种光照亮的面上，它身前那一块应该在它的影子里。gaffer 的 `shade` 按每张底图量：被挡的那块应该像旁边
同样材质、那种光照不到的那块（比值，sRGB 乘子）。运行时一层 `multiply`，放在角色图层**下面、外面**（理由同上），
跟着角色淡入淡出、换姿势时让位。

## 五、验收

- 显示尺寸上前后对比，再放大看下巴和毛
- 动起来看：哈欠（头抬、嘴张）、被摸（头歪）的几帧，影子跟着走、不在原地
- 开灯 / 关灯、最暗和最亮的底图都看；影子不该比画里本来的暗处还黑
- 120 fps 量一遍（SKILL.md 第 9 步）：影子来自同一套网格，不该多出小跳

## 来源

Laigter（normal map generation）· SpriteIlluminator effects · Godot 2D lights and shadows · Unity URP ShadowCaster2D ·
Live2D Cubism clipping mask · W3C filter-effects drop-shadow · Tatarchuk, Parallax Occlusion Mapping（软自阴影）·
Luft et al. 2006, Image Enhancement by Unsharp Masking the Depth Buffer · He et al., Guided Image Filtering ·
Depth Anything V2 · Marigold · IC-Light · PaintingLight（2026-11-11 的调研，见项目的对应报告）
