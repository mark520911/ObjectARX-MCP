import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config.js';
import { discoverTools } from '../core/tool-discovery.js';

function inspectPath(targetPath) {
  if (!targetPath) return { configured: false, exists: false };

  const fullPath = path.resolve(targetPath);
  return {
    configured: true,
    path: fullPath,
    exists: fs.existsSync(fullPath)
  };
}

export function inspectEnvironment() {
  const tools = discoverTools();

  const sdkRoot = inspectPath(config.sdkRoot);
  const docsDir = inspectPath(config.docsDir);
  const includeDir = inspectPath(config.includeDir);

  const libX64 = inspectPath(
    config.sdkRoot ? path.join(config.sdkRoot, 'lib-x64') : null
  );

  return {
    readOnly: true,
    node: {
      version: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    objectarxSdk: {
      root: sdkRoot,
      docs: docsDir,
      include: includeDir,
      libX64
    },
    visualStudioTools: tools,
    summary: {
      sdkRootAvailable: sdkRoot.exists,
      docsAvailable: docsDir.exists,
      includeAvailable: includeDir.exists,
      libX64Available: libX64.exists,
      dumpbinAvailable: tools.dumpbin.found,
      msbuildAvailable: tools.msbuild.found
    }
  };
}
