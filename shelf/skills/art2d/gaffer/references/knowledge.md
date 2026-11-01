# 2D 光照知识库

做 2D 场景光时可以查的原理和技法，每条注明什么时候用、什么时候别用、离线能用的实现。
标「推导」的是工程推论，没有单一文献直接支持，用前实测。新学到的东西加在对应小节，附来源。

## 原理

1. **光在线性空间里相加、相乘** [19]。混合、模糊、光照都用线性值算，最后一步再回 sRGB；在 gamma 空间里算，中间调偏暗、阴影过渡偏硬、颜色偏。
2. **比值迁移是 differential rendering 的图像版** [22]：只把「有物件 / 没物件」两次的光照差加回原图，局部反射率粗略也行。
   前提是物件和量光的地方受到同样的入射光变化（漫反射、朝向相近、无自遮挡）；顶面和立面、高光、物件自己的影子要另补。
3. **颜色 F 只装物件自己的颜色** [4]。物件和新背景之间的互动（包边光、溢色、影子）在合成时从目标图生成 [16]，不烘焙进 F。
4. **合成用预乘 alpha** [18]：Porter–Duff 运算只在预乘下简单，重打光和混合都在预乘值上做。
5. **光源是加性层** [48]：开关、闪烁、泛光都是缩放「灯的贡献」，不是把整张图调亮。
6. **夜景不等于调暗** [38]：降亮度和对比、去饱和、蓝移，可加一点可见噪点。暖光源（蜡烛约 1850 K、白炽 2400 K）对冷环境（6500 K）的反差是夜景气氛的主体 [36]。
7. **插进去的东西要接地** [44]：接触阴影在贴地处最暗最硬，向外变软；半影宽度 ≈ (d_受体 − d_遮挡)·光源宽 / d_遮挡。
8. **闪烁要克制** [43]：大面积亮度变化每秒不超过 3 次；闪烁只作用在光源层上。

## 切边与前景色

| 技法 | 解决什么 | 用 / 不用 | 实现 |
|---|---|---|---|
| trimap + 求解 α | 阈值比差边缘锯齿 [7] | 比差只用来分「确定前景 / 确定背景 / 未知带」，未知带交给 closed-form matting [5] | pymatting（MIT）[2]，CPU 秒级 |
| blur-fusion 前景色 | 反解 F 放大 α 误差 | 已知背景时首选；α 大块错时救不回 | Photoroom fast-foreground-estimation [4]，可传入已知背景 |
| multi-level 前景色 | 同上 | 不接受已知背景，作对照 | pymatting `estimate_foreground_ml` [1][3] |
| guided filter 精修 α | matte 不贴细结构 | diff 已较准、只差贴边时 | opencv-contrib `ximgproc` [6] |
| despill | 背景色溢到边上 | 只作用在边带；分不清物件本来的颜色和溢色 [14] | 手写：Nuke 式通道限幅 + 自适应 k（推导） |
| edge extend | 软边颜色被背景污染 | 边带 F 换成从内部延展的颜色，α 不动 | Nuke EdgeExtend [15]、Photoshop Decontaminate [17]、rembg `-dc` [13] |
| triangulation matting | 精确解 α 和 F | 同一物件在两张「处处不同」的背景前各一张、逐像素一致才行 [8]；AI 出图难保证 | — |
| 学习模型 | 单图找物体 | ViTMatte（trimap 输入，MIT）[10] 可接在 trimap 后；MODNet / BiRefNet / rembg 不用已知背景、软边弱，只适合给 trimap 打初值 [11][12][13]；BackgroundMattingV2 用干净背景但在人像上训练 [9] | — |

## 光照

- **本征分解**（albedo × shading）：换 shading 即重打光。Careaga & Aksoy 的 Intrinsic 输出线性分量，仅限学术 [23][24]；只拿来诊断，不进管线（许可、照片域）。
- **法线贴图 2D 光**：解决比值迁移做不到的**会移动的光源**（角色提的灯）。法线来源：Sprite Lamp 用 2–5 张手绘方向光合成 [31]，Laigter（GPL-3）自动生成 [32]，SpriteIlluminator 从透明度浮雕 [33]。
  Godot 的 light height 默认太低几乎看不出 [29]；Unity URP 2D 在 secondary texture 登记 `NormalMap` [30]。静态底图之间的切换不用它（比值迁移更准）；自动法线在手绘上易显塑料感（推导）。
