import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config.js';

const decode = s => s.replaceAll('&amp;','&').replaceAll('&quot;','"').trim();
const property = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi'))].map(m=>decode(m[1]));
const expand = (value, projectDir, sdkRoot) => value
  .replaceAll('$(ProjectDir)', projectDir + path.sep)
  .replaceAll('$(SolutionDir)', projectDir + path.sep)
  .replaceAll('$(ARXSDK)', sdkRoot)
  .replaceAll('$(ObjectARX)', sdkRoot);

export function inspectProject(projectFile) {
  const full=path.resolve(projectFile);
  if(!/\.(vcxproj|props)$/i.test(full)) return {error:'Only .vcxproj or .props files are accepted.'};
  if(!fs.existsSync(full)) return {error:'Project file not found',projectFile:full};
  const xml=fs.readFileSync(full,'utf8');
  const projectDir=path.dirname(full);
  const sdk=config.sdkRoot;
  const fields=['PlatformToolset','WindowsTargetPlatformVersion','AdditionalIncludeDirectories','AdditionalLibraryDirectories','AdditionalDependencies','ModuleDefinitionFile','TargetMachine','RuntimeLibrary','PreprocessorDefinitions'];
  const values=Object.fromEntries(fields.map(k=>[k,property(xml,k)]));
  const includes=values.AdditionalIncludeDirectories.flatMap(x=>x.split(';')).map(x=>expand(x,projectDir,sdk)).filter(x=>x && !x.includes('$(') && !x.includes('%('));
  const libs=values.AdditionalLibraryDirectories.flatMap(x=>x.split(';')).map(x=>expand(x,projectDir,sdk)).filter(x=>x && !x.includes('$(') && !x.includes('%('));
  const deps=values.AdditionalDependencies.flatMap(x=>x.split(';')).map(x=>x.trim()).filter(x=>x && !x.includes('%('));
  const missingIncludes=includes.filter(x=>!fs.existsSync(x));
  const missingLibDirs=libs.filter(x=>!fs.existsSync(x));
  const missingLibs=deps.filter(x=>/\.lib$/i.test(x) && !x.includes('$(') && !x.includes('%(') && !fs.existsSync(path.join(projectDir,x)) && !libs.some(dir=>fs.existsSync(path.join(dir,x))));
  const checks=[];
  if(values.PlatformToolset.length) checks.push({item:'PlatformToolset',value:values.PlatformToolset, note:'确认该工具集已安装且与项目目标一致。'});
  if(!values.ModuleDefinitionFile.length) checks.push({item:'ModuleDefinitionFile',status:'not-explicit',note:'检查项目是否通过其他方式提供 ObjectARX 导出定义；不要盲目补 DEF。'});
  if(missingIncludes.length) checks.push({item:'Missing include directories',value:missingIncludes});
  if(missingLibDirs.length) checks.push({item:'Missing library directories',value:missingLibDirs});
  if(missingLibs.length) checks.push({item:'Unresolved library file paths',value:missingLibs,note:'仅检查显式列出的依赖；宏继承和配置条件可能影响最终链接。'});
  return {projectFile:full,sdkRoot:sdk,readOnly:true,values,checks,missingIncludes,missingLibDirs,missingLibs,
    caution:'只读静态检查，不会解析 MSBuild 的全部条件/属性继承，也不会修改工程。请在 VS 中核对当前 Configuration/Platform 的最终属性。'};
}
