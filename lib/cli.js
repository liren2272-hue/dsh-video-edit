/** 公共 CLI 工具：解析可执行路径、spawn、统一返回。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function resolveConfig(pluginConfig) {
    const c = pluginConfig ?? {};
    return {
        ffmpegBin: c.ffmpegBin || 'C:/FFmpeg/bin',
        ffprobeBin: c.ffprobeBin || c.ffmpegBin || 'C:/FFmpeg/bin',
        scenedetect: c.scenedetect || 'C:/Program Files/Python311/Scripts/scenedetect.exe',
        maxDurationSec: Number(c.maxDurationSec) || 600,
    };
}

export function which(binDir, exe) {
    const p = path.join(binDir, exe);
    return fs.existsSync(p) ? p : exe;
}

export function resolveCwd(exec) {
    const c = exec?.cwd || exec?.workingDirectory || exec?.context?.cwd;
    return typeof c === 'string' && c ? c : process.cwd();
}

export function resolveOut(cwd, out, defName) {
    if (!out) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return path.join(cwd, defName.replace('{ts}', ts));
    }
    return path.isAbsolute(out) ? out : path.join(cwd, out);
}

/** 运行进程，收集 stdout/stderr，超时终止。 */
export function runCmd(cmd, args, opts) {
    const { timeoutMs = 0, cwd } = opts || {};
    return new Promise((resolve) => {
        let stdout = '', stderr = '', timer = null, settled = false;
        const finish = (code, err) => {
            if (settled) return; settled = true;
            if (timer) clearTimeout(timer);
            resolve({ code, stdout, stderr, cmd: [cmd].concat(args).join(' '), error: err || '' });
        };
        let child;
        try {
            child = spawn(cmd, args, { cwd: cwd || undefined, windowsHide: true, shell: false });
        } catch (e) { finish(-1, String(e && e.message || e)); return; }
        child.stdout && child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr && child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('error', e => finish(-1, String(e && e.message || e)));
        child.on('close', code => finish(code));
        if (timeoutMs > 0) timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish(-2, 'TIMEOUT'); }, timeoutMs);
    });
}

/** 秒 → HH:MM:SS.mmm */
export function fmtTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + ss.toFixed(3).padStart(6,'0');
}

export function parseTimeToSec(t) {
    if (typeof t === 'number') return t;
    const m = String(t).match(/(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)/);
    if (!m) return NaN;
    if (m[1] !== undefined) return Number(m[1])*3600 + Number(m[2]||0)*60 + Number(m[3]);
    if (m[2] !== undefined) return Number(m[2])*60 + Number(m[3]);
    return Number(m[3]);
}

export function fail(msg) { throw new Error(msg); }
export function render(args, value) { const v = value !== undefined ? value : args; return [{ type:'text', text: String(v && v.text != null ? v.text : '') }]; }
