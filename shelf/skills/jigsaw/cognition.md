# 认知负担、心流与手感速查

> 出处编号见文末。标「未核实」的本次没读到原文；标「推断」的是从理论推到设计的判断，用之前先在自己的游戏里验证。

## 两类负担

玩家说「累」的时候，先分清累在哪一类。

| | 玩家想要的 | 玩家不想要的 |
| --- | --- | --- |
| 是什么 | 推理、取舍、洞察、发现技巧 | 搜索、记账、背清单、重复点选、等待 |
| 理论名 | 内在负荷：来自题目本身 | 外在负荷：来自呈现方式，与题目无关 [1] |
| 怎么办 | 保留，随难度递进 | 交给界面：先靠呈现，再靠自动化 |

- 内在负荷越高，外在负荷的代价越大 [1]。所以越难的内容越要先把界面的负担清干净。
- 判据：这一步如果由机器替玩家做，玩家会觉得被抢了乐趣，还是松了一口气？松一口气的就是该拿掉的。
- 有的玩家就喜欢那份记账的劳动 [2]。减负做成可以关的，挑战向的模式里默认不开。

## 工作记忆与「找缺」

- 同时能握住的东西大约 4 块 [3]（未核实原文）。超过这个数、又没有顺序可依的集合，玩家只能逐个比对。
- **问「还缺哪个」是记忆任务**：给出一个已知集合里除一项外的全部、让人说出缺的那项，本来就是测即时记忆的实验范式 [4]。数字、字母这类有背诵顺序的集合可以顺着数；任意的图案集合没有清单可背。
- 找「不在场」的东西比找「在场」的慢，每项耗时大约是两倍或更多 [5]。
- 目标和干扰项越像、干扰项彼此越不像，搜索越慢 [6]。一组各不相同的精美图标，是干扰项最杂的情形。
- 通则（推断）：
  1. **把清单搬到界面上**：选项区固定顺序、固定位置，让位置记忆代替背诵。
  2. **识别代替回忆**：把「还能选什么」亮出来，不让玩家自己排除。
  3. **用完即消**：不再可用的选项置灰或移走，并显示剩余数量。
  4. **同类一眼可见**：选中一个，全场同类高亮。
  5. 需要顺序时，让符号自带顺序（数量、大小、层数、色相），或加可关的角标。
  6. 集合大小是最硬的旋钮：种类降到 4 以内，这类负担基本消失。

## 心流与难度

- 进入心流的条件：挑战与技能相称、目标清楚、反馈即时；太难焦虑，太易无聊 [7]（二手综述）。
- 难度整体上行但呈锯齿：新机制出场或一组关卡结束后回落再爬，新机制不与难度峰值叠在一起（通行）。
- 休闲向的硬数据：越靠技巧、越长的关卡参与度越低，越难的关应该越短 [8]。

## 放松向（cozy）的准则

- 定义：游戏唤起**安全、丰裕、柔和**的强度。安全是没有威胁、活动可以不做；丰裕是什么都不缺、不催；柔和是低刺激、慢节奏、规模可掌控 [9]。
- 破坏项 [9]：威胁；制造交易感的外在奖励；责任（必须维护、黏人的宠物）；通知与催促；突然、过亮、过响的刺激；限时活动；强推稀缺。
- 做逻辑谜题有两条路（推断）：
  - **去掉「正确」**：怎么放都行，越放越好。
  - **保留正确、去掉代价**：可以回退、有讲道理的提示、不计时、不扣命。每格只有一个答案的谜题只能走这一条。
- 「唯一正解」本身不破坏放松；破坏它的是受罚、计时和记账。

## 输入便宜，反馈丰厚

- 休闲爆款的结构：单步输入成本极低、几乎总有路可走、一次输入换来一连串回应、失败可以归给运气 [10][11]。
- 每个输入都要有被放大的回应（缓动、形变、粒子、音效），逐项叠加、逐项对比 [12]。放松向和信息密集的界面要减量。
- **juice 救不了无趣的核心**：关掉全部特效还好玩吗？
- 反馈强度与事件的重要性成正比；小事件不抢大事件的戏（推断，依据 [13]）。
- 逻辑谜题借用这套结构的办法（推断）：把玩家做对一步之后那些「只剩一种可能」的收尾交给系统连锁完成，让最少的输入换来最多的输出；玩家出的是洞察，系统出的是劳动。
- 近失（差一点就赢）能拉人继续，但靠的是挫败 [14]，不适合放松向。

## 失败、提示与教学

- 失败要让玩家说得出「下次该怎么做」：讲清原因、重试成本低、不羞辱（[15]，做法为归纳）。放松向可以不设失败。
- 提示是在延长兴趣：分级给、只给卡住的人、最后肯给答案 [16]。
- 教学十条 [17]：融进游戏；做而不是读；分散着教；做一次就够；少用字；提示不打断；只对犯错的人提示；不制造噪音；用视觉教；借用玩家已有的常识。
- 第一分钟：目标一看就懂、容易开始、有进展感，并已亲手成功一次 [16][17]。

## 诊断问题

- 这一屏要玩家同时记住几件事？哪几件可以让界面替他记？
- 玩家此刻是在想，还是在找？
- 最常做的那个动作，从动手到看到回应隔了多久、回应有多大？
- 玩家有没有哪一刻是「不得不做」的？
- 把所有辅助都打开，剩下的部分还有意思吗？（没意思，说明乐趣本来就不在推理里）

## 出处

1. Sweller 2010，Educational Psychology Review 22 https://link.springer.com/article/10.1007/s10648-010-9128-5
2. Zach Gage 访谈 2024 https://hey.gg/blog/zachgage ；Good Sudoku 官网 https://www.playgoodsudoku.com/
3. Cowan 2001 https://pubmed.ncbi.nlm.nih.gov/11515286/
4. Buschke 1963，Science 140（缺项扫描任务）https://www.millisecond.com/library/missingscantask
5. Treisman & Souther 1985；Wolfe 1998 https://www.cns.nyu.edu/~david/courses/perceptionLab/Readings/Wolfe1998.pdf
6. Duncan & Humphreys 1989 https://www.mrc-cbu.cam.ac.uk/bibliography/articles/2331
7. Csikszentmihalyi《Flow》；Nakamura & Csikszentmihalyi 2002（二手综述）
8. King，GDC 2024，报道见 https://mobilegamer.biz/how-king-defines-a-good-candy-crush-saga-level-and-why-it-constantly-prunes-the-bad-ones/
9. Short、Cook 等，Project Horseshoe 2017「Cozy Games」https://lostgarden.com/2018/01/24/cozy-games/
10. Gabler 等 2005 https://www.gamedeveloper.com/game-platforms/how-to-prototype-a-game-in-under-7-days
11. Palm（King），GDC 2013 https://gdcvault.com/play/1018053/Candy-Crush-Saga-Postmortem-Luck
12. Jonasson & Purho 2012「Juice It or Lose It」https://gdcvault.com/play/1016487/Juice-It-or-Lose
13. Celia Hodent 2017《The Gamer's Brain》https://celiahodent.com/understanding-the-success-of-fortnite-ux/
14. Larche 等 2016，Journal of Gambling Studies 33(2) https://pmc.ncbi.nlm.nih.gov/articles/PMC5445157/
15. Jesper Juul 2013《The Art of Failure》（未核实原文）
16. Jesse Schell《The Art of Game Design》谜题十原则
17. George Fan，GDC 2012 https://gamedeveloper.com/design/gdc-2012-10-tutorial-tips-from-i-plants-vs-zombies-i-creator-george-fan
