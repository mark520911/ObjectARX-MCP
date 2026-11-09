import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP 应发现并正确调用 arx_analyze_link_log', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/server.js'],
    cwd: process.cwd()
  });

  const client = new Client({
    name: 'objectarx-link-log-test',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);

    const toolResult = await client.listTools();
    const tools = toolResult.tools;

    assert.equal(tools.length, 14, '应注册 13 个 MCP 工具');

    const target = tools.filter(
      tool => tool.name === 'arx_analyze_link_log'
    );

    assert.equal(target.length, 1, '新工具应且仅应注册一次');

    const result = await client.callTool({
      name: 'arx_analyze_link_log',
      arguments: {
        stdout: 'Linking...\nBuild succeeded.',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncated: false
      }
    });

    assert.notEqual(result.isError, true, '工具调用不应返回错误');

    const textContent = result.content.find(
      item => item.type === 'text'
    );

    assert.ok(textContent, '应返回文本结果');

    const data = JSON.parse(textContent.text);

    assert.equal(data.success, true);
    assert.equal(data.buildStatus, 'SUCCEEDED');
    assert.equal(data.linkStatus, 'SUCCEEDED');

    console.log('MCP 工具总数：', tools.length);
    console.log('新工具调用：成功');
    console.log('构建状态：', data.buildStatus);
    console.log('链接状态：', data.linkStatus);
  } finally {
    await client.close();
  }
});
