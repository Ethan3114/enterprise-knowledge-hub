# 企业知识库中台

在本机完成知识导入、手动构建和在线对话。页面负责操作，Python 服务负责解析、检索和调用模型。密钥只保存在本机数据库里，不会留在浏览器。

## 本地运行

第一次需要安装两边的依赖：

```bash
npm install
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
npm run dev:all
```

浏览器访问 `http://127.0.0.1:4173`。

## 验证命令

```bash
backend/.venv/bin/python -m pytest -q
npm run build
npm run test:e2e
```

端到端测试会同时启动本机服务和页面，并使用项目 `.cache/ms-playwright` 目录中的 Chromium。首次执行测试前需要安装浏览器：

```bash
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright install chromium
```

## 第一版范围

- 角色：管理员、知识库管理人员、使用者。这是演示用的职责开关，不是登录。
- 文件：PDF、docx、Markdown、PNG、JPG、WEBP、TIFF、CSV、xlsx。旧版 doc、xls 需要另存后再上传。
- 限制：PDF 和 Word 单文件 50 MB、最多 200 页；Markdown、表格和图片 10 MB；表格最多 1 万行；一次最多 32 个文件；一个知识库最多 200 个文件。
- 构建：文件上传后由管理员手动点击「开始构建」。
- 模型服务商：OpenRouter、AIHubMix、通义百炼、DeepSeek。各家能提供什么就配置什么。
- 识别：文字在本机提取；扫描页和图片交给已配置的云端视觉模型。
- 对话：可同时选择多个知识库，逐字返回，并记住上一轮问答。
- 应用：与在线对话平级。当前提供「写文章」和「写周报」，生成时使用同一套知识库检索。新场景按应用定义继续添加。
- 日志：记录查询内容、Token 消耗、使用时长和调用状态。

数据文件在 `data/`。其中包含 API 密钥，不要提交到仓库。
