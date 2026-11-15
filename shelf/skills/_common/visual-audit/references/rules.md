# 视觉体验审核规则库

这是一份跨项目的起点清单，不是某个产品的结论。用法：

1. **先挑领域**：按产品类型选相关前缀。网页 / 应用一般看 H、P、T、V、O、M；有弹层、面板或会展开的入口都加 L；画面上叠界面的产品加 G、M；有聊天的加 C；有常驻小组件、播放器的加 W；情感 / 陪伴 / cozy 类加 E；所有产品都扫一遍 K。
2. **每条都要落到证据上**：在截图、录屏或实测里量出数值，写进审核点；量不到的写「未测」，不凭印象判。
3. **和项目已有决定冲突时列为「待定」**：项目自己写下的设计决定（设计系统、决定清单）优先；规则与之冲突，写出冲突和取舍，交给负责人定，不直接判错。
4. **来源有时效**：平台规范和产品界面会改版。报告里作为关键依据的条目，审核时重新打开原文核一次。
5. 本库调研日期 **2026-11-11**。编号稳定，引用写 `T-03` 这样的形式；删掉的编号不复用。
6. 表格列：编号 | 规则（转述）| 怎么检查（量什么、阈值）| 来源（标题 + 直链）。「经验做法」一节没有规范来源，前缀用 `X`。

## 先看这 14 条

| 编号 | 一句话 | 阈值 |
|---|---|---|
| T-01 | 点下去要立刻有可见变化 | 录屏 60fps，点击到首个变化 ≤ 6 帧（100ms） |
| L-01 | 从哪里触发，就从哪里长出来 | 出现物第一帧与触发元素重叠，或中心相距 ≤ 视角 15° |
| L-11 | 侧边面板和它的触发器在同一侧 | 触发器与面板锚定的边同在屏幕左半或右半 |
| T-04 | 交互到下一帧绘制要快 | INP p75 ≤ 200ms，> 500ms 为差 |
| V-01 | 正文对比 | ≥ 4.5:1，取最不利点，不四舍五入 |
| V-03 | 图标、控件边界、状态指示的对比 | ≥ 3:1 |
| M-06 | 半透明面板上的文字在最差点也要能读 | 文字后方 ≥ 5 点取样，最差值 ≥ 4.5:1 |
| O-02 | 非关键任务用非模态，不挡住当前任务要看的东西 | 面板开着时主画面仍可操作、关键区域无遮挡 |
| O-03 | 遮罩只属于模态 | 有遮罩的面板背后必须本来就不该操作 |
| O-11 | 高频功能的交互成本 | 从主画面到达高频功能 ≤ 2 步 |
| T-09 | 动效时长 | 100–500ms；> 500ms 的非装饰动效记一次 |
| T-12 | 高频交互的动效要短、能打断 | 每天几十次的交互动画 ≤ 200ms，播放中再点立即响应 |
| G-02 | 反馈剂量是倒 U 形 | 一屏同时在动的元素 ≤ 2–3 个；日常点击不配粒子 |
| E-02 | 愉悦建立在可用之上 | 严重可用性问题未清零前，不把加装饰动效排在前面 |

## H 可用性启发式

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| H-01 | 系统状态可见：及时反馈当前状态，标出「你在哪里」 | 当前页 / 标签 / 模式有高亮；有后果的动作前先说明状态；反馈时限见 T-01 | 10 Usability Heuristics for UI Design — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-02 | 没有反馈用户会犹豫、重复点击；变色或打勾就足够确认 | 点后 1s 内无任何视觉变化 = 失败；连点两次是否触发两次请求 | Visibility of System Status — https://www.nngroup.com/articles/visibility-system-status/ |
| H-03 | 用用户熟悉的词，不用内部术语，信息按自然顺序排 | 逐个读界面文字，标出变量名、英文缩写、错误码；数量 > 0 即违规（面向专业用户的行业术语除外） | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-04 | 用户控制与自由：误操作有清楚的出口 | 每个弹层有可见关闭；Esc 能关；破坏性动作有撤销或确认 | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-05 | 一致性与标准：同一件事同一个词、同一种样式 | 同层级按钮出现 ≥ 2 种样式（圆角、高度、字重）即违规；同一概念 ≥ 2 种叫法即违规 | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-06 | 防错：先消除出错条件，再做确认和约束 | 不可逆动作（删除、清空、重置）是否有确认或撤销；能用下拉 / 步进器的地方是否还在要求自由输入 | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-07 | 识别优于回忆：选项和所需信息看得见 | 核心任务中是否有一步要用户记住上一屏的信息；无文字且无 tooltip 的图标逐个计数 | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-08 | 美观与极简：每个多余元素都在和要紧内容抢注意力 | 首屏可见元素计数；与主任务无关元素占首屏面积比例；配合 V-06 眯眼测试 | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-09 | 错误信息用白话、说清问题、给出修复办法 | 触发一次错误：有无裸错误码 / 堆栈（可折叠详情除外）；有无下一步；是否紧邻出错位置 | 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ |
| H-10 | 信任来自设计质量与一致，错别字和坏链接迅速损害信任 | 全界面错别字、中英混排错误、失效入口计数，> 0 即记 | Trustworthiness in Web Design — https://www.nngroup.com/articles/trustworthy-design/ |

