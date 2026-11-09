function findMarker(line) {
  const markers = ['LNK2019', 'LNK2001', 'LNK1104', 'LNK1120'];
  const upper = line.toUpperCase();

  for (const code of markers) {
    const index = upper.indexOf(code);
    if (index < 0) continue;

    const before = upper[index - 1] || '';
    const after = upper[index + code.length] || '';

    const isWord = ch =>
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_';

    if (isWord(before) || isWord(after)) continue;

    return { code, index };
  }

  return null;
}

function extractSourceFile(prefix) {
  const colon = prefix.lastIndexOf(':');
  if (colon < 0) return null;

  const label = prefix.slice(0, colon).trim();
  const status = prefix.slice(colon + 1).trim().toLowerCase();

  if (status !== 'error' && status !== 'fatal error') return null;

  return label || null;
}

function extractQuotedValue(text, marker) {
  const index = text.toLowerCase().indexOf(marker.toLowerCase());
  if (index < 0) return null;

  let pos = index + marker.length;

  while (pos < text.length && text.charCodeAt(pos) <= 32) {
    pos++;
  }

  const quote = text[pos];
  if (quote !== '"' && quote !== "'") return null;

  const end = text.indexOf(quote, pos + 1);
  if (end < 0) return null;

  return text.slice(pos + 1, end).trim() || null;
}

function parseErrorLine(line) {
  const marker = findMarker(line);
  if (!marker) return null;

  const prefix = line.slice(0, marker.index).trim();
  const sourceFile = extractSourceFile(prefix);

  if (prefix && sourceFile === null && !/^error$/i.test(prefix)) {
    return null;
  }

  const messageStart = line.indexOf(':', marker.index + marker.code.length);
  if (messageStart < 0) return null;

  const message = line.slice(messageStart + 1).trim();
  const code = marker.code;

  const result = {
    code,
    severity: code === 'LNK1104' || code === 'LNK1120'
      ? 'fatal'
      : 'error',
    sourceFile,
    message,
    rawMessage: line.trim(),
    symbol: null,
    referencedBy: null,
    inputFile: null,
    unresolvedCount: null
  };

  if (code === 'LNK2019' || code === 'LNK2001') {
    result.symbol = extractQuotedValue(
      message,
      'unresolved external symbol'
    );

    result.referencedBy = extractQuotedValue(
      message,
      'referenced in function'
    );
  }

  if (code === 'LNK1104') {
    result.inputFile = extractQuotedValue(message, 'cannot open file');

    if (!result.inputFile) {
      const markerText = 'cannot open file';
      const index = message.toLowerCase().indexOf(markerText);

      if (index >= 0) {
        result.inputFile =
          message.slice(index + markerText.length).trim() || null;
      }
    }
  }

  if (code === 'LNK1120') {
    const markerText = 'unresolved external';
    const index = message.toLowerCase().indexOf(markerText);

    if (index >= 0) {
      const countText = message.slice(0, index).trim();
      const count = Number(countText);

      if (Number.isInteger(count) && count >= 0) {
        result.unresolvedCount = count;
      }
    }
  }

  return result;
}

/**
 * 解析 MSVC Linker 错误日志。
 * 仅识别明确的 LNK2019、LNK2001、LNK1104、LNK1120。
 */
export function parseLinkErrors(input) {
  const rawLog = String(input ?? '');
  const lines = rawLog.split(/\r?\n/);
  const errors = [];

  for (const line of lines) {
    const parsed = parseErrorLine(line);
    if (parsed) errors.push(parsed);
  }

  const summary = {
    total: errors.length,
    byCode: {
      LNK2019: 0,
      LNK2001: 0,
      LNK1104: 0,
      LNK1120: 0
    },
    unresolvedSymbolErrors: 0,
    missingInputFiles: 0,
    unresolvedExternalCount: null
  };

  for (const error of errors) {
    summary.byCode[error.code]++;

    if (error.code === 'LNK2019' || error.code === 'LNK2001') {
      summary.unresolvedSymbolErrors++;
    }

    if (error.code === 'LNK1104') {
      summary.missingInputFiles++;
    }

    if (error.code === 'LNK1120' && error.unresolvedCount !== null) {
      summary.unresolvedExternalCount = error.unresolvedCount;
    }
  }

  return {
    success: true,
    errors,
    summary,
    rawLog
  };
}
