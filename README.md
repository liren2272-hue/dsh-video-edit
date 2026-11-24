# dsh-video-edit

把本机 **FFmpeg / ffprobe / PySceneDetect** 封装成 DSH Agent 工具，做真正的「视频剪辑」——与 `dsh-comfyui-image`（AI 生成视频）互补，本插件负责时间线剪辑：探测、切点检测、剪切、拼接、转码、自动去静音。

## 工具

- `video_probe`：ffprobe 读流信息（时长/分辨率/帧率/编码/音轨）。
- `scene_detect`：PySceneDetect 检测场景切换点，返回时间码列表，可选导出 CSV/切片。
- `video_cut`：按起止时间剪切一段（可只切视频/音频）。
- `video_concat`：多段拼接（concat demuxer，无损流拷贝）。
- `video_transcode`：转码/改分辨率/改帧率/压体积。
- `auto_edit`：自动去静音剪辑（silencedetect 检测停顿 → 按阈值批量裁掉），支持保留边距、指定灵敏度、干跑只看切点。

## 配置（cordis.patch.yml config）

- `ffmpegBin` / `ffprobeBin`：FFmpeg 目录，默认 `C:/FFmpeg/bin`。
- `scenedetect`：scenedetect.exe 路径，默认 `C:/Program Files/Python311/Scripts/scenedetect.exe`。
- `maxDurationSec`：auto_edit 单次最长输入，默认 600 秒。

## 边界

插件只做执行层（命令正确、参数可靠、可复用、零 API 成本）；「哪些镜头值得留、节奏如何剪」仍由 Agent 理解意图后决定。

### v0.1.4

- 修复 `parameters must be lossless JSON before schema projection`：schema 辅助函数在 description 缺省时不再写入 `undefined` 键（`auto_edit.cuts` 的内层数组触发），避免宿主投影整张工具表失败。

### v0.1.3

- 修复重启后 `unsupported JSON schema: schema must be a schema object` 报错：6 个工具的 `output` 补齐 `output.schema`（DSH 注册时强制要求），并加 `presentationMeta`。
- 修复 `render` 签名以兼容宿主 `(args, value)` 双参调用，结果文本现在正确显示。

### v0.1.2

- 新增插件图标 `icon.svg`：36×36 自包含 SVG，青→靛渐变时间线 + 剪切点，明暗双主题可读。
- `package.json` 接线 `exports["./icon"]` 与 `files`，可通过 `@local/dsh-video-edit/icon` 解析。

### v0.1.1

- 修复 video_cut 音轨参数：copy 模式 noAudio 现在正确加 -an；重编码不再误传裸 'aac'。
- 修复 auto_edit 剪辑：单输入改用 split 复制视频流（原来误写 [1:v] 导致 Invalid file index）；保留段按实际时长裁剪，避免末尾超界。
- 真实 ffmpeg 冒烟测试：6 工具全通过（探测/剪切/拼接/转码/场景检测/自动去静音）。

### v0.1.0

- 初版：6 个视频剪辑工具 + 本机 CLI 封装。