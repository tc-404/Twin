# sssx-spjx · 视频解析（双生插件）

一份代码同时挂在两条协议上：**OneBot / NapCat（野生）** 与 **QQ 官方机器人**。
解析 **抖音 / 快手 / B站 / 小红书** 的链接。

小红书按全网核对后的域名全集收录（主站、国际站、四套短链、CDN）：

| 类型 | 域名 |
| --- | --- |
| 主站 | `xiaohongshu.com` |
| 国际站 | `rednote.com` |
| 短链 | `xhslink.com` `xhslink.cn` `xhsurl.com` `xhsurl.cn` `xhs.com` |
| CDN | `xhscdn.com` |

`xhsurl.*` 与 `rednote.com` 是后补的——原来会被解析器的「不允许的域名」挡掉。
域名判定是**整段 host 等于白名单或以 `.白名单` 结尾**，不会把 `abxhs.com`
这类野域名吃进来（子串匹配踩过坑）。

## 触发规则

| 场景 | 条件 |
| --- | --- |
| 群聊 | **必须 @ 机器人**；@ 的那条消息里含可解析链接就自动解析 |
| 私聊 | 不需要 @，直接匹配 |
| 匹配不上 | 不响应、不发送、**不打日志**（不刷「未匹配」噪音） |

协议侧的判定方式：

- 官方：**两种群事件都认，但必须 @ 了机器人才触发**。
  ⚠️ 不能只认 `GROUP_AT_MESSAGE_CREATE`——实测本机 `kakake/log/2026-10-13.log` 里
  机器人收到的群事件**全是 `GROUP_MESSAGE_CREATE`（37 条）**，一条 AT 事件都没有，
  只认 AT 会导致群聊永远不触发。
  真正的依据在事件自带的 `mentions` 数组里，平台直接标了 `is_you` / `bot`：
  ```jsonc
  // 被 @：  "mentions": [{ "bot": true, "is_you": true, "id": "4D8F…", "username": "机器人名" }]
  // 没被 @：整个事件里没有 mentions 字段
  ```
  这跟项目里在跑的 `GF-plugin-mkai`（index.mjs:15188）判定一致。单聊为 `C2C_MESSAGE_CREATE`。
- OneBot：消息段里存在 `at` 段且 `qq === self_id`；单聊 `message_type === 'private'`。

## 输出

- **官方机器人**：先发一条 Markdown（`msg_type=2`）—— 文本 + 封面 + 图集多图都塞进同一条
  MD（MD 支持多图，还能顺带文字）；随后**真发一条视频**（上传拿 `file_info` → `msg_type=7`）。
  MD 无法内嵌视频播放，所以顺序是「MD 信息 → 视频」，MD 末尾写「视频发送中，请稍等…」
  （照 GF_mk `video-parse.ts:95`）。

**MD 里的图片按原比例显示**。官方 MD 图片必须显式给宽高 `![alt#宽px #高px](url)`，
写死 640x360 会把竖图拉成横屏。所以会先探测原图尺寸（只读文件头，不下载整图，
支持 PNG / JPEG / GIF / WebP），再**等比缩放**：长边不超过 640、只缩不放，
竖图 720x1280 出来是 **360x640**，不会变成横屏。探测失败才退回 640x360。
小于 120px 的（B站封面常见 1x1 透明占位图）按同比例放大到能看清。
- **OneBot（野生）**：照抄 MKbot 视频解析的输出规则
  （`MKbot/src/mkbot-core.ts` 的 `视频解析统一输出`，18671-18869）：
  - 单视频（有视频、无图集、无实况）→ **只发视频**，简介/封面一律不带
  - 有图集 / 实况 → 合并转发：首节点 = 信息文本 + 封面，其后各图一节点；
    主视频**不进**合并转发、单独发；失败再补一条原链接

信息文本格式同样照抄 MKbot 各平台分支（B站 18973 / 抖音 19008 / 小红书 19069 / 快手 19117）。

