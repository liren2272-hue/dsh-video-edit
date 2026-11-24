/**
 * dsh-video-edit — 宿主侧 Cordis 插件入口。
 * 把本机 FFmpeg / ffprobe / PySceneDetect 封装成可调用的 Agent 工具。
 * inject=['tools'] 保证 ctx.reflect.get('tools') 拿得到注册表。
 * 不 import 任何 @deepseek-ai/* 宿主包，避免 link 安装时 ERR_MODULE_NOT_FOUND。
 */
import { createProbeTool, createCutTool, createConcatTool, createTranscodeTool } from './lib/tools-basic.js';
import { createSceneTool, createAutoEditTool } from './lib/tools-edit.js';

export const name = '@local/dsh-video-edit';
export const inject = ['tools'];

function getToolRegistry(ctx) {
    const candidates = [];
    if (typeof ctx.reflect?.get === 'function') {
        candidates.push(ctx.reflect.get('tools', false));
        candidates.push(ctx.reflect.get('tools'));
    }
    if (typeof ctx.get === 'function') candidates.push(ctx.get('tools'));
    for (const c of candidates) if (c && typeof c.register === 'function') return c;
    return undefined;
}

export function apply(ctx, config) {
    const tools = getToolRegistry(ctx);
    if (!tools) { console.warn('[dsh-video-edit] 拿不到 tools 服务，未注册任何工具'); return; }
    const factories = [createProbeTool, createCutTool, createConcatTool, createTranscodeTool, createSceneTool, createAutoEditTool];
    const made = factories.map(f => f(config));
    for (const t of made) tools.register(t);
    console.log('[dsh-video-edit] v0.1.4 已注册工具：' + made.map(t=>t.name).join(', '));
}

export { createProbeTool, createCutTool, createConcatTool, createTranscodeTool } from './lib/tools-basic.js';
export { createSceneTool, createAutoEditTool } from './lib/tools-edit.js';
