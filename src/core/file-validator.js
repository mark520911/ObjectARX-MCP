import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = {
  lib: ['.lib'],
  obj: ['.obj'],
  dll: ['.dll'],
  exe: ['.exe'],
  project: ['.vcxproj', '.props', '.targets'],
  source: ['.h', '.hpp', '.hh', '.hxx', '.cpp', '.c', '.cc', '.cxx']
};

export function validateFile(inputPath, type) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { valid: false, error: '文件路径不能为空。' };
  }

  if (!Object.hasOwn(EXTENSIONS, type)) {
    return { valid: false, error: `不支持的文件类型类别：${type}` };
  }

  const fullPath = path.resolve(inputPath.trim());

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return { valid: false, path: fullPath, error: '文件不存在或无法访问。' };
  }

  if (!stat.isFile()) {
    return { valid: false, path: fullPath, error: '指定路径不是文件。' };
  }

  const extension = path.extname(fullPath).toLowerCase();
  if (!EXTENSIONS[type].includes(extension)) {
    return {
      valid: false,
      path: fullPath,
      extension,
      expectedExtensions: EXTENSIONS[type],
      error: '文件扩展名与要求的类型不匹配。'
    };
  }

  return {
    valid: true,
    path: fullPath,
    extension,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

export function validateDirectory(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { valid: false, error: '目录路径不能为空。' };
  }

  const fullPath = path.resolve(inputPath.trim());
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return { valid: false, path: fullPath, error: '指定路径不是目录。' };
    }
    return { valid: true, path: fullPath };
  } catch {
    return { valid: false, path: fullPath, error: '目录不存在或无法访问。' };
  }
}