## P 心理与认知

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| P-01 | Fitts 定律：目标越远越小，越慢越易错 | 常用按钮尺寸对照 V-09 / V-10；主操作区到常用按钮的距离；相邻可点目标间距 < 8px 记风险 | Fitts's Law — https://lawsofux.com/fittss-law/ |
| P-02 | Hick 定律：选项越多决策越慢 | 单个菜单 / 面板一次呈现的同级选项数；没有默认或推荐项的选择组记一次 | Hick's Law — https://lawsofux.com/hicks-law/ |
| P-03 | Jakob 定律：用户期待你的产品和他常用的产品一样用 | 关闭在常见位置、Esc 关闭、回车提交等惯例逐项核对，偏离逐项记录 | Jakob's Law — https://lawsofux.com/jakobs-law/ |
| P-04 | 组块（chunking）：内容分组呈现；7±2 不是硬上限 | 长列表 / 设置是否分组带标题；连续无分组的同级项 > 约 7 个记风险 | Miller's Law — https://lawsofux.com/millers-law/ |
| P-05 | 峰终定律：评价取决于最强烈的时刻和结尾 | 找出旅程的高光和结束点；结尾是否以报错、空白或突兀切断收场 | Peak-End Rule — https://lawsofux.com/peak-end-rule/ |
| P-06 | 美即好用效应：好看会掩盖可用性问题 | 可用性单独打分，不和美观分合并 | Aesthetic-Usability Effect — https://lawsofux.com/aesthetic-usability-effect/ |
| P-07 | 孤立效应（Von Restorff）：强调要克制，不只靠颜色 | 一屏高强调元素（高饱和色、动效、徽标）≤ 1–2 个；强调是否同时用了形状或文字 | Von Restorff Effect — https://lawsofux.com/von-restorff-effect/ |
| P-08 | Zeigarnik 效应：给出部分进度和「还有更多」的线索 | 多步流程是否显示进度（如 2/5）；可滚动内容边缘有无截断或渐隐提示 | Zeigarnik Effect — https://lawsofux.com/zeigarnik-effect/ |
| P-09 | 复杂度守恒（Tesler）：消不掉的复杂度由系统承担 | 系统本可推断却要用户手填的字段数；要用户自己换算 / 记忆的步骤数 | Tesler's Law — https://lawsofux.com/teslers-law/ |
| P-10 | 目标梯度：离目标越近越有动力，要显示还差多少 | 有累积目标的功能是否显示距下一个目标的差距 | Goal-Gradient Effect — https://lawsofux.com/goal-gradient-effect/ |
| P-11 | 格式塔·接近：靠近的被看成一组 | 组间距 ≥ 组内间距 2 倍；标签离自己的输入框比离别的近 | Law of Proximity — https://lawsofux.com/law-of-proximity/ |
| P-12 | 格式塔·相似：可点与不可点要样式有别 | 可点与不可点元素是否同色同字重；同功能元素样式是否一致 | Law of Similarity — https://lawsofux.com/law-of-similarity/ |
| P-13 | 格式塔·共同区域：边框 / 底色圈起来的被看成一组，能用留白先用留白 | 一个卡片只放一组相关内容；整宽色块是否造成「假底部」 | The Principle of Common Region — https://www.nngroup.com/articles/common-region/ |
| P-14 | 格式塔·连续与图底：视线沿对齐线走；前后关系要一眼分清 | 序列元素是否在同一对齐线；复杂背景上的浮层能否一眼分出前后（对比见 V-01～V-03） | Laws of Proximity, Uniform Connectedness, and Continuation — https://ixdf.org/literature/article/laws-of-proximity-uniform-connectedness-and-continuation-gestalt-principles-2 ；Figure/Ground — https://ixdf.org/literature/article/the-laws-of-figure-ground-praegnanz-closure-and-common-fate-gestalt-principles-3 |
| P-15 | 人偏好曲线轮廓，尖角轮廓带负面偏向（研究对象是物体图案，迁移到界面属推断） | 数界面里的直角、尖角元素（尖气泡尾、尖头箭头），与产品意图的情绪对照 | Humans prefer curved visual objects — https://nmr.mgh.harvard.edu/publications/journal_articles/743 |
| P-16 | 婴儿图式（圆脸、大眼、高额头）越强越显可爱、越引发照顾动机，也能迁移到产品外形 | 可爱化只出现在小物件（吉祥物、表情、角标）还是蔓延到面板结构；后者有滑向幼稚的风险 | Borgi 等 2014 — https://www.frontiersin.org/articles/10.3389/fpsyg.2014.00411/full ；Isn't It Cute — https://ijdesign.org/index.php/IJDesign/article/view/1023 |
| P-17 | 看可爱图让人更专注细致，而不是更放松 | 报告里出现「可爱让人放松」一类论断时改写或删去 | The Power of Kawaii — https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0046362 |
| P-18 | 色彩心理学证据薄弱（「粉色镇静」也未被重复验证），色彩决策靠可读性和场景取样 | 报告里把「某色 = 某情绪」写成规律的，降为风格选择 | Color and psychological functioning — https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00368/full ；Pink cells — https://www.bps.org.uk/2014/12/02/are-prisoners-calmer-when-their-cells-are-painted-pink |

## T 响应与反馈时序

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| T-01 | 0.1 秒内感觉即时；按下态应在指针按下时出现，不等请求返回 | 录屏 60fps，点击到首个可见变化 ≤ 6 帧 | Response Times: The 3 Important Limits — https://www.nngroup.com/articles/response-times-3-important-limits/ |
| T-02 | 1 秒内思路不断；超过 1 秒要显示正在工作 | 耗时 > 1s 的操作是否出现忙碌指示（光标、加载、骨架） | Response Times: The 3 Important Limits — https://www.nngroup.com/articles/response-times-3-important-limits/ |
| T-03 | 超过 10 秒注意力流失，要百分比进度和取消 | 耗时 > 10s 的操作有无百分比 / 剩余时间与取消按钮 | Response Times: The 3 Important Limits — https://www.nngroup.com/articles/response-times-3-important-limits/ ；Progress Indicators — https://www.nngroup.com/articles/progress-indicators/ |
| T-04 | INP ≤ 200ms 为良好，200–500 需改进，> 500 为差，按 p75 评估 | DevTools Performance 或 web-vitals 库测 INP，移动与桌面分开 | Interaction to Next Paint (INP) — https://web.dev/articles/inp |
| T-05 | Doherty 阈值：约 400ms 内回应，人机互不等待 | 输入到可见响应 > 400ms 记一次；慢操作是否用进度让等待显得短 | Doherty Threshold — https://lawsofux.com/doherty-threshold/ |
| T-06 | 加载指示按时长选：< 1s 不放，2–10s 转圈或骨架，> 10s 进度条；上传下载用进度条 | 统计各加载场景实际时长对照所用指示；< 1s 闪出转圈记一次 | Skeleton Screens 101 — https://www.nngroup.com/articles/skeleton-screens/ |
| T-07 | 骨架屏要像真布局，只有框架的骨架让人以为坏了 | 骨架截图与完成截图叠图，主要块偏差 < 一个间距单位 | Skeleton Screens 101 — https://www.nngroup.com/articles/skeleton-screens/ |
| T-08 | 乐观更新：先显示预期结果，失败回滚并提示；只用于大概率成功的操作 | 断网或模拟失败：是否回滚并给出错误提示；成功时有无闪烁 | useOptimistic — https://react.dev/reference/react/useOptimistic |
| T-09 | 动效时长 100–500ms：简单反馈约 100ms，较大变化 200–300ms，大位移最多约 400ms | 逐帧量每个动效，按类型对照；> 500ms 非装饰动效记一次 | Executing UX Animations: Duration and Motion Characteristics — https://www.nngroup.com/articles/animation-duration/ |
| T-10 | 进场略长于退场；进场 ease-out、退场 ease-in；不用线性曲线 | 同一元素进 / 退时长对比，退 > 进记一次；看曲线是否线性 | Executing UX Animations: Duration and Motion Characteristics — https://www.nngroup.com/articles/animation-duration/ ；Motion（MDC Android）— https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md |
| T-11 | 时长随面积 / 位移增大，并落在一套刻度上（Material：50–1000ms 分 short/medium/long/extra-long） | 同类动效按位移排序，时长应单调不减；统计用到的时长值是否成套 | Motion（MDC Android）— https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md |
| T-12 | 高频交互不加长动效，动效要能打断 | 动画中立刻再点是否被响应；每天几十次的交互带 > 200ms 动画记一次 | Motion — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json |
| T-13 | 交互触发的运动要能关掉，运动不能是唯一的信息通道 | 模拟 prefers-reduced-motion: reduce 后录屏，位移 / 缩放是否消失或改为淡入 | Understanding 2.3.3 Animation from Interactions — https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html |
| T-14 | 动效与微交互要有目的（反馈、状态、定位、提示可操作），简短低调 | 给每个动效标目的，标不出的记一次 | The Role of Animation and Motion in UX — https://www.nngroup.com/articles/animation-purpose-ux/ ；Microinteractions in UX — https://www.nngroup.com/articles/microinteractions/ |

