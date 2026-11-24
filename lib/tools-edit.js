/** 编辑工具：场景切点检测(PySceneDetect) 与 自动去静音剪辑(FFmpeg silencedetect)。 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, resolveCwd, resolveOut, runCmd, fmtTime, parseTimeToSec, render } from './cli.js';
import { str, num, bool, arr, OBJ, makeOutputSchema } from './schema.js';

export const SCENE_OUTPUT_SCHEMA = makeOutputSchema({
    scenes: { type:'array', items:{ type:'object' }, description:'镜头列表，每项含 index/start/end/startSec/endSec' },
    count: { type:'number' },
    csvPath: { type:'string' },
});
export const AUTO_OUTPUT_SCHEMA = makeOutputSchema({
    silences: { type:'array', items:{ type:'object' }, description:'静音区间列表，每项含 start/end' },
    count: { type:'number' },
    dryRun: { type:'boolean' },
    keep: { type:'array', items:{ type:'array', items:{ type:'number' } }, description:'保留区间 [[start,end],...]' },
    removedCount: { type:'number' },
    keptCount: { type:'number' },
});

function out(value) {
    return Object.assign({ text:'', path:'', files:[], success:true, duration_ms:0, notes:[] }, value);
}
function whichBin(dir, exe) {
    const p = path.join(dir, exe);
    return fs.existsSync(p) ? p : exe;
}

/* ---------------- scene_detect ---------------- */
export const SCENE_NAME = 'scene_detect';
export const SCENE_DESC = [
    '用 PySceneDetect 检测视频里的场景切换点(镜头边界)，返回每个镜头的起止时间码。',
    '算法 detector：content(快速硬切，默认) / adaptive(自适应，兼顾渐变与闪回) / threshold(淡入淡出)。',
    'threshold 只是检测灵敏度阈值(默认 30)，不是时长。',
    '可设 minSceneLength 过滤太短的镜头；split=true 时按切点把视频切成多个片段文件；csvPath 导出场景清单 CSV。',
    '适合按镜头拆解再做二次剪辑的场景。'
].join('\n');
export const SCENE_SCHEMA = OBJ({
    input: str('输入视频路径。必填。'),
    detector: str('检测算法：content(默认)/adaptive/threshold。', { enum:['content','adaptive','threshold'] }),
    threshold: num('检测阈值(默认 30)。值越小越敏感、切点越多。'),
    minSceneLength: str('最短镜头时长，如 0.5s / 1s。短于它的镜头会被合并。'),
    split: bool('true=按切点切成多个片段文件并放同目录；false=只返回时间码(默认)。'),
    csvPath: str('场景清单 CSV 输出路径。不传不导出。'),
});
export function createSceneTool(pluginConfig) {
    return { name: SCENE_NAME, description: SCENE_DESC, parameters: SCENE_SCHEMA,
        output: { schema: SCENE_OUTPUT_SCHEMA, render, presentationMeta: (_a,value) => ({ kind:'video-scene-detect', path: value?.path ?? '', files: value?.files ?? [], seconds: (value?.duration_ms ?? 0)/1000, removed: value?.removedCount ?? value?.count ?? 0 }) },
        async execute(args, exec) {
            const cfg = resolveConfig(pluginConfig), cwd = resolveCwd(exec);
            const input = path.isAbsolute(args.input) ? args.input : path.join(cwd, args.input || '');
            if (!fs.existsSync(input)) throw new Error('输入文件不存在：' + input);
            const detector = args.detector || 'content';
            const detCmd = detector === 'adaptive' ? 'detect-adaptive' : detector === 'threshold' ? 'detect-threshold' : 'detect-content';
            const a = ['-i', input, detCmd];
            if (args.threshold != null) a.push('-t', String(args.threshold));
            if (args.minSceneLength) a.push('-msl', String(args.minSceneLength));
            a.push('list-scenes');
            if (args.csvPath) {
                const cp = path.isAbsolute(args.csvPath) ? args.csvPath : path.join(cwd, args.csvPath);
                a.push('-o', path.dirname(cp), '-f', path.basename(cp));
            }
            if (args.split) a.push('split-video');
            const t0 = Date.now();
            const r = await runCmd(cfg.scenedetect, a, { cwd });
            if (r.code !== 0) throw new Error('场景检测失败：' + (r.stderr || r.error).slice(-1200));
            const scenes = [];
            for (const line of r.stdout.split(/\r?\n/)) {
                const m = line.match(/^\|\s*(\d+)\s*\|\s*([\d:.]+)\s*\|\s*([\d:.]+)\s*\|/);
                if (m) scenes.push({ index:Number(m[1]), start:m[2], end:m[3], startSec:parseTimeToSec(m[2]), endSec:parseTimeToSec(m[3]) });
            }
            const csvOut = args.csvPath ? (path.isAbsolute(args.csvPath) ? args.csvPath : path.join(cwd, args.csvPath)) : '';
            return out({
                text: '检测到 ' + scenes.length + ' 个镜头：\n' + scenes.map(s=>'  #'+s.index+'  '+s.start+' → '+s.end).join('\n') + (csvOut?'\nCSV：'+csvOut:''),
                scenes, count: scenes.length, csvPath: csvOut, files: csvOut?[csvOut]:[], duration_ms: Date.now()-t0,
                notes: args.split ? ['已按切点切分视频，片段在同目录'] : []
            });
        } };
}