## 目录与构建

源码目录叫 `sssx-spjx`，但框架对双生插件的**硬规则**是目录必须以 `sssx-plugin-` 开头
（写成 `sssx-spjx` 不会被加载，见 `kakake/使用教程/插件开发/SS-双生插件/说明.md` §二）。
所以构建产物目录自动改名为 **`sssx-plugin-spjx`**：

```
sssx-spjx/                     ← TS 源码项目（你在这里开发）
├── src/
│   ├── index.ts               插件入口
│   ├── types.ts               双生 ctx / 事件类型
│   └── lib/
│       ├── api/               四个解析器（复制自 kakake/src/tools/media）
│       │   ├── blbl.ts  dy.ts  ks.ts  xhs.ts  http-utils.ts
│       │   └── loader.ts      运行时动态 import lib/api/*.mjs
│       ├── parse.ts           识别平台 + 归一化
│       ├── trigger.ts         @ 判定 / 文本清洗
│       ├── format.ts          MKbot 同款信息文本
│       ├── send-official.ts   官方 MD 输出
│       └── send-onebot.ts     OneBot 输出（MKbot 规则）
└── sssx-plugin-spjx/          ← 构建产物，整个丢进 plugins/
```

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # vite build + 单独打包 lib/api/*.mjs
npm test            # 触发规则自测（11 条断言）
```

**双击 `build.bat`** 一步到位：装依赖 → 构建 → 打包 zip。
产物两份：

- `sssx-plugin-spjx/` —— 整个目录复制到 kakake 的 `plugins/` 下
- `dist/sssx-plugin-spjx-v<版本号>.zip` —— 后台「导入插件」直接用这个
  （zip 内保留 `sssx-plugin-spjx/` 顶层目录；框架 `plugin.importer.ts:256`
  的 `resolvePluginRoot` 两种结构都认，带一层目录解压时不会散落）

> bat 是全英文 ASCII：cmd 按 GBK 解析脚本，中文注释会乱码成命令
> （照 `GF_mk/build.bat` 的写法）。

> `lib/api` 为什么单独打包：运行时由 `loader.ts` 动态 import 这些 `.mjs`。
> 若被主构建内联进 `index.mjs`，运行期就找不到 `lib/api` 目录了（机制照抄 GF_mk）。

## 几个坑（都是踩过的）

1. **官方 `content` 里的 @ 要全局剥**：实测接收侧给的是旧格式 `<@32位openid>`，
   位置不固定，**也会出现在句尾**（`kakake/log/2026-10-13.log` 有真实例子）。
   只剥开头会漏，链接就匹配不上。
2. **`msg_seq` 不能写死 1**：官方规定相同 `msg_id` + `msg_seq` 重复发送会失败，
   同一条消息回第二次起要递增。
3. **官方 MD 需内邀开通**，被动 MD 还要单独申请。没开通时 `msg_type=2` 会被拒，
   代码里已做回退：改发纯文本。
4. **群/单聊的 openid 不通用**：`member_openid` 只在群内有效、`user_openid` 只在单聊有效，
   别一条 `a || b` 兜底去打另一套接口。

## 已知取舍

- **官方侧视频靠官方拉取 URL 上传**（`file_type=2` + `srv_send_msg: false`）。
  大视频（几十 MB 起）很可能上传超时或超限——失败时不会卡在「请稍等」，
  会补一条文本把原链接发出去（`send-official.ts` 的 catch）。
  若经常遇到大视频失败，可改成本地下载后再用 `file_data` 上传（GF_mk 也支持这条路径）。
- MD 消息本就依赖「官方 MD 内邀开通 + 被动 MD 单独申请」；没开通时 `msg_type=2` 被拒，
  已做回退：改发纯文本，视频照常发。
- OneBot 侧的图片/视频直接给 URL 段，由协议端自行下载；
  不落临时文件（MKbot 是先下载再上传，为的是规避协议端限制，双生插件暂无必要）。
