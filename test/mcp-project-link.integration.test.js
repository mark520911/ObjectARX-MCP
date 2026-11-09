import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP registers and invokes arx_analyze_project_link safely', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/server.js'],
    cwd: process.cwd()
  });

  const client = new Client({
    name: 'objectarx-project-link-test',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);

    const toolResult = await client.listTools();
    const tools = toolResult.tools;

    assert.equal(tools.length, 14, 'Expected 14 registered MCP tools');

    const target = tools.filter(
      tool => tool.name === 'arx_analyze_project_link'
    );

    assert.equal(target.length, 1, 'Project diagnostic tool must be registered exactly once');

    assert.ok(
      tools.some(tool => tool.name === 'arx_analyze_link_log'),
      'Existing link-log tool must remain available'
    );

    const result = await client.callTool({
      name: 'arx_analyze_project_link',
      arguments: {
        projectFile: 'C:\\__OBJECTARX_MCP_TEST_NONEXISTENT__\\missing.vcxproj'
      }
    });

    assert.notEqual(result.isError, true, 'Tool invocation must return a structured result');

    const textContent = result.content.find(
      item => item.type === 'text'
    );

    assert.ok(textContent, 'Tool must return text content');

    const data = JSON.parse(textContent.text);

    assert.equal(typeof data.success, 'boolean');
    assert.equal(data.success, false);
    assert.ok(data.projectInspection, 'Project inspection result must be present');
    assert.equal(data.projectInspection.success, false);
    assert.equal(
      data.buildAnalysis,
      null,
      'No build log was supplied, so build log analysis must not run'
    );

    console.log('MCP tool count:', tools.length);
    console.log('Project diagnostic tool: registered and callable');
    console.log('Missing project path: handled as a diagnostic result');
    console.log('Build log analysis: not executed');
  } finally {
    await client.close();
  }
});
