# Shelf 参考（按需读）

> 不随技能常驻：排查货架在哪、在新机器或临时机器上用 shelf、或给用户介绍交互浏览器时才读。常用命令与守则在 `SKILL.md`。

## 货架从哪来

`SHELF_HOME` 环境变量 → CLI 自身所在 clone → `~/.shelfrc` 的 `home` → 托管档口 `~/.shelf/home`（全局安装场景下首次运行自动创建）。

- 临时机器不想留档口：`SHELF_EPHEMERAL=1` 走一次性 clone，用完即删。
- **免 clone 设备**：`npx -y -p github:Jackzz119/my-workspace shelf <命令>`——读操作用 npm 包内快照，push/create 自动走临时 clone（remote 内置在 package.json，前提是该设备 git 能访问私有仓）。所有命令用法完全一致。

## 这台机器还没装 shelf？

```bash
npm i -g @jackss119/shelf     # 装完命令就是裸 shelf；首次运行自动开档口，无需手动 clone
```

免安装临时用：`npx -y -p github:Jackzz119/my-workspace shelf <命令>`（读走包内快照，写走临时 clone）。

## 给用户介绍浏览器时（你自己别跑）

用户手动运行 `shelf` 进入浏览器后的按键：数字 = 进入该目录；`p 1,3-5` = 拉取所选；`a` = 全部拉取；`..` = 上级；`q` = 退出。`shelf create`（不带 `--to`）的选位浏览器：数字 = 进入；`m <名>` = 新建目录并进入；`d` = 放在这里；`q` = 取消。
