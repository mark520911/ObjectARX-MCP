import { spawn } from 'node:child_process';

export function runProcess(executable, args = [], options = {}) {
  const {
    cwd,
    env = process.env,
    timeoutMs = 30000,
    maxOutputBytes = 5 * 1024 * 1024,
    encoding = 'utf8'
  } = options;

  if (typeof executable !== 'string' || !executable.trim()) {
    throw new TypeError('executable must be a non-empty path');
  }
  if (!Array.isArray(args) || args.some(x => typeof x !== 'string')) {
    throw new TypeError('args must be an array of strings');
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let truncated = false;
    let settled = false;

    const collect = (target, chunk) => {
      if (settled) return;
      const remaining = maxOutputBytes - outputBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const accepted = chunk.subarray(0, remaining);
      target.push(accepted);
      outputBytes += accepted.length;
      if (accepted.length < chunk.length) truncated = true;
    };

    child.stdout.on('data', chunk => collect(stdout, chunk));
    child.stderr.on('data', chunk => collect(stderr, chunk));

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill();
      }
    }, timeoutMs);

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      resolve({
        executable,
        args,
        code,
        signal,
        timedOut: Boolean(signal && code === null),
        truncated,
        stdout: Buffer.concat(stdout).toString(encoding),
        stderr: Buffer.concat(stderr).toString(encoding)
      });
    });
  });
}
