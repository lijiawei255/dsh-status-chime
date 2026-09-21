# dsh-status-chime

**[中文](README.md) | [English](README.en.md)**

> 给 DeepSeek Harness 加上「会说话的状态提示」：任务跑完、出错、后台任务结束、需要你回答时，用声音告诉你，而不是只让任务栏图标闪一下。

![platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-lightgrey)
![license](https://img.shields.io/badge/license-MIT-blue)

---

## 为什么做这个

DSH 自带的通知是**视觉**的：任务栏图标闪烁 + 系统气泡。这类提示有一个隐含前提——**你得正在看着屏幕**。

但真正需要被通知的时刻，往往正是你不在屏幕前的时候：

- 一个跑了十几分钟的任务终于结束
- 后台任务失败，而你已经切去干别的了
- 代理停下来等你回答一个问题，却在原地等了半小时
- 目标被卡住，需要你介入才能继续

于是提示被错过，时间被浪费。**换成声音之后，「必须盯着」就变成了「听得见就行」**——你可以去泡杯茶、看会儿书、或者在另一台机器上干活。

装好即用，不需要配置任何东西。

## 八个场景

时长是**刻意设计**的：**长 = 有事需要你，短 = 有事情结束了**。

准确地说，它是**三个带**，而不是「每一条都比下一条长一截」：

| 带 | 时长范围 | 场景 |
|---|---|---|
| 失败 / 受阻 —— 最需要你 | 4.8 – 8.0s | `turn-error`、`job-failed`、`goal-blocked` |
| 在等你动手 | 3.0s | `approval` |
| 事情结束（或只是简单问一句） | 1.6 – 2.6s | `job-done`、`goal-complete`、`needs-input`、`turn-done` |

**同一带内的两条刻意靠得很近**，因为它们的紧急度本来就同级：`goal-complete`（2.16s）和 `needs-input`（2.09s）只差 **0.07s**，中文那套也一样（差 0.07s）。**靠声音长短能分辨的是「带」，不是每一条。**

| 场景 | 什么时候响 | 中文 | 英文 | 紧急度 |
|---|---|---|---|---|
| `turn-error` | 本轮失败，或撞到 token 上限 | **7.97s** | 7.90s | 失败/受阻 —— 最长 |
| `job-failed` | 后台任务失败 | 5.95s | 6.46s | 失败/受阻 |
| `goal-blocked` | 目标受阻，需要你介入 | 4.78s | 4.85s | 失败/受阻 |
| `approval` | 有操作在等你批准 | 3.00s | 3.00s | 在等你动手 |
| `job-done` | 后台任务完成 | 2.59s | 2.59s | 已结束 |
| `goal-complete` | 目标整体完成（只响一次，不是每轮） | 2.16s | 2.16s | 已结束 |
| `needs-input` | 代理停下来等你回答 | 2.09s | 2.09s | 简单问一句 |
| `turn-done` | 你发起的那一轮正常结束 | 1.58s | 1.92s | 已结束 —— 最短 |

⚠️ **两套时长不一样，别混用。** 中文和英文是各自合成的（不同音色、不同语言），所以顺序一致但数值不同：英文 `job-failed` 是 **6.46s**，中文是 **5.95s**。上表两列都给了，按你实际用的语言看那一列。

两条**过滤规则**值得单独说明，它们避免了这个插件变成噪音源：

- **`turn-error` 不看是否由你发起**。自动续跑的回合出错，同样需要你知道。
- **`turn-done` 只看你发起的回合**。否则一个跑 20 轮的目标会响 20 次「任务完成」。自动推进的进度由 `goal-complete` / `goal-blocked` 在**目标级别**汇报，而不是每一轮。

`approval` 只在审批策略为 `ask`（需要人工确认）时才会响 —— 策略是 `never` 时没有任何东西在等你，自然也不该出声。它监听的是**会话事件 `approval/asked`**，这条在 `ask` 策略下必定派发；另外还挂了作用域瀑布 `approval/request` 作兜底，两条路径播的是同一条音。

音频试听（GitHub 的 Markdown 不支持内嵌播放器，所以放在 Release 里，点开即可播放）：
见 [Releases](https://github.com/lijiawei255/dsh-status-chime/releases) 页面的音频附件。

## 两种语言：中文（默认）和英文

**同一套安装包，八条场景各带中英两版音频**，来回切换不需要重装。默认是中文。

```
/voice-alerts lang        # 看当前语言
/voice-alerts lang en     # 切到英文
/voice-alerts lang zh     # 切回中文
```

切换会写回配置文件（`language` 字段），重启后仍然生效。也可以直接改配置：

```json
{ "language": "en" }
```

### 英文不是翻译，是重写的

这一点值得说明，因为它关系到这个插件的核心设计。

中文原文直译成英文会变长、变平，而**「时长 = 紧急度」正是这个插件唯一的信息载体** —— 一旦英文长度失控，光凭声音长短判断要不要过去就失效了。所以英文八条是按英语语境**重写**的，不是逐句翻译：

| 场景 | 中文 | 英文 |
|---|---|---|
| `turn-done` | 任务完成。 | Turn complete. |
| `needs-input` | 需要你回答。 | Waiting for your answer. |
| `goal-complete` | 目标已完成。 | The goal is complete. |
| `job-done` | 后台任务完成。 | The background job has finished. |
| `approval` | 有操作等待你批准。 | An action is waiting for your approval. |
| `goal-blocked` | 目标受阻，需要你介入处理后才能继续。 | The goal is blocked. It needs you before it can continue. |
| `job-failed` | 后台任务失败，请回到 DSH 查看详情。 | The background job failed, and it needs your attention. Check DSH for details. |
| `turn-error` | 任务执行出错，本轮未能完成，请回到 DSH 查看错误详情。 | The turn failed, so this round did not finish. Open DSH to see the error details, then try again. |

英文版的时长梯度是 **1.92s → 7.90s**，与中文**同样单调**（同样按严重度递增）。真正拉开的是**三个紧急度带**：跨进「失败/受阻」带的那一步有 **38%**（3.00s → 4.85s）。**同一带内刻意靠得近** —— `goal-complete`（2.16s）与 `needs-input`（2.09s）只差 **0.072s**，中文那套也一样。所以靠长短分辨的是**带**，不是每一条。

> ⚠️ 这里踩过一个坑，记下来：英文 `turn-error` 最初只有 16 个词、6.55s，而 `job-failed` 是 6.46s —— 只差 0.10s，**耳朵根本分不出来**。中文那边两者差 2.02s（**25%**，相对较长者；本文件所有百分比都按这个口径）。后来把英文错误文案加长到 19 个词，才恢复到 7.90s / 1.44s 的差距。**如果你改文案，记得重新量一遍时长**，别只看中文字数。

英文用的音色是 `loongmary`（温暖英音），**不是让中文音色去读英文**。试听过三个候选并做了排序（`scripts/qa.mjs rank`，产物写到 `qa/`，该目录不进版本控制；重跑一次名次不变）。中文音色读英文得分最低，评语是「明显合成感、节奏不自然」——**自然度 4/10、音色 5/10**（这两个分数容易记混，`naturalness` 是 4，`character` 才是 5）。

`/voice-alerts status` 会同时列出两种语言各自的音频是否齐备：

```
Clip sets: zh (active): all clips present  |  en: all clips present
```

## 装之前先知道三件事

1. **平台：Windows 10/11。** 保底播放器用的是 Windows 自带的 PowerShell + `System.Media.SoundPlayer`，**没有 macOS / Linux 支持**。装了 ffmpeg 会优先用 `ffplay`，但那只是可选增强。
2. **需要 DSH Desktop**，以及能跑 `dsh` 命令的终端。装插件走 `dsh plugin`，它内部调用 **pnpm**（见下面的坑）。
3. **音频不用装任何东西** —— 中英两套 32 个音频文件都在包里。

### ⚠️ 一次性提醒：包名和运行时名字不一样

这个容易让人找错地方，先说清楚：

| | 名字 |
|---|---|
| **npm 包 / GitHub 仓库** | `dsh-status-chime` |
| **斜杠命令** | `/voice-alerts` |
| **日志前缀** | `[voice-alerts]` |
| **配置文件** | `$DSH_HOME/voice-alerts.config.json`（主路径） |
| **音频目录** | `$DSH_HOME/voice-alerts/clips/` |
| **cordis id** | `voice-alerts` |

> 配置还有一个**兼容用的旧位置** `$DSH_HOME/voice-alerts/voice-alerts.config.json`。插件只读**先找到的那一个**（先查主路径），所以：如果主路径的文件已存在，你改旧位置那个文件会被**静默忽略**。`/voice-alerts lang` 和 `on/off` 都会写到主路径。拿不准时看启动日志里的 `config <路径>` 那一行。

**包名在 0.3.0 从 `dsh-voice-alerts` 改成了 `dsh-status-chime`**（原来的名字和社区目录里另一个插件只差一个字母，会被市场规则隐藏）。改名**只动包名和仓库名**：命令、配置路径、日志前缀全都还是 `voice-alerts`，所以老用户升级不会坏。

**排查问题时去日志里 grep `voice-alerts`，不是 `dsh-status-chime`。**

## 安装

### 方式一：交给你的 Agent（推荐）

把下面这句话发给你的 DSH：

> 把 `https://github.com/lijiawei255/dsh-status-chime` 装进我的 DSH desktop profile，装完提醒我重启。

仓库里有一份 [INSTALL.md](INSTALL.md)，写清了每一步该做什么。它存在的意义是：**让不同的 Agent 装出同样的结果**，而不是各自发挥。

### 方式二：自己敲命令

把 `<PROFILE>` 换成你自己的 profile 名（通常是 `desktop`）。**先看一眼 `$DSH_HOME/profiles/` 下有哪些目录再决定**，不要照抄别人的：

```powershell
# 从 GitHub 直接装
dsh plugin --profile <PROFILE> add github:lijiawei255/dsh-status-chime

# 或者先 clone / 下载 ZIP，再指向本地目录
git clone https://github.com/lijiawei255/dsh-status-chime
dsh plugin --profile <PROFILE> add .\dsh-status-chime
```

这条命令会做两件事：把包装进 profile，并把包登记为一个 profile 层（前提是包里声明了 `dsh.bundle`，本仓库已经声明了）。

**⚠️ 如果报 `ERR_PNPM_ADDING_TO_ROOT`**：profile 自带一个声明了 `packages: [.]` 的 `pnpm-workspace.yaml`，pnpm 9 会因此拒绝裸 `add`。加一个 `-w` 即可：

```powershell
dsh plugin --profile <PROFILE> add -w github:lijiawei255/dsh-status-chime
```

（实测过的是：pnpm 9 会报错、pnpm 11.8.0 正常；**pnpm 10 没测过**。所以最稳的是加 `-w`。）详见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 第 11 条。

**装完必须完全重启 DSH Desktop**，否则插件不会加载。

### 重启之后

在聊天框里敲：

```
/voice-alerts status
```

看到 `Voice alerts: on (v0.3.0)`、`Language: zh`、`Scenes (8)` 就说明装好了。想听一遍全部八条：

```
/voice-alerts
```

### 卸载

```powershell
dsh plugin --profile <PROFILE> remove dsh-status-chime
```

卸载**不会**删除你 `$DSH_HOME` 下的东西。想彻底清干净，删这两处：

```powershell
# 音频、play.ps1、clips.json
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\voice-alerts"
# 运行时配置（配置**不在**上面那个目录里，是同级的一个文件）
Remove-Item -Force "$env:USERPROFILE\.dsh\voice-alerts.config.json"
```

质检报告不在 `$DSH_HOME` 下——它写在**仓库/包目录**的 `qa/report.md`。同样需要**完全重启 DSH Desktop** 才生效。

## 它怎么工作

```
DSH 事件  ──▶  lib/index.js  ──▶  聚合 / 节流 / 优先级  ──▶  播放器  ──▶  音频文件
```

**事件来源**（都是宿主进程里的公开事件）：

| 事件 | 用途 |
|---|---|
| `session/event` → `turn/start` / `user/message` / `turn/end` | 判断这一轮是不是你发起的，以及它是怎么结束的 |
| `session/event` → `goal/change` | 目标的 `complete` 与 `block` |
| `jobs.onJobDone` | 后台任务的 `completed` 与 `failed` |
| `tools/pre-execute` | 工具名命中 `waitingTools` 时，说明代理要停下来等你 |
| `session/event` → `approval/asked` | **主路径**：审批策略为 `ask` 时必定派发 |
| `approval/request` | **兜底**：作用域瀑布，同样只在 `ask` 下可能派发；两条路播同一条音 |

**播放规则**：同一 400 毫秒窗口内的多个事件只播**优先级最高**的那条；同一场景 1.5 秒内不重复；新的提示会打断正在播的那条。

**运行时零网络**：插件只读本地音频文件、只启动本地播放器。不联网、不上传、不校验。

## 技术栈：用大模型给声音做「预审」

这部分是我觉得最值得分享的地方。

给提示音挑一个合适的音色，传统做法是**一个个盲听**：试 10 个音色、改 20 次风格描述、听到耳朵疲劳，最后凭模糊印象拍板。这个项目换了个做法——**让大模型先做初筛和排序，人只在筛出来的少数里做最终决定**。

具体是三件事：

**1. 用全模态模型当评审（核心）**

`tools/qw_local_omni.py` 把**多段候选音频一次性**交给 Qwen-Omni，让它横向比较并按维度打分：

```powershell
python tools/qw_local_omni.py preview/flash-mary-en.mp3 preview/flash-eva-en.mp3 preview/flash-yuanfei-en.mp3 `
  --message "横向比较这几段录音，按清晰度/自然度/音色/干净度打分并排序"
```

拿到的是一个**排序**而不是一堆孤立分数——「A 比 B 更贴目标」这种相对判断，比「A 得 7 分」有用得多。实测给出的排序和理由相当具体：

> A4 是唯一一个在保持清晰稳重的基础上，做到了低沉与气声质感的音色。A2 虽然成熟但不够有辨识度，A5 略显平淡，A1、A3、A6 则因音色过亮或过嫩而被排除。

**2. 用 ASR 转写回读做客观校验**

光听着顺耳不够——TTS 可能吞字、念错、把缩写拆开读。`tools/qw_local_asr.py` 把音频转回文字，与预期文案做字符级相似度比对：

```powershell
python tools/qw_local_asr.py assets/clips/turn-error.mp3 --lang zh
```

这条是**可以当硬门槛的客观指标**：文案是已知的，转写对不对是机械可判的。本项目中英各 8 条、共 16 条音频的相似度都是 **1.000**。

**3. 时长梯度作为信息编码**

上面表格里的时长不是随手定的，而是把「严重程度」编码进了音频自身：**长 = 需要你出手**。这样即使手机在旁边、屏幕没看，也能靠声音长短判断该不该放下手里的事。

**由此得到的完整流程**（`scripts/` 里两个脚本，可直接复现）：

```
scripts/build.mjs audition    出多个音色候选
      ↓
scripts/qa.mjs rank           全模态模型横向排序（不做 ASR；回读在下一步）
      ↓
人听筛出来的前 2-3 个，拍板     ← 决策量被压缩到很少
      ↓
scripts/build.mjs build       批量生成 + 响度归一
      ↓
scripts/qa.mjs clips          全部质检过关
```

**一点经验**：不要把大模型的主观打分当硬门槛。实测同一段音频两次评分能从「自然 6 / 音色 4」跳到「自然 9 / 音色 7」，四段明显不同的音频甚至拿到过完全一样的分数。所以本项目把指标分了两层——**客观项（ASR 相似度、有无削波、清晰度、干净度）当门槛，主观项（自然度、音色、成熟度）只作参考**，最终由耳朵决定。这个分工是这套流程能稳定跑起来的关键。

**后来补上的三条检查**，都是先发现了具体漏洞才加的：

| 检查 | 性质 | 为什么加 |
|---|---|---|
| **静音下限**（峰值 ≥ −30 dB、均值 ≥ −35 dB） | 硬门槛 | 原来的峰值检查**只抓削波**，所以「时长正常但内容全静音」这种经典 TTS 失效**能全项通过**。实测成品峰值 −4.2…−1.9 dB、均值 −20.6…−16.6 dB，而全静音是 −91 dB。**两条线的余量不一样**：峰值门槛离最差成品 **25.8 dB**（−4.2 vs −30），均值门槛 **14.4 dB**（−20.6 vs −35） |
| **净语速**（去掉停顿后的单位/秒） | 参考项 | 中文**刻意放慢**（rate 0.95），套用人类播报那个 3.2–5.5 字/秒会把八条里的**七条**判失败。对这个项目真正有意义的是**条与条之间的一致性**（因为时长承载紧急度），所以跟**同语言中位数**比；少于 5 个单位的短句豁免，否则两个词的 clip 会假报警 |
| **UTMOS**（MOS 预测器） | 参考项 | 给自然度一个**可复现**的数字，补上「大模型打分不稳定」那一环。**必须按语言分别比**：它给英文八条的分**全部高于**中文八条（4.38–4.51 vs 3.75–4.28），跨语言比会读成中文那套有缺陷 |

这三条都有**反向验证**（`scripts/qa-negative-control.mjs`，离线运行、不花 API 额度）：注入全静音、极安静、语速拉长三类缺陷，断言门槛**确实报出来**，同时确认健康音频**不会被误伤**。一个只会说「通过」的检查器没有价值。

> 顺带记一个坑：加静音下限之前，先用 `ttsproof`（一个现成的 TTS QA 工具）试过。**它能抓削波和截断，但抓不到全静音** —— 它源码里的 `empty_audio` 只判断「文件不存在或 ≤44 字节」，不看音频内容。所以那条下限是自己加的，不是从工具里白拿的。

## 配置

配置文件：`$DSH_HOME/voice-alerts.config.json`（`$DSH_HOME` 通常是 `~/.dsh`）。
找不到这个文件时使用内置默认值，**所以不配置也能正常用**。文件按修改时间热读取，改完立即生效，不需要重启。

完整模板见 [`assets/voice-alerts.config.json`](assets/voice-alerts.config.json)。常用项：

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `volume` | `85` | 0-100，**只对 ffplay 生效** |
| `minIntervalMs` | `1500` | 同一场景的重复触发抑制窗口 |
| `coalesceMs` | `400` | 事件聚合窗口，窗口内只播最高优先级那条 |
| `interrupt` | `true` | 新提示是否打断正在播的 |
| `scenes.<场景>.enabled` | `true` | 单独关掉某个场景 |
| `player` | `"auto"` | `auto` / `ffplay` / `powershell` |
| `ffplayPath` | `null` | 显式指定 ffplay 路径（不在 PATH 上时用） |
| `playPs1Path` | `null` | 显式指定回退脚本 `play.ps1` 的路径 |
| `commandName` | `"voice-alerts"` | 斜杠命令名。与别的插件重名时只丢命令，不影响出声 |
| `waitingTools` | `["ask_user_question","exit_plan_mode"]` | 命中即视为「在等你回答」；DSH 若改工具名可在此覆盖 |
| `language` | `"zh"` | 语音语言：`zh` / `en`；无法识别的值回退到 `zh`（不会静默） |
| `watchApprovals` | `true` | 审批请求是否出声（只在策略为 `ask` 时可能触发） |
| `clipsDir` | `null` | 自定义音频目录，优先级最高 |

## 命令

| 命令 | 作用 |
|---|---|
| `/voice-alerts` | 依次播放全部八条（当前语言） |
| `/voice-alerts on` / `off` | 立即开关（会写回配置文件） |
| `/voice-alerts lang <zh\|en>` | 切换语音语言，写回配置 |
| `/voice-alerts status` | 看播放器探测结果、各语言各场景音频是否齐备 |
| `/voice-alerts test <场景>` | 只播一条，用来排查某类事件有没有触发 |

## 换成你自己的声音

音频不是必须用仓库里这 8 条（中英各 8 条）。完整流程：

```powershell
# 1. 改 assets/clips.json：文案在 clips.<场景>.text，音色在 model/voice/instruction
# 2. 换音色时先出样试听（把候选写在 voiceCandidates 里）
node scripts/build.mjs audition
node scripts/qa.mjs rank                 # 大模型帮你排序，人只挑最终那条
# 3. 把选定的 model/voice/instruction 写回 clips.json，然后批量生成
node scripts/build.mjs build
node scripts/qa.mjs clips                # 质检
```

生成音频需要：**ffmpeg**（响度归一与转码）、**Python 3**（质检脚本）、**阿里云百炼 CLI**（TTS/ASR/Omni）。这三样**只有你想自己生成时才需要**——用仓库自带音频的话，什么都不用装。

生成后会有 `mp3` 与 `wav` 两份。**不要删掉 wav**：PowerShell 回退播放器只认未压缩 PCM，它是「干净 Windows 上零依赖」的保证。

自己生成的音频放在 `$DSH_HOME/voice-alerts/clips/` 会自动优先于包内的（逐文件覆盖，所以只想换一条也可以）。

**文件名规则要记住**（想只替换一条英文音频时必须知道）：

| 语言 | 文件名 |
|---|---|
| 中文（默认） | `<场景>.mp3` / `.wav`，例如 `turn-done.mp3` |
| 英文 | `<场景>.en.mp3` / `.en.wav`，例如 `turn-done.en.mp3` |

**默认语言用不带后缀的名字，其它语言加 `.<语言码>` 中缀。** 所以只想换英文的 `approval`，就放一个 `approval.en.mp3`（以及 `.wav`，如果你用 PowerShell 回退播放器）。

## 装了没声音？

按这个顺序排查，能覆盖绝大多数情况。完整版见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

1. **重启了吗？** 插件文件不热加载，改完或装完必须完全重启 DSH Desktop。
2. `/voice-alerts status` 看 **Player** 那一行。`unavailable` 说明两条播放路径都没探测到。
3. **Windows 音量合成器把 `ffplay`（或 `powershell.exe`）单独静音了**——这是最常见的原因。右键任务栏音量图标 → 打开音量合成器，检查对应条目。
4. 输出设备选错了。
5. 某个场景被关掉了，或 `enabled` 是 `false`。
6. 日志里有 `no <语言> audio for <场景>`（例如 `no zh audio for turn-done`）→ 该语言的音频文件缺失。
7. 日志里有 `throttled <场景>` → 被节流窗口挡住了，属于正常行为。

日志位置：`%APPDATA%\DSH Desktop\logs\host\dsh-<日期>.log`，搜 `voice-alerts`。

⚠️ **一件事先说明**：日志里**没有** `ffplay` **不是故障**。ffplay 属于 ffmpeg，需要另外安装；它只是让启动快一点、音量可独立调节。没有它时插件会用 Windows 自带的 PowerShell 播放器，功能完全正常。

## 平台与依赖

**支持：Windows 10 / 11。**

干净 Windows 上**不需要安装任何第三方依赖**就能出声，因为保底播放器用的是系统自带的 Windows PowerShell 5.1 + .NET `System.Media.SoundPlayer`。

| 情况 | 需要什么 |
|---|---|
| 干净 Windows 10/11，只装了 DSH | **什么都不用装**，用系统自带播放器，启动开销约 0.4 秒 |
| 装了 ffmpeg | 无需配置，自动改用 ffplay：启动更快、`volume` 配置生效 |
| 想自己生成音频 | 额外需要 ffmpeg + Python 3 + 阿里云百炼 CLI |
| 运行时网络 | **零网络** |

播放后端的选择顺序：

1. **ffplay**（如果探测到）—— 直接播 mp3，支持独立音量
2. **Windows PowerShell + SoundPlayer** —— 系统自带，只认 wav，音量跟随系统
   先试 `-File play.ps1`（可审计的磁盘脚本）；若被执行策略或 ACL 拦住，自动改用 `-EncodedCommand` 内联命令重试一次
3. 两条都不通 → 静默降级，只在日志里记一行

宿主侧**拿不到窗口是否聚焦**（DSH 的 native 桥只暴露了 `notifyAttention` 等接口），所以这个插件**任何时候都会出声**，包括你正看着窗口的时候。如果觉得吵，用 `/voice-alerts off` 或调 `volume`。

## 验证状态

我一向觉得，把「写过」和「验证过」分开讲清楚，比含糊地说「功能完整」有用得多。所以逐条列出，并且**明确写出验证的边界**。

下面这张表是摘要。**逐条的原始证据、测量值、以及「没验证到哪一步」都记在 [`docs/verification.md`](docs/verification.md)** —— 想核对任何一个数字就去看那份。

### 验证边界（请先读这一段）

**以下结论全部来自同一台机器上的验证**：

| 项 | 值 |
|---|---|
| 操作系统 | Windows 11 |
| DSH | DSH Desktop 2.0.13，`@deepseek-ai/dsh` **0.1.5-rc.2** |
| 该机器上的额外软件 | 装有 ffmpeg、Python 3、阿里云百炼 CLI |

**这意味着**：

- ✅ **代码正确性、事件映射、音频质量**——与本机装了什么无关，结论可迁移到你的机器。
- ✅ **「干净 Windows 零依赖」**——保底播放器用的是 Windows 自带的 PowerShell 5.1 + .NET `System.Media.SoundPlayer`，两者都是 Win10/11 的**操作系统组件**；无 ffmpeg 的情形已通过模拟验证。
- ⚠️ **DSH 版本**——**只在这个版本上验证过**。更高或更低的版本若改动了事件接口，某些场景可能不再触发。这是唯一真正未知、且我无法在本机消除的变数。
- ⚠️ **在一台完全干净的、别人的 Windows 上从 GitHub 安装**——**我没有第二台机器，没有实测过这一步**。CI（见下）在 GitHub 提供的干净 Windows 运行器上覆盖了「安装 + 加载 + 后端探测」，但**运行器没有声卡，无法验证声音真的到了扬声器**。

如果你在别的 DSH 版本或别的机器上遇到问题，请提 Issue 并附上日志里的 `[voice-alerts] active …` 那一行（它会写明探测到的播放器和配置路径），那基本能一眼定位。

### 逐层状态

| 层级 | 状态 |
|---|---|
| **事件层** | 8 个场景中 **7 个由真实事件触发验证过**：`turn-done`、`turn-error`、`needs-input`、`job-done`、`goal-complete`、`goal-blocked`、`approval` |
| **音频层** | 中英各 8 条、共 16 条**全部通过自动质检**（ASR 相似度 1.000、清晰/干净 10/10、无削波）。其中**中文那 8 条另做过逐条耳听确认**；**英文那 8 条没做过这一步**，只过了自动质检 |
| **后端层** | 强制 PowerShell 会正确选 `.wav`；模拟「没装 ffmpeg」时自动回退且仍能播；显式指定不存在的 ffplay 会明确失败而不偷偷换后端 |
| **代码层** | `scripts/selftest.mjs` 用模拟上下文驱动插件，**55 项检查**覆盖事件映射、过滤规则、优先级、节流、命令、重名冲突、资产解析顺序、以及语言切换与回退 |
| **语言层** | 默认中文、`lang en` 切换后确实改选英文文件（自测断言的是**解析到的文件名**，不只是状态文字）；配置里写无法识别的语言会**回退到中文**而不是静默 |
| **CI** | `.github/workflows/verify.yml` 在干净的 `windows-latest` 上验证：真实安装并登记为 profile 层、清单无 BOM、只依赖 Node 内置模块、32 个音频齐备（8 场景 × 2 语言 × 2 格式）、**无 ffplay 时 PowerShell 后端仍被探测到**、55 项自检、隐私扫描 |

关于 `approval` 的验证要说清楚边界：**触发时审批策略必须是 `ask`**。我本人是在 `ask` 策略下听到提示音的，但当时**无法区分**它走的是会话事件 `approval/asked` 还是兜底的作用域瀑布 `approval/request` —— 两条路径播同一条音。会话事件那条的**行为**由自检覆盖（含「子代理会话的审批不出声」），但它是否在生产环境中被派发，我没有单独取证过。

CI 的详细「证明了什么 / 没证明什么」写在 workflow 文件头部——包括**它不能证明声音到达扬声器**这一点。

### 一个已知缺陷，必须说清楚

**`job-failed` 对「后台 shell 命令非零退出」实际不可达。**

实测：一个以后台方式运行、`exit 7` 结束的命令，DSH 把它的状态记为 `completed`，于是播的是「后台任务完成」。原因是 job 快照里**没有退出码字段**，而 shell 后台任务的生产者只会产出 `completed` 或 `killed`；`failed` 保留给「后台**工具**任务报告错误」或生产方合约违约的情况。

顺带一提：**DSH 自带的 `desktop-notifications` 用的是同一个 `status === 'failed'` 判断，所以它有完全一样的盲区**——这是框架行为，不是本插件的实现问题。

这个场景**保留**了（它对工具任务失败是有效的），但它的触发**未被真实复现过**，只有代码层面的核对。你可以用 `/voice-alerts test job-failed` 验证音频本身没问题。

## 目录结构

```
dsh-status-chime/
├── lib/index.js                  # 插件主体，唯一运行时代码
├── cordis.patch.yml              # 声明这个包是 profile 层（dsh.bundle 指向它）
├── package.json                  # 包名、dsh.bundle 声明、engines
├── assets/
│   ├── clips/                    # 8 场景 × 2 语言 = 16 条音频，每条 mp3 + wav（共 32 个文件）
│   ├── clips.json                # 文案/音色/参数的唯一事实源
│   ├── voice-alerts.config.json  # 配置模板
│   └── play.ps1                  # PowerShell 回退播放器（纯 ASCII，原因见文件头）
├── tools/                        # 百炼本地音频辅助脚本（ASR / Omni / UTMOS）
├── scripts/                      # 生成 / 质检 / 自检 / 负向验证 / 隐私扫描
│   ├── build.mjs                 # 生成音频（支持 --lang）
│   ├── qa.mjs                    # 质检（支持 --lang）
│   ├── selftest.mjs              # 离线自测，55 项
│   ├── qa-negative-control.mjs   # 证明质检门槛真的会拦下坏音频
│   ├── verify-local-install.mjs  # 验证已安装的单文件版本
│   ├── scan-sensitive.mjs        # 隐私/措辞扫描
│   └── scan-sensitive.verify.mjs # 证明扫描器真的抓得到
├── docs/verification.md          # 逐条验证记录
├── .github/workflows/verify.yml  # CI：干净 Windows 上跑安装 + 自测 + 扫描
├── INSTALL.md                    # 给 Agent 看的安装步骤
├── TROUBLESHOOTING.md            # 没声音时的排查清单
├── README.en.md                  # 英文说明
├── CHANGELOG.md
└── LICENSE                       # MIT
```

`qa/`、`preview/`、`tmp/` 是脚本跑出来的中间产物，已在 `.gitignore` 里，不随仓库发布。

## 许可

代码与随包音频均以 **MIT** 发布。

随包音频是用阿里云百炼（Model Studio）的语音合成生成的，不是任何人的真人录音；如果你打算使用它们，请自行确认你的用法符合相应服务条款。仓库不授予任何底层声音模型的权利。你完全可以不用这套音频——`scripts/build.mjs` 可以生成你自己的，插件也会优先使用你放在 `$DSH_HOME/voice-alerts/clips/` 的文件。

## 贡献

提交前请跑这两个脚本。第一个确认没有把个人路径或凭据带进来，第二个确认自检仍然全绿：

```powershell
node scripts/scan-sensitive.mjs .
node scripts/selftest.mjs
```

`scan-sensitive.mjs` **只报告文件、行号与命中类别，绝不打印命中内容**——所以你在 Issue 里贴它的输出是安全的。它自带的规则集可以用 `$DSH_HOME/voice-alerts.scan.json`（不提交）追加你自己机器上的私有字符串。想确认它真的能抓到东西，跑 `node scripts/scan-sensitive.verify.mjs`：它植入几段明显是伪造的凭据形态值并断言扫描器能报出来，同时断言报告不回显这些值。

欢迎提 Issue 与 PR。特别欢迎的：macOS / Linux 的播放后端（当前后端层是 Windows 专用的）。
