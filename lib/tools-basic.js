/** 基础视频工具：探测 / 剪切 / 拼接 / 转码（FFmpeg + ffprobe）。 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, which, resolveCwd, resolveOut, runCmd, fmtTime, parseTimeToSec, render } from './cli.js';
import { str, num, int, bool, arr, OBJ, makeOutputSchema } from './schema.js';

export const PROBE_OUTPUT_SCHEMA = makeOutputSchema({ info: { type:'object', description:'探测摘要：durationSec/sizeBytes/format/video/audio' } });
export const CUT_OUTPUT_SCHEMA = makeOutputSchema({});
export const CONCAT_OUTPUT_SCHEMA = makeOutputSchema({});
export const TRANSCODE_OUTPUT_SCHEMA = makeOutputSchema({ preset: { type:'string' } });

function out(value, extra) {
    return Object.assign({ text: '', path: '', files: [], success: true, duration_ms: 0, notes: [] }, value, extra || {});
}

/* ---------------- video_probe ---------------- */
export const PROBE_NAME = 'video_probe';
export const PROBE_DESC = [
    '用 ffprobe 读取视频/音频文件的流信息：时长、分辨率、帧率、视频编码、音频编码、码率、容器格式。',
    '剪辑前先探测一下，确认输入参数与时长。返回 JSON 文本含 streams 与 format。'
].join('\n');
export const PROBE_SCHEMA = OBJ({
    input: str('本地视频/音频文件路径（本机绝对路径，或相对当前工作目录）。必填。'),
});
export function createProbeTool(pluginConfig) {
    return { name: PROBE_NAME, description: PROBE_DESC, parameters: PROBE_SCHEMA,
        output: { schema: PROBE_OUTPUT_SCHEMA, render, presentationMeta: (_a,value) => ({ kind:'video-probe', path: value?.path ?? '', files: value?.files ?? [], seconds: (value?.duration_ms ?? 0)/1000 }) },
        async execute(args, exec) {
            const cfg = resolveConfig(pluginConfig), cwd = resolveCwd(exec);
            const input = path.isAbsolute(args.input) ? args.input : path.join(cwd, args.input || '');
            if (!fs.existsSync(input)) throw new Error('输入文件不存在：' + input);
            const ffprobe = which(cfg.ffprobeBin, 'ffprobe.exe');
            const t0 = Date.now();
            const r = await runCmd(ffprobe, ['-v','quiet','-print_format','json','-show_format','-show_streams', input], { cwd });
            if (r.code !== 0) throw new Error('ffprobe 失败：' + (r.stderr || r.error).slice(0, 800));
            let info; try { info = JSON.parse(r.stdout); } catch (e) { throw new Error('ffprobe 输出无法解析：' + r.stdout.slice(0,400)); }
            const v = (info.streams||[]).find(s=>s.codec_type==='video'), a = (info.streams||[]).find(s=>s.codec_type==='audio');
            const summary = {
                file: input,
                durationSec: Number(info.format && info.format.duration) || 0,
                sizeBytes: Number(info.format && info.format.size) || 0,
                format: info.format && info.format.format_name,
                video: v ? { codec:v.codec_name, width:v.width, height:v.height, fps:v.r_frame_rate, nbFrames:v.nb_frames } : null,
                audio: a ? { codec:a.codec_name, sampleRate:a.sample_rate, channels:a.channels } : null,
            };
            return out({ text: '探测完成：' + JSON.stringify(summary, null, 2), path: input, info: summary, duration_ms: Date.now()-t0 });
        } };
}