## V 视觉层级与排版

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| V-01 | 正文对比 ≥ 4.5:1，阈值不四舍五入 | 取色器量前景 / 背景；图片或渐变背景上取最不利点 | Understanding 1.4.3 Contrast (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| V-02 | 大字（≥ 24px，或粗体 ≥ 18.5px）对比 ≥ 3:1 | 先按字号字重判定是否大字，再量对比 | Understanding 1.4.3 Contrast (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| V-03 | 非文本对比 ≥ 3:1：识别控件所需的边界、图标、选中 / 焦点指示；悬停态不能降低对比 | 量按钮边界、图标、开关、进度条已播部分、焦点框与相邻色的对比 | Understanding 1.4.11 Non-text Contrast — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html |
| V-04 | 字号阶梯少而清楚（约三级），最大号元素约两个以内 | 一屏不同字号 > 4–5 种记风险；最大字号元素 > 2 记风险 | Visual Hierarchy in UX — https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ |
| V-05 | 高饱和色留给关键项，红色等暖亮色留给警告错误，不只靠颜色 | 一屏高饱和色块数；红色是否用在非错误语义 | Visual Hierarchy in UX — https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ |
| V-06 | 眯眼测试：模糊后最先跳出的应是最重要的元素 | 截图高斯模糊 8–12px，看前三个最显眼的块是否为主任务元素 | Visual Hierarchy in UX — https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ |
| V-07 | 正文行宽 50–75 字符 | 量一行字符数；英文 > 80 或中文 > 40 字记超出 | Readability: The Optimal Line Length — https://baymard.com/blog/line-length-readability |
| V-08 | 段内行距 ≥ 1.5、段距 ≥ 1.5 倍行距、不两端对齐（AAA，短文本可酌情） | line-height / font-size ≥ 1.5；检查 text-align: justify | Understanding 1.4.8 Visual Presentation — https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html |
| V-09 | 指针目标 ≥ 24×24 CSS px，更小的以中心 24px 圆不得与他者相交 | DevTools 量每个可点元素的命中区域，小目标做圆间距检查 | Understanding 2.5.8 Target Size (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| V-10 | 平台尺寸：iOS 44pt（最小 28）、macOS 28pt（最小 20）、Material 触摸目标 48dp、目标间约 8dp | 桌面按 macOS 档与 V-09 取较严者；触屏按 44pt / 48dp | Accessibility — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json ；Metrics & keylines — https://m1.material.io/layout/metrics-keylines.html |
| V-11 | 间距对齐 8 网格、细部 4 网格 | 抽取 margin / padding / gap，非 4 倍数的占比；同类间距 ≥ 3 种不同值记风险 | Metrics & keylines — https://m1.material.io/layout/metrics-keylines.html |
| V-12 | F 型扫视：右侧和下方易被漏看，用小标题、关键词前置、分组对抗 | 关键信息或主操作是否落在右下低注意区；小标题头两个词是否带要点 | F-Shaped Pattern of Reading — https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/ |
| V-13 | 可点击性要有强信号；弱信号让任务更慢、悬停试探更多，主功能不能只靠 hover 才显出可点 | 不加说明让测试者在静态截图里指出所有可点元素，统计漏指 / 误指；只有一根细线图标、无底板无描边的入口逐个记 | Flat UI Elements Attract Less Attention — https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/ ；Long exposure — https://nngroup.com/articles/flat-design-long-exposure/ |

## O 弹层与呈现模式

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| O-01 | 模态只给值得打断的时刻：关键警告、必需输入、分步流程、省事的一次性提问 | 列出所有模态逐个归类，归不进的（推广、可内联修复的错误）记一次 | Modal & Nonmodal Dialogs — https://www.nngroup.com/articles/modal-nonmodal-dialog/ |
| O-02 | 非关键任务用非模态，且不遮住此刻需要看的内容 | 面板开着时主画面可否操作；是否盖住当前任务必须看的区域 | Modal & Nonmodal Dialogs — https://www.nngroup.com/articles/modal-nonmodal-dialog/ |
| O-03 | 遮罩（scrim）只属于模态；标准 sheet 无遮罩、背后可交互 | 有遮罩的面板背后是否本应可交互；量遮罩暗度（dialog 默认约 32%） | Bottom sheets — https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md ；Dialogs — https://github.com/material-components/material-components-android/blob/master/docs/components/Dialog.md |
| O-04 | 弹层要有可见关闭、Esc 可关；自动关闭的非模态要保住输入，只在明确取消时丢弃 | 输入一半后点外面关闭再打开，内容是否还在 | Overuse of Overlays — https://www.nngroup.com/articles/overuse-of-overlays/ ；Popovers — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/popovers.json |
| O-05 | Popover 小而锚定、指向来源、不遮触发元素；一次一个、不级联；能一次点击从 A 切到 B | 同时能开几个；箭头是否指向触发控件；从 A 直接点 B 是否一步切换 | Popovers — Apple HIG — Overuse of Overlays — https://www.nngroup.com/articles/overuse-of-overlays/  |
| O-06 | Sheet 只放简单任务，一次一个；有「完成」就要有「取消 / 返回」；长流程改用窗口或全屏 | 叠了几层 sheet；长流程塞进 sheet；只有完成没有取消各记一次 | Sheets — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/sheets.json |
| O-07 | 要反复调参看结果时用可移动面板而非 sheet，控件优选滑块步进器 | 调设置时能否同时看到效果；面板内是否大量要求打字 | Panels — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/panels.json |
| O-08 | 沉浸类的 HUD 式面板要小，不遮它所调节的内容，少用颜色 | 面板面积占视口比例；是否遮住画面主体 | Panels — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/panels.json |
| O-09 | 面板在大屏上不无限拉宽（Material bottom sheet 默认最大宽 640dp） | 在 1440 / 1920 宽下量面板宽度是否随视口无上限拉伸 | Bottom sheets — https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md |
| O-10 | 导航栏目 3–7 个；无标签图标配 tooltip；选中项用指示器而不是只变色（Material rail：图标 24dp、指示器 56×32dp） | 数一级入口，> 7 记风险；选中态是否只靠颜色；无标签图标有无名称提示 | Navigation rail — https://github.com/material-components/material-components-android/blob/master/docs/components/NavigationRail.md |
| O-11 | 交互成本（interaction cost）= 读、找、点、等、切换注意力、记忆的总和 | 从主画面到每个高频功能的点击 / 层级数，> 2 步记风险；每多一个必经弹层计一次 | Interaction Cost: Definition — https://www.nngroup.com/articles/interaction-cost-definition/ |
| O-12 | 键盘焦点不能被自己做的浮层（粘性头、非模态面板）完全盖住 | Tab 遍历一遍，焦点被完全遮住的次数 | Understanding 2.4.11 Focus Not Obscured — https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html |

## E 情感化与陪伴感

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| E-01 | 情感设计三层：本能（第一眼）、行为（顺不顺）、反思（意义与记忆），同时作用 | 首屏 5 秒测试，让测试者说三个形容词，对照产品意图；结尾体验见 P-05 | Emotional design — https://en.wikipedia.org/wiki/Emotional_design |
| E-02 | 愉悦建立在功能、可靠、可用之上；底层没满足时表面装饰回报低甚至显得做作 | 有严重可用性问题却有大量装饰动效，记风险 | A Theory of User Delight — https://www.nngroup.com/articles/theory-user-delight/ |
| E-03 | 深层愉悦来自少打扰的心流 | 一次完整会话中被打断次数（弹窗、强制提示、加载等待） | A Theory of User Delight — https://www.nngroup.com/articles/theory-user-delight/ |
| E-04 | 微交互 = 触发 → 规则 → 反馈 → 循环；反馈优先复用已有元素，为第 2 / 10 / 1000 次使用设计 | 每个微交互写出四部分；没有反馈的状态变化、额外冒出的新元素各记一次 | Microinteractions: Why details matter — https://smartdesignworldwide.com/ideas/microinteractions-details-matter/ |
| E-05 | 每个提交动作都要有明显回应；「不确定保存了没有」是高频挫败 | 每个提交动作截「之后」的图，无可见变化记一次 | Design Critique: Finch — https://ixd.prattsi.org/2025/09/design-critique-finch-ios-app-2/ |
| E-06 | Cozy = 安全、充裕、柔软三种幻想的强度 | 逐屏打三问：有没有威胁？有没有缺什么？刺激柔不柔？ | Coziness in Games (Project Horseshoe 2017) — https://www.projecthorseshoe.com/reports/featured/ph17r3.htm |
| E-07 | 安全：活动自愿可选，不强迫；限时、稀缺、排名、会「饿死」的照料对象破坏安全感 | 找必须点掉的弹窗、倒计时、红色警示、限时标签、排行、「再不来就……」文案 | Coziness in Games (Project Horseshoe 2017) — https://www.projecthorseshoe.com/reports/featured/ph17r3.htm |
| E-08 | 充裕：不制造「缺」的信号 | 找空态、红点、未读数堆积、没满的进度条；空态是否冷冰冰 | Coziness in Games (Project Horseshoe 2017) — https://www.projecthorseshoe.com/reports/featured/ph17r3.htm |
| E-09 | 柔软：明确的低压力信号，最高对比只留给要读的内容 | 对比最高的元素是不是最需要看的；有无刺眼高亮 | Coziness in Games (Project Horseshoe 2017) — https://www.projecthorseshoe.com/reports/featured/ph17r3.htm |
| E-10 | 打断（通知、突发声音、催促）剥夺注意力自主；通知可以设计成经同意、有价值的 | 数自动弹出、闪烁、带声音的元素 | Coziness in Games (Project Horseshoe 2017) — https://www.projecthorseshoe.com/reports/featured/ph17r3.htm |
| E-11 | 声音连续、柔和、不突兀，最好来自场景 | 听：界面音效是否比环境声尖、响 | Coziness in Games (Project Horseshoe 2017) — https://www.projecthorseshoe.com/reports/featured/ph17r3.htm |
| E-12 | 感知到的自主和能力与享受、继续使用相关；与他人的联结是重要满足来源 | 用户能否自己决定（换、摆、选）；每次操作后有无清楚的「做成了」信号 | Self-determination in games (ScienceDaily 2006) — https://sciencedaily.com/releases/2006/12/061226134706.htm |
| E-13 | 社会临场感最稳的预测因子是行为真实度（注视、点头等「意识到你」的信号）和响应性；纯文字最低；过多注视适得其反 | 对方角色 / 形象是否对用户行为有回应；回应是否一直盯着不移开 | A Systematic Review of Social Presence — https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2018.00114/full |

## G 游戏感与 HUD

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| G-01 | 手感 = 实时操控 + 模拟空间 + 打磨；打磨不改功能，但决定「像不像真的」 | 录屏对照：同一操作去掉动效音效前后；拖拽、hover 过程有无跳帧 | Designing Game Feel: A Survey — https://ar5iv.arxiv.org/html/2011.09201 |
| G-02 | 反馈剂量是倒 U 形：无和极端两档都显著差于中、高档 | 数一次点击触发几种反馈；一屏同时在动的元素 > 2–3 个、每次点击都有粒子记风险 | Designing Game Feel: A Survey — https://ar5iv.arxiv.org/html/2011.09201 （Kao 2020 部分）；Juice It or Lose It — https://gdcvault.com/play/1016487/Juice-It-or-Lose |
| G-03 | 堆砌特效忽视上下文、削弱沉浸 | 特效是否盖住画面焦点（人物的脸、主体）或抢走其注意 | Indies, resist the urge to 'juice it or lose it' — https://gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it- |
| G-04 | 界面分叙事内、非叙事、空间、元四类；非叙事 HUD 是兜底，也应采用作品的美术风格 | 给每个 UI 元素标类别；非叙事面板与场景是否同源（材质、色温）还是像通用后台模板 | User interface design in video games — https://gamedeveloper.com/design/user-interface-design-in-video-games |
| G-05 | 信息放在视觉焦点旁边优于放在角落 | 量状态信息到视觉焦点的距离 | Peacocke 等, IEEE GEM 2015 — https://www.yorku.ca/mack/ieee_gem2015.html |
| G-06 | 质感来自从现实提取材质并加光照与交互强调；扁平是去无关细节，不是去全部材质；大面板可用暗角聚焦 | 面板是纯色平块还是有一点材质（纹理、光、边）；打开大面板时背景是否有聚焦处理 | 从《明日方舟》谈游戏 UI/UX — https://m.163.com/dy/article/EL89O4QK0526DPBA.html |
| G-07 | 字族要少，层级靠字号和颜色 | 数截图字族和字重：> 2 种字族、> 3 档字重记乱 | 星间字景（一）— https://www.gcores.com/articles/175983 |
| G-08 | 减法设计：删掉不服务核心的东西；chill 类没有分数、失败和惩罚 | 找数字压力：分数、连续打卡、断签惩罚、红色警告 | Unpacking design pillars — https://www.gamedeveloper.com/design/unpacking-the-design-pillars-of-a-chill-puzzle-game |
| G-09 | 用一个可直接执行的动作表达关心，比只发文字更有分量 | 产品里有没有「动作」级别的表达，而不只是输入文字 | Inside the design of Spiritfarer — https://gamedeveloper.com/design/inside-the-thoughtful-design-of-thunder-lotus-i-spiritfarer-i- |
| G-10 | 画面优先的作品把常驻控件压到最少，不挡画面 | 常驻控件数量与占屏面积；画面中心是否被 UI 占用 | Behind the Design: Sky — https://developer.apple.com/news/?id=zm47it7t |
| G-11 | 画面优先的产品提供一键清场 / 氛围模式 | 有无一个操作隐藏除必要项外的全部浮层，再一次能恢复 | Flocus — https://flocus.com ；lofi.cafe — https://www.lofi.cafe |

## M 深度、阴影与材质

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| M-01 | 阴影表达高度：越高越大越柔，越低越小越锐；交互结束回到静止高度 | 按「该在哪层」排序浮层，再按阴影模糊排序，两个顺序应一致 | Elevation & shadows — https://m1.material.io/material-design/elevation-shadows.html |
| M-02 | 高度级数有限（0–5），静止态用 0–3，4–5 留给悬停、拖拽；悬停时升一级而不只是改底色 | 不同阴影规格 > 6 种记风险；静止元素用最高级记一次 | Elevation — https://material-web.dev/components/elevation/ |
| M-03 | 单一光源：所有阴影方向和 x:y 比例一致 | 抽取所有 box-shadow 偏移，出现相反方向或比例乱的记一次 | Designing Beautiful Shadows in CSS — https://www.joshwcomeau.com/css/designing-shadows/ |
| M-04 | 多层阴影叠出柔和衰减（偏移、模糊逐层翻倍）；阴影取背景色相降饱和，不用纯黑 | 高层浮层是否多层；彩色背景上的阴影是否纯 rgba(0,0,0) 显脏 | Designing Beautiful Shadows in CSS — https://www.joshwcomeau.com/css/designing-shadows/ ；Layered box-shadows — https://tobiasahlin.com/blog/layered-smooth-box-shadows/ |
| M-05 | 运动中的元素不穿过同层或更高层元素 | 录屏看动画过程中面板、人物、浮层有无互相穿插 | Elevation & shadows — https://m1.material.io/material-design/elevation-shadows.html |
| M-06 | 半透明面板：背景越杂模糊越大；越透对比越差；按会出现的最复杂背景设定，最差点达标 | 面板放到最花的背景上，文字后 ≥ 5 点取样，最差值 ≥ 4.5:1 | Glassmorphism: Definition and Best Practices — https://www.nngroup.com/articles/glassmorphism/ |
| M-07 | 玻璃效果要克制，优先用成熟设计系统的材质 | 一屏半透明模糊面板 > 2 个记风险 | Glassmorphism: Definition and Best Practices — https://www.nngroup.com/articles/glassmorphism/ ；Materials — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json |
| M-08 | 玻璃只给浮在内容上的控件 / 导航层；文字多用厚（更不透明）材质；高透明材质压在亮背景上要垫约 35% 暗化层 | 区分控件层与内容层的材质；文字密集面板的不透明度是否明显高于装饰浮层；亮区上的透明面板有无暗化 | Materials — Apple HIG — Glassmorphism: Definition and Best Practices — https://www.nngroup.com/articles/glassmorphism/ |
| M-09 | 提高不透明度本身就是可读性方案；实底在复杂画面上是正当选择 | 开 / 关「降低透明度、增强对比」两种设置各测一次可读性 | iOS 26.1 to Add Optional Opacity to Liquid Glass — https://tidbits.com/2025/10/21/ios-26-1-to-add-optional-opacity-to-liquid-glass/ |
| M-10 | 深色主题分层用确定的色调表面色（surface container 档位），不靠半透明叠加 | 深色下各层表面色是否成套、可区分 | Color（MDC Android）— https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Color.md |
| M-11 | 细噪点 / 颗粒给平涂色块加质感、减轻长渐变色带；注意性能 | 放大到 200%：大面积渐变有无色带；面板是否塑料般平滑；颗粒是否实时计算 | Grainy Gradients — https://css-tricks.com/grainy-gradients/ ；https://blog.master.dev/grainy-gradients/ |
| M-12 | 拟物与扁平都不走极端：写实拟物杂乱，扁平弱化可点性，新拟态对比太低 | 判断界面落在哪个极端；新拟态式控件量 V-03 对比 | Skeuomorphism — https://www.nngroup.com/articles/skeuomorphism/ |

## C 聊天与消息界面

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| C-01 | 双方消息用颜色区分；显示「正在输入」能提高等待耐心 | 截图里双方气泡是否不同色；等待回复时有无输入提示 | The UX of Customer-Service Chat — https://www.nngroup.com/articles/chat-ux/ |
| C-02 | 1 对 1 聊天自己右、对方左；多人高密度频道可全部靠左并显示名字 | 对齐方式是否符合聊天类型 | Chat & messaging best practices — https://uxcel.com/lessons/chat--messaging-best-practices-001 ；MUI X Chat Layout — https://mui.com/x/react-chat/basics/layout/ |
| C-03 | 气泡宽度用「百分比 + 像素上限」双约束（参考 min(75%, 460px)；Telegram 桌面 430px） | 在最窄和最宽窗口各量气泡最大宽 | Kendo Chat Styles — https://www.telerik.com/design-system/docs/components/chat/styles ；tdesktop chat.style — https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/ui/chat/chat.style |
| C-04 | 宽窗口不让消息拉满整屏，也不让固定宽的列靠一侧留大片空白 | 1920 宽下量消息列宽和两侧空白是否对称 | uxcel（同 C-02）；Telegram bug #13701 — https://bugs.telegram.org/c/13701 |
| C-05 | 同一人连续消息成组（参考 5 分钟窗），头像每组一次，组内贴边圆角缩小 | 组内间距明显小于组间（见 P-11）；头像是否每条重复 | Message appearance — https://mui.com/x/react-chat/display/message-appearance/ ；Kendo（同 C-03） |
| C-06 | 时间与状态在交互时或组尾显示，不必每条都挂；日期分隔用居中标签 | 每条都带时间戳记风险；跨天有无日期分隔 | Kendo Chat Usage — https://www.telerik.com/design-system/docs/components/chat/usage ；MUI（同 C-05） |
| C-07 | 输入框自增高并有上限（参考最多 8 行），提交键可配置为 Enter 或 Shift+Enter | 粘贴长文：输入框高度是否到顶后内部滚动；是否把消息区挤没 | Ant Design X Sender — https://x.ant.design/components/sender ；tdesktop chat_helpers.style — https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/chat_helpers/chat_helpers.style |
| C-08 | 表情面板：emoji、贴纸、GIF 分页签；不用底部满宽面板遮住最新消息；emoji 格约 36–40px、约 9 列 | 打开面板后最新一条消息是否可见；量格子尺寸与列数 | WhatsApp Web emoji panel redesign — https://wabetainfo.com/whatsapp-web-beta-gets-new-chat-share-sheet-and-redesigned-emoji-panel/ ；emoji-mart — https://cdn.jsdelivr.net/gh/missive/emoji-mart@main/README.md ；tdesktop（同 C-07） |
| C-09 | 更有表现力的输入提示提高「共在感」 | 输入提示是否只是三个点，还是能传达对方状态 | Rich typing indicators (CHI 2023) — https://posts.cs.brown.edu/2023/07/11/what-are-you-typing-enhancing-digital-communication-through-rich-typing-indicators/ |
| C-10 | 打开聊天 ≤ 100ms 见到框架与最近消息；发送后本地立即上屏，> 1s 显示「发送中」，失败可重试 | 录屏量打开到首帧内容、发送到上屏的时间；断网发一条看失败态 | Response Times — https://www.nngroup.com/articles/response-times-3-important-limits/ ；useOptimistic — https://react.dev/reference/react/useOptimistic |
| C-11 | 窗口变窄时按宽度切换为单栏紧凑形态 | 拖窄窗口，在哪个宽度切换、切换后是否仍可用（MUI 示例约 600px） | Telegram Desktop compact mode — https://telegram.org/blog/desktop-compact ；MUI（同 C-02） |

## W 小组件与播放器

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| W-01 | 小组件只讲一个想法，平衡密度，只放直接相关的信息 | 能否用一句话说出这个组件告诉了什么；次要信息是否和主信息同权重 | Widgets — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/widgets.json |
| W-02 | 组件文字 ≥ 11pt；自定义字体只用于大字；边距约 16pt（紧凑 11pt）；内外圆角协调 | 量最小字号、边距；内容圆角与容器圆角是否同心 | Widgets — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/widgets.json |
| W-03 | 偏好会变化的动态信息；数据更新可用 ≤ 2 秒的过渡 | 数据变化时是硬切还是过渡；过渡时长 | Widgets — Apple HIG — https://developer.apple.com/tutorials/data/design/human-interface-guidelines/widgets.json |
| W-04 | 迷你播放器以封面为主，控件悬停才出现，可收成只有控件的窄条、可置顶；可有多种形状 | 静止态控件数；悬停后控件是否齐；最小形态是否仍可用 | Use MiniPlayer in Music on Mac — https://support.apple.com/en-euro/guide/music/mus71d7dcfce/mac ；Spotify Miniplayer — https://developer.chrome.com/blog/spotify-picture-in-picture |
| W-05 | 最小可用播放器 = 封面 + 播放 / 暂停 + 下一首；用封面取色或模糊封面做底避免单调 | 最小形态元素清单；播放器是否与当前内容有视觉联系 | YouTube Music web player redesign — https://9to5google.com/2024/03/04/youtube-music-web-player-redesign/ |
| W-06 | 播放器小但控件要齐：用户会追要循环、随机和音量数值 | 列出现有控件，对照播放、上 / 下一首、音量、循环 / 随机 | Virtual Cottage 2（vaporlens 汇总）— https://vaporlens.app/app/2943180/virtual_cottage_2.md |
| W-07 | 音乐和环境音分层，音量各自独立，界面说明当前是哪一层 | 两种声源能否分别调；副标题是否说明来源 | Flocus Music — https://flocus.com/features/music |
| W-08 | 场景上的工具栏 / 小组件可收起、可拖动，跑出屏幕时可重置布局 | 能否一键收起工具栏；拖出屏幕后有无恢复办法 | LifeAt Focus Mode — https://lifeat.gitbook.io/getting-started/how-to-use-focus-mode |
| W-09 | 计数类组件（在一起天数、倒数日）的情绪来源是里程碑（100 天、周年）和纸品质感的背景；背景要模糊或压暗保证文字可读 | 有无里程碑提示；背景图上的文字量 V-01 | Couple Widget — https://apps.apple.com/us/app/-/id1127692604 ；倒数日 Days Matter — https://apps.apple.com/us/app/days-matter/id406170251 ；爱范儿书签式倒数日 — https://www.ifanr.com/app/1039944 |

## K 同类产品里反复出现的失败

| 编号 | 失败模式 | 怎么检查 | 来源 |
|---|---|---|---|
| K-01 | 功能堆积，把「一个场景 + 一个工具」长成仪表盘，场景被淹没 | 对比早期与当前版本的常驻入口数；场景可见面积比例是否持续下降 | LifeAt review — https://flat.social/guides/lifeat-review |
| K-02 | 桌面照搬手机布局：两侧大片留白、元素紧凑 | 桌面宽度下内容区占比与留白；控件是否为触屏尺寸 | Character.AI new UI — https://www.roborhythms.com/character-ai-new-ui/ |
| K-03 | 改版撤掉用户已依恋的东西（头像、身份感、旧功能），只留付费退路 | 改版前后功能清单对比；有无免费切回旧外观的开关 | Character.AI new UI — https://www.roborhythms.com/character-ai-new-ui/ ；Replika 2.0 — https://www.roborhythms.com/replika-2-0-explained/ |
| K-04 | 输入框或编辑框过大，几乎占满屏 | 编辑态输入框占视口高度比例 | Character.AI edit box — https://piunikaweb.com/2026/03/06/character-ai-users-annoyed-ui-change-edit-box-takes-over-screen/ |
| K-05 | 层级太深，进一个常用功能要点很多下 | 同 O-11 计步数 | NookPhone review roundup — https://www.engadget.com/animal-crossing-nookphone-user-review-roundup-130033026.html |
| K-06 | 字太小且不能放大；HUD 状态显示出错（不活跃的按钮仍高亮、按钮没反应） | 最小字号；有无文字大小设置；逐个按钮核对状态显示 | Spirit City（vaporlens）— https://vaporlens.app/app/2113850/spirit_city_lofi_sessions ；Spirit City 更新记录 — https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=2113850&count=12&maxlength=1200 |
| K-07 | 情感界面里放广告和付费催促，被读成「收割」 | 情感 / 关系相关界面上的广告位、付费提示计数 | Widgetable App Store — https://apps.apple.com/us/app/widgetable-besties-couples/id1641107226 |
| K-08 | 首页拥挤（商店、会员、社区抢位置），首次引导一次塞太多选项 | 首屏入口与推销元素计数；引导单步选项数 | Design Critique: Finch — https://ixd.prattsi.org/2025/09/design-critique-finch-ios-app-2/ |
| K-09 | 引导和小组件设置让人困惑，直接拖低评分 | 新用户从安装到第一个组件生效的步骤数与卡点 | Locket on TechCrunch — https://techcrunch.com/2022/01/11/locket-an-app-for-sharing-photos-to-friends-homescreens-hits-the-top-of-the-app-store |
| K-10 | 浮层面板尺寸固定、不可调，大屏上显得过小 | 在 4K / 高缩放下量面板占屏比例；有无调整大小或展开 | Discord 社区帖 — https://support.discord.com/hc/en-us/community/posts/360036130992 |

## L 视觉流与触发处展开

走查时把每个「点一下之后，变化出现在哪」过一遍：量起点、落点、方向与时长。角度按用户的注视点算，是判据的主体；括号里的像素是在参考桌面（24″ 1920×1080、视距 60 cm，屏幕中央附近 1° ≈ 38–40 px）上换算的量级，换屏、换视距要重算。15° 取有效视野（直径约 30°）的半径，是保守门槛、不是硬边界；注视点挪动超过约 20° 时头也会跟着转（Saccade — https://en.wikipedia.org/wiki/Saccade ）。本节 2026-11-15 补。

| 编号 | 规则 | 怎么检查 | 来源 |
|---|---|---|---|
| L-01 | 点击后出现的内容，第一帧从触发元素本身或紧邻处长出（容器变形、锚定弹层、原地展开） | 出现物起始包围盒与触发元素重叠，或中心相距 ≤ 视角 15°（参考屏约 550–600 px） | Motion（MDC Android）— https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md ；Connected animation — Microsoft Learn — https://learn.microsoft.com/en-us/windows/apps/design/motion/connected-animation ；Popovers — Apple HIG — https://developer.apple.com/design/human-interface-guidelines/popovers ；Fitts's Law — https://www.nngroup.com/articles/fitts-law/ ；Kotseruba & Tsotsos, Behavioral Research and Practical Models of Drivers' Attention §2.2 — https://arxiv.org/pdf/2104.05677 |
| L-02 | 结果出现处离触发点超出有效视野时，必须有一条连续的运动把视线送过去 | 起止中心距 > 15° 且途中没有连续位移的共享元素 / 容器 = 不合格 | Change Blindness — https://www.nngroup.com/articles/change-blindness-definition/ ；Animation for Attention and Comprehension — https://www.nngroup.com/articles/animation-usability/ ；Kotseruba & Tsotsos（同 L-01） |
| L-03 | 要把视线送到远处，就让同一个可辨认的元素（封面、图标、容器）连续飞过去，不用「原处消失 + 远处淡入」 | 共享元素途中每一帧都可见；准备到开始的空档 ≤ 250ms | Connected animation（同 L-01）；Shared elements in Compose — https://developer.android.com/develop/ui/compose/animation/shared-elements |
| L-04 | 进场方向和「触发点 → 落点」一致；退场按原路收回到触发点 | 进场位移向量与「触发点 → 落点」的夹角 < 45°；关闭时回到原触发元素 | Motion（MDC Android，同 L-01）；Connected animation（同 L-01）；Motion — Apple HIG — https://developer.apple.com/design/human-interface-guidelines/motion |
| L-05 | 只有固定的导航目的地（全局导航、位置固定的系统面板）可以不在原地展开，而且每次同一位置、同一方向出现 | 同一面板从不同入口打开，出现位置偏差 = 0；仍须满足 L-03 或 L-07 之一 | Motion（MDC Android，同 L-01）；Motion — Apple HIG（同 L-04）；Side sheet（MDC Android）— https://github.com/material-components/material-components-android/blob/master/docs/components/SideSheet.md |
| L-06 | 同一个面板有多个入口时，每个入口用自己的位置做动画起点，落点可以固定 | 从入口 A、B 打开时，起始帧分别贴近 A、B | Shared elements in Compose（同 L-03） |
| L-07 | 做不了连接动效时，触发点至少要有回应（按下态、指向落点的方向提示），并压暗其它区域，把注意力引到变化处 | 触发点 100ms 内有反馈（同 T-01）；落点以外的区域对比降低 | Change Blindness（同 L-02）；Executing UX Animations: Duration and Motion Characteristics — https://www.nngroup.com/articles/animation-duration/ |
| L-08 | 同一时刻只让一处发生主要变化；必须同时变的元素放在同一区域 | 一次点击引发的、彼此相距 > 15° 的独立动画区域 ≤ 1 处 | Change Blindness（同 L-02） |
| L-09 | 点击后下一步要操作的东西（关闭、播放、选项）放在触发点附近，不让指针横跨半屏 | 下一步的主要控件距触发点 ≤ 视角 15°（参考屏约 550–600 px），或就在原位 | Fitts's Law（同 L-01）；Fitts's law — https://en.wikipedia.org/wiki/Fitts%27s_law |
| L-10 | 少量信息与少量操作用锚定在触发器上的弹层；内容多、要停留很久才换成面板或全屏 | 弹层不遮触发元素，箭头 / 尾巴 / 起始点指向它；内容超过一屏才升级 | Popovers（同 L-01）；Sheets — Apple HIG — https://developer.apple.com/design/human-interface-guidelines/sheets ；Bottom Sheets — https://www.nngroup.com/articles/bottom-sheet/ |
| L-11 | 边缘抽屉 / 侧边面板只放从这一侧打开的补充内容，它的触发器在同一侧的边缘 | 触发器与面板锚定的边在同一侧（屏幕左右分半判定） | Side sheet（MDC Android，同 L-05）；Side sheets — Material 3 — https://m3.material.io/components/side-sheets/guidelines （UNVERIFIED，只见搜索摘要） |
| L-12 | 时长与位移距离成正比：小反馈约 100ms，大幅变化 200–300ms，跨大屏的大位移最多约 400ms；退场比进场短（与 T-09～T-11 一致） | 超过 500ms，或跨屏大位移不到 200ms，都算不合格 | Motion（MDC Android，同 L-01）；Executing UX Animations（同 L-07） |
| L-13 | 外围区域的自发运动要慢、要少，不和用户刚触发的变化抢注意 | 用户操作后 1s 内，触发区以外没有快速的自发动画 | Animation for Attention and Comprehension（同 L-02）；Motion — Apple HIG（同 L-04） |
| L-14 | 画面主体（角色、场景焦点）留在中间区域，常驻 UI 收在边缘与角落，尽量做成「世界里的东西」（diegetic / spatial）；刚点出来的东西仍从触发点长出 | 常驻 UI 不进入画面中心 1/3；展开后的 UI 不盖住主体焦点 | User interface design in video games — https://www.gamedeveloper.com/design/user-interface-design-in-video-games （二手综述）；Games, psychology and UX with Celia Hodent（GDC Podcast ep. 8）— https://www.gamedeveloper.com/design/games-psychology-and-ux-with-celia-hodent---gdc-podcast-ep-8 （UNVERIFIED） |
| L-15 | 一屏只有一个主焦点；放大、加对比、特效这类强调手段最多三档，冲击效果只给当前焦点 | 同屏「最强」一档的元素 ≤ 1 个，强调档位 ≤ 3 | Visual Hierarchy in UX — https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ ；Twelve basic principles of animation — https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation |
| L-16 | 预备动作（anticipation）与舞台调度（staging）先把视线引到将要变化的位置，再发生变化 | 远距离变化之前，触发点或路径上有 ≥ 1 帧方向性的预备 | Twelve basic principles of animation（同 L-15；Disney 原著未打开，用的是维基转述） |
| L-17 | 一起运动的元素被看成一组（共同命运）：面板展开时，它和触发元素的运动连成一体，不各动各的 | 展开过程中触发元素与面板的位移同向、同节奏 | Principles of grouping — https://en.wikipedia.org/wiki/Principles_of_grouping |
| L-18 | 弹层和面板不遮住打开它的元素，也不遮使用时要看的主要内容；必须遮的，原位留出原路关闭的入口 | 打开后触发元素仍可见，或原位变成「关闭 / 收起」 | Popovers（同 L-01）；Bottom Sheets（同 L-10） |

## 经验做法（无规范来源，按项目验证）

以下每条都是**设计推断**：有的综合了上面几条，有的来自单个产品的实测，拿来当假设用，需在目标产品上验证后才能当结论。

| 编号 | 做法 | 怎么检查 | 推断依据 |
|---|---|---|---|
| X-01 | 反馈手段按交互分级：位移 / 缩放 = 操作被接住，颜色 / 光 = 状态变化，粒子 + 音效 = 少数仪式时刻；不错配 | 列出一屏所有反馈，找错配（如保存设置也撒花） | 推断，综合 G-02、T-14 |
| X-02 | 常驻卡片只给细描边和极浅阴影，深而散的阴影留给临时弹层，用高度差拉开层级 | 常驻与临时浮层的阴影是否明显不同档 | 推断，来自单个产品计算样式实测 + M-01、M-02 |
| X-03 | 叠在复杂画面上的常驻面板用近实底（不透明度约 0.92 以上、模糊小），不追求玻璃感 | 量背景 alpha 与模糊值；配合 M-06 测最差点 | 推断，综合 M-06、M-08、M-09 与同类实测 |
| X-04 | 深色复杂背景上的浅色卡：贴边一圈暗色细环负责「切」出轮廓，扩散阴影负责「抬」起来；最大模糊约为卡高的 1/3 | 放到最亮和最暗两处，轮廓是否都清楚 | 推断，综合 M-03、M-04 |
| X-05 | 「套件感」检查：把界面元素截出来放到白底上，若能原样放进任何产品，说明没有和作品绑定；每个面板至少有一个属性（色温、材质、光向）取自作品画面 | 白底剪贴测试；逐个面板说出它取自画面的属性 | 推断，综合 G-04、G-06 |
| X-06 | 装饰预算：金线、角花、印章这类装饰只给少数「仪式」器物，每屏至多一处，日常面板零装饰 | 数一屏装饰元素，> 1 处时问「这一屏是仪式时刻吗」 | 推断，综合 P-07、E-09 |
| X-07 | 可爱化只用在小物件上，面板结构保持成熟 | 圆脸大眼等元素是否出现在结构件上 | 推断，综合 P-16 |
| X-08 | 主任务是某个面板时，一次点击直达最终尺寸，「小卡 → 大窗」两步展开是纯成本；小卡只作预览 | 打开主任务面板要几步、中间态是否必经 | 推断，综合 O-11 与客服浮窗的用户反馈 |
| X-09 | 状态差别不靠读字：播放 / 暂停用运动有无（转与不转、伸与缩）区分，并为减少动效提供静止替代 | 静音截图里能否分辨状态；开 reduced-motion 后是否仍可分辨 | 推断，综合 W-04、T-13 |
| X-10 | 计数组件的大数字是唯一视觉重心（约占组件高 35–50%），单位约为数字 1/3，情绪元素只占一角 | 量数字占比；情绪元素是否与数字抢 | 推断，综合 W-01、W-09 |
| X-11 | 纯 emoji 消息按个数放大（1 个最大，≥ 4 个与正文同大），贴纸无气泡 | 发 1 / 2 / 3 / 4 个 emoji 截图对比 | 推断，来自主流聊天产品的帮助页摘要 |
| X-12 | 已读回执对亲密关系是双刃剑：默认开、可关 | 设置里有无关闭开关 | 推断，来自质性研究摘要，配合 E-07 |
| X-13 | 界面音效比环境声低约 6dB，用接近场景材质的音色 | 录音对比响度 | 推断，综合 E-11 |
| X-14 | 场景级过渡（换场景、换时段）可比界面动效长，约 400–600ms 交叉淡化；界面面板之间仍守 T-09 | 分别量场景切换与面板切换时长 | 推断，综合 T-09、T-11 与 cozy 的渐进过渡主张 |
| X-15 | 关键状态信息（对方在线、正在输入）放在画面焦点（人物）附近而不是屏幕角落 | 量状态到焦点的距离 | 推断，G-05 的研究只测了游戏弹药显示，迁移需验证 |

## 怎么补充

- 新一轮审核查到新规则：加在对应领域表的末尾，续编号，来源写标题 + 直链，并在规则后注明发现日期（如「2026-12-03 补」）。
- 没打开原文核验的不收；有用但无规范来源的进「经验做法」，续 `X` 编号并写明推断依据。
- 某条经验做法在两个以上项目里验证成立并找到来源，可升入对应领域（换新编号，原 `X` 编号在下方记一行）。
- 规则失效或被推翻（规范改版、研究被推翻）：从表中删掉，编号不复用，在下面记一行：日期 · 编号 · 原因 · 新来源。

变更记录：

- 2026-11-11 · 初版，由五份调研证据合并去重而成。
- 2026-11-15 · 加 L 节「视觉流与触发处展开」18 条（来自一份视觉流调研；用到的出处里 2 条 UNVERIFIED，已在条目里标出）；「先看」加 L-01、L-11。