- **衰减**：平方反比加窗口让光在半径处平滑归零 `att = saturate(1−(d/r)^4)^2 / (d²+ε)` [35]（LYGIA 有 MIT 实现 [35b]）；色温转 RGB 用 colour-science `CCT_to_xy` [37]。
- **包边光**（light wrap）：把背景的光包到前景边上，用于亮背景前的物件 [16]。亮窗前的物件边应由**当前底图**生成，不是留着抠像残留的蓝边（推导）。
- **颜色迁移**：Reinhard（lαβ 均值方差）[25]、直方图匹配 `skimage.exposure.match_histograms` [27]、color-matcher（GPL-3）[26]。只在基准底图上一次性把新物件的色板拉向场景，不代替逐状态打光。
- **LUT 调色**：全局 3D LUT 便宜（PixiJS 有 ColorMapFilter [34]），适合没有底图可量的东西（UI、整体氛围），没有空间信息。
- **泛光**：在线性值上对发光遮罩取阈值、降采样再升采样加回；dual filter（Kawase 派生）带宽最省 [39]，时间稳定见 [40]。底图里已画了光晕的，泛光只加在叠加层上（推导）。

## 光源闪烁

- Quake 的 lightstyle 每秒 10 个字符，'m' 为正常亮度：FLICKER 只在 m–q 间（约 +0–33%），读起来是安静的火；CANDLE 会掉到全黑，是风里的火 [41]
- 浮力火焰闪烁频率 ∝ 直径^(−1/2)：火越大闪得越慢 [42]
- 落地（推导）：亮度 = 1 + A·(0.3–2 Hz 低频噪声 + 小权重 4–10 Hz)。安静 A≈3–8%；紧张 A≈15–30%、偶有 100–200 ms 下沉。变暗时略降色温、光晕半径同比缩放；闪烁乘在线性的灯层上

## 切光过渡

- **一个时钟**：依赖同一种光的所有层（底图、物件的各状态版本、活物的光、光源叠加层）读同一个进度 t，不各开各的补间（推导）。
- **不透明底图**：旧图 α=1 在下，新图 α=t 盖上；两层反向淡化中途会透底、变暗 [20]。也可用加法（plus-lighter）分别乘 (1−t)、t [20]。
- **带 α 的物件**：在一个 shader 里混合两版预乘纹理再盖上去；不要用普通混合把两个半透明版本叠着淡（推导，Porter–Duff 线性性 [18]）。
  引擎里一个容器装着叠放的几层时，容器透明度会分别乘进每层，下层会透出来：用整层渲染再淡（`runtime.md`「整层淡化」）。
- **线性还是 sRGB**：开关灯在线性里混是物理正确的 [19]，但看起来「起得快、收得慢」[21]，可用缓动补（开 t²、关 1−(1−t)²，推导）；日夜在 sRGB 里混，中段发灰发暗 [19]。
- **把灯拆成一层**：开灯图 = 关灯图 + 灯的贡献 L = max(on_lin − off_lin, 0)，运行时 off + t·闪烁·L（线性）。开关、闪烁、叠加层合成一层，也不会把光晕算两次（推导，同 light group [48]）。

## 来源

