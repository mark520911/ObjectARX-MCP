function cleanLines(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
}

/**
 * 解析 dumpbin /symbols 输出。
 *
 * COFF 节编号可能包含十六进制字母，例如 SECTA、SECTB。
 * 不对 C++ 修饰名进行解码，保留原始符号名称。
 */
export function parseObjSymbols(text) {
  const lines = cleanLines(text);
  const symbols = [];

  let currentSymbol = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 弱外部符号可能带有 Default symbol 后续说明。
    const defaultMatch = line.match(/^\s*Default symbol:\s*(.*?)\s*$/i);
    if (defaultMatch && currentSymbol?.storageClass === 'WeakExternal') {
      currentSymbol.defaultSymbol = defaultMatch[1];
      continue;
    }

    // 示例：
    // 00A 00000000 UNDEF notype External | symbol
    // 00B 00000000 SECT1 notype () External | symbol
    // 01F 00000000 SECTA notype External | symbol
    const match = line.match(
      /^\s*([0-9A-F]+)\s+([0-9A-F]{8})\s+(\S+)\s+(.+?)\s+\|\s+(.*?)\s*$/i
    );

    if (!match) {
      currentSymbol = null;
      continue;
    }

    const [, indexHex, valueHex, section, typeAndStorage, rawName] = match;
    const parts = typeAndStorage.trim().split(/\s+/);
    const storageClass = parts.pop() || '';
    const type = parts.join(' ');
    const name = rawName.trim();

    const sectionUpper = section.toUpperCase();
    let category = 'other';

    if (sectionUpper === 'UNDEF') {
      category = storageClass === 'WeakExternal'
        ? 'weakExternal'
        : 'undefined';
    } else if (/^SECT[0-9A-F]+$/i.test(section)) {
      category = 'defined';
    } else if (sectionUpper === 'ABS') {
      category = 'absolute';
    }

    currentSymbol = {
      index: Number.parseInt(indexHex, 16),
      indexHex: indexHex.toUpperCase(),
      value: Number.parseInt(valueHex, 16),
      valueHex: valueHex.toUpperCase(),
      section,
      type,
      storageClass,
      name,
      category
    };

    symbols.push(currentSymbol);
  }

  const defined = symbols.filter(x => x.category === 'defined');
  const undefinedSymbols = symbols.filter(x => x.category === 'undefined');
  const weakExternals = symbols.filter(x => x.category === 'weakExternal');
  const absolute = symbols.filter(x => x.category === 'absolute');
  const other = symbols.filter(x => x.category === 'other');

  return {
    symbolCount: symbols.length,
    definedCount: defined.length,
    undefinedCount: undefinedSymbols.length,
    weakExternalCount: weakExternals.length,
    absoluteCount: absolute.length,
    otherCount: other.length,
    defined,
    undefined: undefinedSymbols,
    weakExternals,
    absolute,
    other,
    symbols
  };
}

/**
 * 将 dumpbin /symbols 的文本输出转换成适合 MCP 使用的 OBJ 分析结果。
 */
export function analyzeObjText(text) {
  const parsed = parseObjSymbols(text);

  return {
    format: 'COFF OBJECT',
    symbolCount: parsed.symbolCount,
    definedCount: parsed.definedCount,
    undefinedCount: parsed.undefinedCount,
    weakExternalCount: parsed.weakExternalCount,
    absoluteCount: parsed.absoluteCount,
    otherCount: parsed.otherCount,
    defined: parsed.defined,
    undefined: parsed.undefined,
    weakExternals: parsed.weakExternals,
    absolute: parsed.absolute,
    other: parsed.other,
    symbols: parsed.symbols,
    evidenceLevel: 'OBJ_SYMBOL_TABLE_ANALYSIS',
    limitations: [
      'SECT 符号表示 OBJ 符号表中的节定义，不等于最终链接成功。',
      'UNDEF 表示当前 OBJ 引用了该符号，不代表整个 LIB 或工程缺少该符号。',
      '弱外部符号的默认目标信息需要以实际 dumpbin 输出为准。',
      '当前分析不执行链接，也不修改 OBJ 文件。'
    ]
  };
}