import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function fromPath(name) {
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];

  for (const dir of entries) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function findVswhere() {
  const candidates = [
    process.env.VSWHERE_PATH,
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    )
  ].filter(Boolean);

  return candidates.find(isFile) || fromPath('vswhere');
}

function getVisualStudioInstallations() {
  const vswhere = findVswhere();
  if (!vswhere) return [];

  try {
    const output = execFileSync(vswhere, [
      '-all',
      '-products',
      '*',
      '-property',
      'installationPath'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    });

    return output.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getMsvcVersions(installPath) {
  const msvcRoot = path.join(installPath, 'VC', 'Tools', 'MSVC');
  if (!fs.existsSync(msvcRoot)) return [];

  try {
    return fs.readdirSync(msvcRoot)
      .filter(name => {
        try {
          return fs.statSync(path.join(msvcRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function findMsvcToolInInstall(installPath, toolName) {
  for (const version of getMsvcVersions(installPath)) {
    const binRoot = path.join(
      installPath,
      'VC',
      'Tools',
      'MSVC',
      version,
      'bin'
    );

    const candidates = [
      path.join(binRoot, 'Hostx64', 'x64', `${toolName}.exe`),
      path.join(binRoot, 'Hostx86', 'x64', `${toolName}.exe`),
      path.join(binRoot, 'Hostx64', 'x86', `${toolName}.exe`),
      path.join(binRoot, 'Hostx86', 'x86', `${toolName}.exe`)
    ];

    const found = candidates.find(isFile);
    if (found) return found;
  }

  return null;
}

function findDumpbinInInstall(installPath) {
  return findMsvcToolInInstall(installPath, 'dumpbin');
}

function findLibInInstall(installPath) {
  return findMsvcToolInInstall(installPath, 'lib');
}

function findMsbuildInInstall(installPath) {
  const candidates = [
    path.join(
      installPath,
      'MSBuild',
      'Current',
      'Bin',
      'amd64',
      'MSBuild.exe'
    ),
    path.join(
      installPath,
      'MSBuild',
      'Current',
      'Bin',
      'MSBuild.exe'
    )
  ];

  return candidates.find(isFile) || null;
}

export function discoverTools() {
  const installations = getVisualStudioInstallations();

  const dumpbinCandidates = [
    process.env.ARX_DUMPBIN_PATH,
    ...installations.map(findDumpbinInInstall),
    fromPath('dumpbin')
  ].filter(Boolean);

  const libCandidates = [
    process.env.ARX_LIB_PATH,
    ...installations.map(findLibInInstall),
    fromPath('lib')
  ].filter(Boolean);

  const msbuildCandidates = [
    process.env.ARX_MSBUILD_PATH,
    fromPath('msbuild'),
    ...installations.map(findMsbuildInInstall)
  ].filter(Boolean);

  const dumpbinPath = dumpbinCandidates.find(isFile) || null;
  const libPath = libCandidates.find(isFile) || null;
  const msbuildPath = msbuildCandidates.find(isFile) || null;

  return {
    platform: process.platform,
    visualStudioInstallations: installations,
    vswherePath: findVswhere(),
    dumpbin: {
      found: Boolean(dumpbinPath),
      path: dumpbinPath
    },
    lib: {
      found: Boolean(libPath),
      path: libPath
    },
    msbuild: {
      found: Boolean(msbuildPath),
      path: msbuildPath
    }
  };
}