/* ---------------- video_cut ---------------- */
export const CUT_NAME = 'video_cut';
export const CUT_DESC = [
    '按起止时间从视频里裁出一段。默认精确重编码(-c:v libx264 -c:a aac)；可用 copy 做无损流拷贝(关键帧对齐，起止点可能偏移)。',
    '输出路径不给就落在当前工作目录，文件名自动带时间戳，绝不覆盖已有文件。'
].join('\n');
export const CUT_SCHEMA = OBJ({
    input: str('输入视频路径。必填。'),
    start: str('起点，秒(如 12.5)或 HH:MM:SS.mmm。默认 0。'),
    end: str('终点，秒或 HH:MM:SS.mmm。默认到片尾。'),
    output: str('输出文件路径或目录。不传则当前目录下生成带时间戳文件名。'),
    copy: bool('true=无损流拷贝(快，关键帧对齐)；false=精确重编码(默认)。'),
    noAudio: bool('true=丢弃音轨。默认保留。'),
});
export function createCutTool(pluginConfig) {
    return { name: CUT_NAME, description: CUT_DESC, parameters: CUT_SCHEMA,
        output: { schema: CUT_OUTPUT_SCHEMA, render, presentationMeta: (_a,value) => ({ kind:'video-cut', path: value?.path ?? '', files: value?.files ?? [], seconds: (value?.duration_ms ?? 0)/1000 }) },
        async execute(args, exec) {
            const cfg = resolveConfig(pluginConfig), cwd = resolveCwd(exec);
            const input = path.isAbsolute(args.input) ? args.input : path.join(cwd, args.input || '');
            if (!fs.existsSync(input)) throw new Error('输入文件不存在：' + input);
            const outp = resolveOut(cwd, args.output, 'cut-{ts}.mp4');
            if (fs.existsSync(outp)) throw new Error('输出已存在，不会覆盖：' + outp);
            const start = args.start != null ? parseTimeToSec(args.start) : 0;
            const a = ['-y','-ss', fmtTime(start)];
            if (args.end != null && args.end !== '') a.push('-to', fmtTime(parseTimeToSec(args.end)));
            a.push('-i', input);
            if (args.copy) { a.push('-c','copy'); if (args.noAudio) a.push('-an'); }
            else { a.push('-c:v','libx264','-preset','veryfast','-crf','23'); if (args.noAudio) a.push('-an'); else a.push('-c:a','aac'); }
            a.push(outp);
            const ffmpeg = which(cfg.ffmpegBin, 'ffmpeg.exe');
            const t0 = Date.now();
            const r = await runCmd(ffmpeg, a, { cwd });
            if (r.code !== 0 || !fs.existsSync(outp)) throw new Error('剪切失败：' + (r.stderr || r.error).slice(-1000));
            return out({ text: '已剪切：' + outp + '（' + fmtTime(start) + ' → ' + (args.end || '片尾') + '）', path: outp, files:[outp], duration_ms: Date.now()-t0 });
        } };
}