/* ---------------- auto_edit ---------------- */
export const AUTO_NAME = 'auto_edit';
export const AUTO_DESC = [
    '自动去静音剪辑：检测视频里的静音段，按阈值裁掉停顿，把说话/有声部分拼成紧凑成片。适合口播、访谈、录屏讲解。',
    'threshold 用分贝(默认 -35dB，只有低于它的才算静音)；margin 是静音段前后保留的边距秒数(默认 0.2，让剪辑不生硬)。',
    'dryRun=true 时只返回检测到的静音区间，不生成成片，先看清要剪哪里再决定。',
    'cuts 可手动覆盖：传 [[startSec,endSec],...] 精确指定要删掉的区间，跳过自动检测。',
    '这是确定性执行工具，哪些内容值得留仍需 Agent 理解语义后决定。'
].join('\n');
export const AUTO_SCHEMA = OBJ({
    input: str('输入视频路径。必填。'),
    threshold: str('静音判定阈值，如 -35dB / -30dB。默认 -35dB。低于它的算静音。'),
    margin: num('静音段前后保留边距(秒)，默认 0.2。'),
    minSilence: num('只有长于该秒数的静音才裁掉，默认 0.5。'),
    output: str('成片输出路径。不传则当前目录生成带时间戳文件名。'),
    dryRun: bool('true=只返回检测到的静音区间，不生成成片(默认 false)。'),
    cuts: arr(arr(num()), '手动指定要删除的区间数组 [[startSec,endSec],...]，传了就跳过自动检测。'),
});
export function createAutoEditTool(pluginConfig) {
    return { name: AUTO_NAME, description: AUTO_DESC, parameters: AUTO_SCHEMA,
        output: { schema: AUTO_OUTPUT_SCHEMA, render, presentationMeta: (_a,value) => ({ kind:'video-auto-edit', path: value?.path ?? '', files: value?.files ?? [], seconds: (value?.duration_ms ?? 0)/1000, removed: value?.removedCount ?? value?.count ?? 0 }) },
        async execute(args, exec) {
            const cfg = resolveConfig(pluginConfig), cwd = resolveCwd(exec);
            const input = path.isAbsolute(args.input) ? args.input : path.join(cwd, args.input || '');
            if (!fs.existsSync(input)) throw new Error('输入文件不存在：' + input);
            const ffmpeg = whichBin(cfg.ffmpegBin, 'ffmpeg.exe');
            const threshold = args.threshold || '-35dB';
            const margin = args.margin != null ? Number(args.margin) : 0.2;
            const minSilence = args.minSilence != null ? Number(args.minSilence) : 0.5;
            const t0 = Date.now();
            let silences;
            if (Array.isArray(args.cuts) && args.cuts.length) {
                silences = args.cuts.map(c => ({ start: Number(c[0]), end: Number(c[1]) })).filter(s => isFinite(s.start) && isFinite(s.end) && s.end > s.start);
            } else {
                const a = ['-i', input, '-af', 'silencedetect=noise=' + threshold + ':d=' + minSilence, '-f','null','-'];
                const r = await runCmd(ffmpeg, a, { cwd, timeoutMs: cfg.maxDurationSec*1000 + 30000 });
                const txt = r.stderr + '\n' + r.stdout;
                const starts = [...txt.matchAll(/silence_start:\s*([\d.]+)/g)].map(m=>Number(m[1]));
                const ends = [...txt.matchAll(/silence_end:\s*([\d.]+)/g)].map(m=>Number(m[1]));
                silences = starts.map((s,i)=>({ start:s, end: ends[i] != null ? ends[i] : s+minSilence }));
            }
            if (args.dryRun) {
                return out({ text: '检测到 ' + silences.length + ' 段静音（dryRun，未剪辑）：\n' + silences.map(s=>'  '+fmtTime(s.start)+' → '+fmtTime(s.end)).join('\n'),
                    silences, count: silences.length, dryRun:true, duration_ms: Date.now()-t0 });
            }
            if (!silences.length) return out({ text:'未检测到需要裁掉的静音段，输入保持不变。', silences:[], count:0, duration_ms:Date.now()-t0, notes:['可尝试提高 threshold（如 -30dB）或减小 minSilence'] });
            // 取时长，裁掉超出片尾的保留段（如末尾整段静音）
            const ffprobe = whichBin(cfg.ffprobeBin || cfg.ffmpegBin, 'ffprobe.exe');
            const pr = await runCmd(ffprobe, ['-v','quiet','-print_format','json','-show_format', input], { cwd });
            let duration = 0;
            try { duration = Number(JSON.parse(pr.stdout).format.duration) || 0; } catch (e) {}
            const keep = [];
            let cursor = 0;
            const sorted = silences.slice().sort((a,b)=>a.start-b.start);
            for (const s of sorted) {
                const ks = Math.max(cursor, s.start - margin), ke = s.end + margin;
                if (ks > cursor + 0.01) keep.push([cursor, ks]);
                cursor = Math.max(cursor, ke);
            }
            if (duration > 0 && cursor < duration - 0.05) keep.push([cursor, duration]);
            // 用 split 把单个视频流复制成 N 路再分别 trim（原来写 [1:v] 是错的：只有一个输入）
            let filter;
            if (keep.length === 0) {
                filter = '[0:v]null[outv]';
            } else if (keep.length === 1) {
                const p = keep[0];
                filter = '[0:v]trim=start='+p[0].toFixed(3)+(p[1]!=null?':end='+p[1].toFixed(3):'')+',setpts=PTS-STARTPTS[outv]';
            } else {
                const parts = ['[0:v]split='+keep.length+keep.map((_,i)=>'[vin'+i+']').join('')];
                keep.forEach((pair,i) => {
                    parts.push('[vin'+i+']trim=start='+pair[0].toFixed(3)+(pair[1]!=null?':end='+pair[1].toFixed(3):'')+',setpts=PTS-STARTPTS[v'+i+']');
                });
                parts.push(keep.map((_,i)=>'[v'+i+']').join('')+'concat=n='+keep.length+':v=1:a=0[outv]');
                filter = parts.join(';');
            }
            const outp = resolveOut(cwd, args.output, 'autoedit-{ts}.mp4');
            if (fs.existsSync(outp)) throw new Error('输出已存在，不会覆盖：' + outp);
            const a = ['-y','-i', input, '-filter_complex', filter, '-map','[outv]', '-c:v','libx264','-preset','veryfast','-crf','23', outp];
            const r = await runCmd(ffmpeg, a, { cwd, timeoutMs: cfg.maxDurationSec*1000 + 60000 });
            if (r.code !== 0 || !fs.existsSync(outp)) throw new Error('自动剪辑失败：' + (r.stderr || r.error).slice(-1200));
            return out({ text: '已自动剪掉 ' + silences.length + ' 段静音，保留 ' + keep.length + ' 段，成片：' + outp,
                path: outp, files:[outp], silences, keep, removedCount: silences.length, keptCount: keep.length, duration_ms: Date.now()-t0,
                notes:['未保留音轨(去静音后画面拼接)；如需配音可用 comfyui_generate_audio'] });
        } };
}