1 pymatting foreground — https://pymatting.github.io/foreground.html ·
2 pymatting — https://github.com/pymatting/pymatting ·
3 Germer et al., Fast Multi-Level Foreground Estimation — https://arxiv.org/abs/2006.14970 ·
4 Forte, Approximate Fast Foreground Colour Estimation — https://github.com/Photoroom/fast-foreground-estimation ·
5 Levin et al., Closed-Form Matting — https://webee.technion.ac.il/people/anat.levin/papers/Matting-Levin-Lischinski-Weiss-PAMI.pdf ·
6 He et al., Guided Image Filtering — https://people.csail.mit.edu/kaiming/publications/pami12guidedfilter.pdf ·
7 Chuang et al., Bayesian Matting — https://grail.cs.washington.edu/wp-content/uploads/2015/08/Chuang-2001-ABA.pdf ·
8 Smith & Blinn, Blue Screen Matting — https://www.alvyray.com/Papers/CG/blusig96.pdf ·
9 BackgroundMattingV2 — https://github.com/PeterL1n/BackgroundMattingV2 ·
10 ViTMatte — https://github.com/hustvl/ViTMatte ·
11 MODNet — https://github.com/ZHKKKe/MODNet ·
12 BiRefNet — https://huggingface.co/ZhengPeng7/BiRefNet ·
13 rembg — https://github.com/danielgatis/rembg ·
14 McEwan, Deconstructing Despill — https://benmcewan-website.pages.dev/blog/understanding-despill-algorithms ·
15 Nuke EdgeExtend — https://learn.foundry.com/nuke/content/reference_guide/filter_nodes/edgeextend.html ·
16 Nuke LightWrap — https://learn.foundry.com/NUKE/content/reference_guide/draw_nodes/lightwrap.html ·
17 Adobe Select and Mask — https://www.adobe.com/se/learn/photoshop/web/selection-masking-space ·
18 Porter & Duff — https://github.com/dpt/Porter-Duff/blob/master/Porter-Duff.md ·
19 GPU Gems 3 ch. 24, The Importance of Being Linear — https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-24-importance-being-linear ·
20 Archibald, Cross-fading any two DOM elements — https://jakearchibald.com/2021/dom-cross-fade/ ·
21 Adobe 社区，线性合成下的溶解 — https://community.adobe.com/t5/premiere-pro-discussions/is-there-a-workaround-to-get-smooth-dissolves-when-working-in-linear-color/m-p/15501903 ·
22 Debevec, Rendering Synthetic Objects into Real Scenes — https://www.pauldebevec.com/Research/IBL/debevec-siggraph98.pdf ·
23 Intrinsic — https://github.com/compphoto/Intrinsic ·
24 Intrinsic Compositing — https://github.com/compphoto/intrinsiccompositing ·
25 Reinhard et al., Color Transfer — https://users.cs.northwestern.edu/~bgooch/PDFs/ColorTransfer.pdf ·
26 color-matcher — https://github.com/hahnec/color-matcher ·
27 scikit-image histogram matching — https://scikit-image.org/docs/stable/auto_examples/color_exposure/plot_histogram_matching.html ·
29 Godot 2D lights — https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html ·
30 Unity URP Secondary Textures — https://docs.unity3d.com/Manual/urp/SecondaryTextures.html ·
31 Sprite Lamp — https://store.steampowered.com/app/316830/Sprite_Lamp/ ·
32 Laigter — https://github.com/azagaya/laigter ·
33 SpriteIlluminator — https://www.codeandweb.com/spriteilluminator/documentation/effects ·
34 pixi-filters — https://github.com/pixijs/filters ·
35 Karis, Real Shading in UE4 — https://cgvr.informatik.uni-bremen.de/teaching/cg_literatur/Brian%20Karis%20-%20Real%20Shading%20in%20Unreal%20Engine%204,%202013%20Siggraph%20Course.pdf ·
35b LYGIA falloff — https://github.com/patriciogonzalezvivo/lygia/blob/main/lighting/light/falloff.glsl ·
36 Color temperature — https://en.wikipedia.org/wiki/Color_temperature ·
37 colour-science CCT_to_xy — https://colour.readthedocs.io/en/latest/generated/colour.CCT_to_xy.html ·
38 Thompson et al., Night Scenes — https://www-old.cs.utah.edu/docs/techreports/2000/abstracts/UUCS-00-016a.pdf ·
39 Bjørge, Bandwidth-Efficient Rendering — https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_slides.pdf ·
40 Jimenez, Post Processing in CoD: AW — https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/ ·
41 Quake world.qc — https://quakewiki.org/wiki/world.qc ·
42 Flickering of buoyant diffusion flames — https://arxiv.org/abs/1803.10400 ·
43 WCAG 2.3.1 — https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html ·
44 Fernando, PCSS — https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf ·
48 Blender light groups — https://docs.blender.org/manual/en/4.2/render/layers/passes.html
