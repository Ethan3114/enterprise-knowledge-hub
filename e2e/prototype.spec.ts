import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const STORAGE_KEY = 'enterprise-knowledge-hub-prototype-v1';
const fixturePath = path.resolve('e2e/fixtures/employee-handbook.md');

interface BrowserSignals {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
}

function collectBrowserSignals(page: Page): BrowserSignals {
  const signals: BrowserSignals = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      signals.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => signals.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    signals.requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });

  return signals;
}

function expectCleanBrowserSignals(signals: BrowserSignals) {
  expect(signals.consoleErrors).toEqual([]);
  expect(signals.pageErrors).toEqual([]);
  expect(signals.requestFailures).toEqual([]);
}

async function enterAs(page: Page, role: '管理员' | '知识库管理人员' | '使用者') {
  await page.goto('/role');
  await page.getByRole('button', { name: `以${role}身份进入`, exact: true }).click();
}

async function chooseVisibleOption(page: Page, label: string) {
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText(label, { exact: true })
    .click();
}

async function createModel(
  page: Page,
  capability: 'LLM' | 'Embedding' | 'Rerank',
  displayName: string,
  modelId: string,
) {
  await page.evaluate(
    async (input) => {
      const headers = { 'X-Role': 'admin', 'Content-Type': 'application/json' };
      const providers = await fetch('/api/providers', { headers }).then((response) => response.json());
      const response = await fetch('/api/models', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          providerId: providers[0].id,
          displayName: input.displayName,
          modelId: input.modelId,
          capability: input.capability.toLowerCase(),
          supportsVision: input.capability === 'LLM',
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    },
    { capability, displayName, modelId },
  );
}

test.beforeEach(async ({ request }) => {
  const response = await request.delete('/api/workspace', { headers: { 'X-Role': 'admin' } });
  expect(response.ok()).toBeTruthy();
});

test('角色选择、路由权限和在线对话限制保持一致', async ({ page }) => {
  const signals = collectBrowserSignals(page);

  await enterAs(page, '管理员');
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { name: '系统概览', exact: true })).toBeVisible();

  await page.goto('/models');
  await expect(page.getByRole('heading', { name: '模型与 OCR', exact: true })).toBeVisible();

  await page.goto('/logs');
  await expect(page.getByRole('heading', { name: '运行日志', exact: true })).toBeVisible();

  await page.getByLabel('切换当前角色').click();
  await chooseVisibleOption(page, '知识库管理人员');
  await expect(page).toHaveURL(/\/overview$/);

  await page.goto('/models');
  await expect(page.getByText('当前角色无法访问此页面', { exact: true })).toBeVisible();
  await page.goto('/logs');
  await expect(page.getByText('当前角色无法访问此页面', { exact: true })).toBeVisible();

  await page.getByLabel('切换当前角色').click();
  await chooseVisibleOption(page, '使用者');
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('heading', { name: '在线对话', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeDisabled();
  await expect(page.getByText('回答会逐字显示，并带上一轮问答', { exact: true })).toBeVisible();

  await page.goto('/knowledge-bases');
  await expect(page.getByText('当前角色无法访问此页面', { exact: true })).toBeVisible();

  expectCleanBrowserSignals(signals);
});

test('创建知识库并保存实际文件元数据', async ({ page }) => {
  const signals = collectBrowserSignals(page);
  const requestUrls: string[] = [];
  page.on('request', (request) => requestUrls.push(request.url()));

  await enterAs(page, '知识库管理人员');
  await page.goto('/knowledge-bases');
  await page.getByRole('button', { name: '创建知识库', exact: true }).first().click();

  const dialog = page.getByRole('dialog', { name: '创建知识库' });
  await dialog.getByLabel('知识库名称').fill('人力资源制度库');
  await dialog.getByLabel('知识库说明').fill('用于查询员工制度与申请流程');
  await dialog.getByRole('button', { name: '创建并继续', exact: true }).click();

  await expect(page).toHaveURL(/\/knowledge-bases\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: '人力资源制度库', exact: true })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await expect(page.getByText('employee-handbook.md', { exact: true })).toBeVisible();
  await expect(page.getByText('待构建', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('1 个文件 · 0 个知识片段', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始构建', exact: true }).click();
  await expect(page.getByText('请先为知识库选择 Embedding 模型', { exact: true })).toBeVisible();

  const localData = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(localData).toBeNull();

  await page.reload();
  await expect(page.getByRole('heading', { name: '人力资源制度库', exact: true })).toBeVisible();
  await expect(page.getByText('employee-handbook.md', { exact: true })).toBeVisible();
  await expect(page.getByText('1 个文件 · 0 个知识片段', { exact: true })).toBeVisible();

  expect(
    requestUrls.every((url) => {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname === '127.0.0.1' && parsedUrl.port === '4173';
    }),
  ).toBe(true);
  expect(signals.consoleErrors.filter((text) => !text.includes('400 (Bad Request)'))).toEqual([]);
  expect(signals.pageErrors).toEqual([]);
  expect(signals.requestFailures).toEqual([]);
});

test('运行日志只显示零值指标和真实空状态', async ({ page }) => {
  const signals = collectBrowserSignals(page);

  await enterAs(page, '管理员');
  await page.goto('/logs');

  await expect(page.getByText('日志页面只显示真实调用数据', { exact: true })).toBeVisible();
  await expect(page.getByText('对话和检索测试都会记在本机。没有调用时，指标保持为零。', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无可视化数据', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '查询明细', exact: true }).click();
  await expect(page.getByText('暂无查询记录', { exact: true })).toBeVisible();
  await expect(page.getByText('完成真实对话后，此处将显示 Token、耗时和调用过程。', { exact: true })).toBeVisible();

  expectCleanBrowserSignals(signals);
});

test('保存模型、云端 OCR 和知识库检索配置', async ({ page }) => {
  test.setTimeout(60_000);
  const signals = collectBrowserSignals(page);

  await enterAs(page, '管理员');
  await page.goto('/models');
  await expect(page.getByText('密钥只保存在本机服务中', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新增服务商', exact: true }).click();
  const providerDialog = page.getByRole('dialog', { name: '新增模型服务商' });
  await expect(providerDialog.getByLabel('显示名称')).toHaveValue('通义百炼');
  await providerDialog.getByLabel('API 密钥').fill('sk-test-not-real');
  await providerDialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(providerDialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('https://dashscope.aliyuncs.com/compatible-mode/v1', { exact: true })).toBeVisible();
  await expect(page.getByText(/已连通|连接失败/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: '模型配置', exact: true }).click();
  await page.getByRole('button', { name: '新增模型', exact: true }).click();
  const modelDialog = page.getByRole('dialog', { name: '新增模型' });
  await modelDialog.getByLabel('模型服务商').click();
  await chooseVisibleOption(page, '通义百炼');
  await expect(modelDialog.getByRole('combobox', { name: '模型', exact: true })).toBeVisible();
  await expect(modelDialog.getByLabel('显示名称')).toHaveCount(0);
  await expect(modelDialog.getByLabel('模型 ID')).toHaveCount(0);
  await modelDialog.getByRole('button', { name: '关闭' }).click();
  await expect(modelDialog).toBeHidden();

  await createModel(page, 'LLM', '企业对话模型', 'openai/gpt-4.1-mini');
  await createModel(page, 'Embedding', '企业向量模型', 'openai/text-embedding-3-large');
  await createModel(page, 'Rerank', '企业重排模型', 'cohere/rerank-3.5');
  await page.reload();
  await page.getByRole('tab', { name: '模型配置', exact: true }).click();
  await expect(page.getByText('企业对话模型', { exact: true })).toBeVisible();
  await expect(page.getByText('企业向量模型', { exact: true })).toBeVisible();
  await expect(page.getByText('企业重排模型', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '视觉识别', exact: true }).click();
  await page.getByLabel('识别模型').click();
  await chooseVisibleOption(page, '企业对话模型');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已选择识别模型', exact: true })).toBeVisible();

  await page.goto('/knowledge-bases');
  await page.getByRole('button', { name: '创建知识库', exact: true }).first().click();
  const knowledgeDialog = page.getByRole('dialog', { name: '创建知识库' });
  await knowledgeDialog.getByLabel('知识库名称').fill('产品与服务知识库');
  await knowledgeDialog.getByLabel('知识库说明').fill('用于验证模型选择和检索参数');
  await knowledgeDialog.getByRole('button', { name: '创建并继续', exact: true }).click();

  await page.getByRole('tab', { name: '知识库设置', exact: true }).click();
  await page.getByLabel('Embedding 模型').click();
  await chooseVisibleOption(page, '企业向量模型');
  await page.getByLabel('分块大小（Token）').fill('800');
  await page.getByLabel('重叠长度（Token）').fill('120');
  await page.getByLabel('默认检索方式').click();
  await chooseVisibleOption(page, '混合检索');
  await page.getByLabel('候选片段数量').fill('12');
  await page.getByLabel('最低相关度').fill('0.45');
  await page.getByLabel('引用 Token 上限').fill('8192');
  await expect(page.getByLabel('问题优化')).toBeChecked();
  await expect(page.getByLabel('结果重排')).toBeChecked();
  await page.getByLabel('Rerank 模型').click();
  await chooseVisibleOption(page, '企业重排模型');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('知识库配置已保存', { exact: true })).toBeVisible();

  const storedData = await page.evaluate(async () => {
    const headers = { 'X-Role': 'admin' };
    const [providers, models, vision, knowledgeBases] = await Promise.all([
      fetch('/api/providers', { headers }).then((response) => response.json()),
      fetch('/api/models', { headers }).then((response) => response.json()),
      fetch('/api/vision', { headers }).then((response) => response.json()),
      fetch('/api/knowledge-bases', { headers }).then((response) => response.json()),
    ]);
    return { providers, models, vision, knowledgeBases };
  });
  expect(storedData.providers).toHaveLength(1);
  expect(storedData.providers[0]).toMatchObject({
    kind: 'tongyi',
    name: '通义百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hasApiKey: true,
  });
  expect(JSON.stringify(storedData)).not.toContain('sk-test-not-real');
  expect(storedData.models.map((model: { capability: string }) => model.capability).sort()).toEqual([
    'embedding',
    'llm',
    'rerank',
  ]);
  const llmModel = storedData.models.find((model: { capability: string }) => model.capability === 'llm');
  expect(storedData.vision.modelConfigId).toBe(llmModel.id);

  const knowledgeBase = storedData.knowledgeBases[0];
  const embeddingModel = storedData.models.find(
    (model: { capability: string }) => model.capability === 'embedding',
  );
  const rerankModel = storedData.models.find(
    (model: { capability: string }) => model.capability === 'rerank',
  );
  expect(knowledgeBase.settings).toMatchObject({
    embeddingModelId: embeddingModel.id,
    rerankModelId: rerankModel.id,
    chunkSize: 800,
    chunkOverlap: 120,
    retrievalMode: 'hybrid',
    retrievalCount: 12,
    scoreThreshold: 0.45,
    maxContextTokens: 8192,
    queryOptimization: true,
    rerankEnabled: true,
  });

  const serializedData = JSON.stringify(storedData).toLocaleLowerCase();
  expect(serializedData).not.toContain('sk-test-not-real');
  const browserStorage = await page.evaluate(() => `${window.localStorage} ${window.sessionStorage}`);
  expect(browserStorage).not.toContain('sk-test-not-real');

  await page.reload();
  await expect(page.getByRole('tab', { name: '知识库设置', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('企业向量模型', { exact: true })).toBeVisible();
  await expect(page.getByText('企业重排模型', { exact: true })).toBeVisible();
  await expect(page.getByLabel('候选片段数量')).toHaveValue('12');
  await expect(page.getByLabel('最低相关度')).toHaveValue('0.45');
  await expect(page.getByLabel('引用 Token 上限')).toHaveValue('8192');

  expectCleanBrowserSignals(signals);
});

test('应用商店列出写作场景', async ({ page }) => {
  const signals = collectBrowserSignals(page);

  await enterAs(page, '使用者');
  await page.goto('/apps');
  await expect(page.getByRole('heading', { name: '应用', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '写文章', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '写周报', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '打开应用' }).first().click();
  await expect(page).toHaveURL(/\/apps\/article$/);
  await expect(page.getByLabel('文章主题')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeDisabled();

  expectCleanBrowserSignals(signals);
});

test('移动端导航可访问并且页面没有横向文档滚动', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', '仅在手机视口执行');
  const signals = collectBrowserSignals(page);

  await enterAs(page, '管理员');
  const navigationButton = page.getByRole('button', { name: '打开导航', exact: true });
  await expect(navigationButton).toBeVisible();
  await navigationButton.click();

  const drawer = page.getByRole('dialog', { name: '功能导航' });
  await expect(drawer.getByRole('link', { name: '系统概览', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: '在线对话', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: '应用', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: '知识库', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: '模型与 OCR', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: '运行日志', exact: true })).toBeVisible();

  await drawer.getByRole('link', { name: '知识库', exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge-bases$/);
  await expect(drawer).toBeHidden();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expectCleanBrowserSignals(signals);
});
