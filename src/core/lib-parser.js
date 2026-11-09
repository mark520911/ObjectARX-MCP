function cleanLines(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trimEnd());
}

/**
 * 解析 lib.exe /list 输出。
 * 保留重复成员，因为导入库可能多次列出同一个 DLL 名称。
 */
export function parseLibMemberList(text) {
  const lines = cleanLines(text);
  const members = [];

  for (const rawLine of lines) {
    const name = rawLine.trim();

    if (!name) continue;
    if (/^Microsoft\s+\(R\)\s+Library Manager/i.test(name)) continue;
    if (/^Copyright\s+\(C\)/i.test(name)) continue;

    members.push({
      index: members.length + 1,
      name,
      extension: name.includes('.')
        ? name.slice(name.lastIndexOf('.')).toLowerCase()
        : '',
      isObj: /\.obj$/i.test(name)
    });
  }

  const objMemberCount = members.filter(x => x.isObj).length;

  return {
    memberCount: members.length,
    objMemberCount,
    otherMemberCount: members.length - objMemberCount,
    members
  };
}

/**
 * 解析 dumpbin /linkermember:2 输出。
 * 只解析 public symbols 区域，避免把 offsets 表误认为符号。
 */
export function parseLinkerMemberOutput(text) {
  const lines = cleanLines(text);
  const symbols = [];

  let inPublicSymbols = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\d+\s+public symbols$/i.test(trimmed)) {
      inPublicSymbols = true;
      continue;
    }

    if (!inPublicSymbols || !trimmed) continue;

    const match = trimmed.match(/^(\d+)\s+(.+?)\s*$/);
    if (!match) continue;

    const memberIndex = Number(match[1]);
    const symbol = match[2].trim();

    if (!Number.isSafeInteger(memberIndex) || memberIndex < 1) continue;
    if (!symbol) continue;

    symbols.push({
      memberIndex,
      symbol
    });
  }

  const symbolsByMember = {};

  for (const item of symbols) {
    const key = String(item.memberIndex);
    if (!symbolsByMember[key]) symbolsByMember[key] = [];
    symbolsByMember[key].push(item.symbol);
  }

  return {
    symbolCount: symbols.length,
    symbols,
    symbolsByMember
  };
}

/**
 * 将成员清单与符号索引关联。
 * 关联依据是 dumpbin 输出中的成员编号。
 */
export function analyzeLibText(memberListText, linkerMemberText) {
  const memberResult = parseLibMemberList(memberListText);
  const symbolResult = parseLinkerMemberOutput(linkerMemberText);

  const members = memberResult.members.map(member => ({
    ...member,
    symbols: symbolResult.symbolsByMember[String(member.index)] || []
  }));

  const indexedMemberNumbers = new Set(
    symbolResult.symbols.map(x => x.memberIndex)
  );

  const outOfRangeMemberNumbers = [...indexedMemberNumbers]
    .filter(index => index > memberResult.memberCount)
    .sort((a, b) => a - b);

  return {
    memberCount: memberResult.memberCount,
    objMemberCount: memberResult.objMemberCount,
    otherMemberCount: memberResult.otherMemberCount,
    symbolCount: symbolResult.symbolCount,
    indexedMemberCount: indexedMemberNumbers.size,
    outOfRangeMemberNumbers,
    members,
    symbols: symbolResult.symbols,
    symbolsByMember: symbolResult.symbolsByMember,
    evidenceLevel: 'LIB_MEMBER_LIST_AND_PUBLIC_SYMBOL_INDEX',
    limitations: [
      '符号索引命中不等于已确认 OBJ 内部存在该符号定义。',
      '成员编号关联依赖 lib.exe /list 与 dumpbin /linkermember:2 的成员顺序一致。',
      '导入库中的符号记录不能直接认定为静态 OBJ 定义。',
      '当前分析不代表最终链接成功。'
    ]
  };
}