/* ---------------- video_concat ---------------- */
export const CONCAT_NAME = 'video_concat';
export const CONCAT_DESC = [
    '把多段视频按给定顺序拼接成一个文件。默认无损流拷贝(要求各段编码一致)；编码不一致时用 reencode 重编码。',
    '通过 concat demuxer 实现，不重新编码时速度极快。'
].join('\n');
export const CONCAT_SCHEMA = OBJ({
    inputs: arr(str('视频文件路径'), '按顺序排列的输入视频路径数组。必填，至少 2 段。'),
    output: str('输出文件路径。不传则当前目录下生成带时间戳文件名。'),
    reencode: bool('true=重编码(编码不一致时用)；false=无损拷贝(默认)。'),
});
export function createConcatTool(pluginConfig) {
    return { name: CONCAT_NAME, description: CONCAT_DESC, parameters: CONCAT_SCHEMA,
        output: { schema: CONCAT_OUTPUT_SCHEMA, render, presentationMeta: (_a,value) => ({ kind:'video-concat', path: value?.path ?? '', files: value?.files ?? [], seconds: (value?.duration_ms ?? 0)/1000 }) },
        async execute(args, exec) {
            const cfg = resolveConfig(pluginConfig), cwd = resolveCwd(exec);
            const inputs = (args.inputs||[]).map(p => path.isAbsolute(p) ? p : path.join(cwd, p));
            if (inputs.length < 2) throw new Error('inputs 至少需要 2 段视频');
            for (const f of inputs) if (!fs.existsSync(f)) throw new Error('输入不存在：' + f);
            const outp = resolveOut(cwd, args.output, 'concat-{ts}.mp4');
            if (fs.existsSync(outp)) throw new Error('输出已存在，不会覆盖：' + outp);
            const listFile = path.join(cwd, 'concat-list-' + Date.now() + '.txt');
            fs.writeFileSync(listFile, inputs.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
            const a = ['-y','-f','concat','-safe','0','-i',listFile];
            a.push(args.reencode ? '-c:v' : '-c', args.reencode ? 'libx264' : 'copy');
            if (args.reencode) a.push('-c:a','aac');
            a.push(outp);
            const ffmpeg = which(cfg.ffmpegBin, 'ffmpeg.exe');
            const t0 = Date.now();
            const r = await runCmd(ffmpeg, a, { cwd });
            try { fs.unlinkSync(listFile); } catch (e) {}
            if (r.code !== 0 || !fs.existsSync(outp)) throw new Error('拼接失败：' + (r.stderr || r.error).slice(-1000));
            return out({ text: '已拼接 ' + inputs.length + ' 段：' + outp, path: outp, files:[outp], duration_ms: Date.now()-t0 });
        } };
}

/* ---------------- video_transcode ---------------- */
export const TRANSCODE_NAME = 'video_transcode';
export const TRANSCODE_DESC = [
    '转码视频：改编码、分辨率、帧率、码率、音量，或压体积/转格式。',
    '给 preset 可快速套用：web(720p H.264+AAC 适合网页)、small(小体积)、archive(高质量存档)。也可逐项指定参数。'
].join('\n');
export const TRANSCODE_SCHEMA = OBJ({
    input: str('输入视频路径。必填。'),
    output: str('输出文件路径。不传则当前目录下生成带时间戳文件名。'),
    preset: str('预设：web / small / archive。不传则只按显式参数转码。', { enum:['web','small','archive'] }),
    width: int('输出宽度(像素)。不传按原比例或预设。'),
    height: int('输出高度(像素)。不传按原比例或预设。'),
    fps: num('输出帧率。不传保持原帧率。'),
    videoBitrate: str('视频码率，如 1500k。不传按预设或 libx264 默认。'),
    crf: int('恒定质量因子(18-28，越小越清晰越大)。与 videoBitrate 二选一。'),
    noAudio: bool('true=丢弃音轨。'),
});
export function createTranscodeTool(pluginConfig) {
    return { name: TRANSCODE_NAME, description: TRANSCODE_DESC, parameters: TRANSCODE_SCHEMA,
        output: { schema: TRANSCODE_OUTPUT_SCHEMA, render, presentationMeta: (_a,value) => ({ kind:'video-transcode', path: value?.path ?? '', files: value?.files ?? [], seconds: (value?.duration_ms ?? 0)/1000 }) },
        async execute(args, exec) {
            const cfg = resolveConfig(pluginConfig), cwd = resolveCwd(exec);
            const input = path.isAbsolute(args.input) ? args.input : path.join(cwd, args.input || '');
            if (!fs.existsSync(input)) throw new Error('输入文件不存在：' + input);
            const outp = resolveOut(cwd, args.output, 'transcode-{ts}.mp4');
            if (fs.existsSync(outp)) throw new Error('输出已存在，不会覆盖：' + outp);
            const a = ['-y','-i',input];
            const vf = [];
            if (args.width) vf.push('scale=' + args.width + ':-2');
            else if (args.height) vf.push('scale=-2:' + args.height);
            if (vf.length) a.push('-vf', vf.join(','));
            if (args.fps) a.push('-r', String(args.fps));
            a.push('-c:v','libx264','-preset','veryfast');
            if (args.preset === 'web') { if (!args.crf && !args.videoBitrate) a.push('-crf','23'); a.push('-pix_fmt','yuv420p','-movflags','+faststart'); }
            else if (args.preset === 'small') { if (!args.crf && !args.videoBitrate) a.push('-crf','28'); a.push('-vf', (vf.length?vf.join(',')+',':'') + 'scale=640:-2'); }
            else if (args.preset === 'archive') { if (!args.crf && !args.videoBitrate) a.push('-crf','18'); }
            if (args.crf) a.push('-crf', String(args.crf));
            if (args.videoBitrate) a.push('-b:v', args.videoBitrate);
            a.push(args.noAudio ? '-an' : '-c:a','aac');
            a.push(outp);
            const ffmpeg = which(cfg.ffmpegBin, 'ffmpeg.exe');
            const t0 = Date.now();
            const r = await runCmd(ffmpeg, a, { cwd });
            if (r.code !== 0 || !fs.existsSync(outp)) throw new Error('转码失败：' + (r.stderr || r.error).slice(-1000));
            return out({ text: '已转码：' + outp, path: outp, files:[outp], preset: args.preset||'custom', duration_ms: Date.now()-t0 });
        } };
}
