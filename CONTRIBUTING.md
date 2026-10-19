# 参与开发

先阅读 [AGENTS.md](AGENTS.md)、[产品上下文](PRODUCT.md) 和 [原型契约](docs/prototype-brief.md)。新增通用流程之前，应明确需求和输入数据契约。

1. 使用 Node.js 22+，执行 `npm ci`。
2. 修改 `src/`，不要手改 `dist/index.html`。
3. 按改动运行 `npm run check` 和必要的浏览器复核，见 [开发与验证](docs/development.md)。
4. 提交相关源码和当前构建结果，不提交中间文件。

变更说明应交代：用户可见行为、固定设施是否受影响、已执行的验证及未完成的验证。新增家具或数据来源时记录其使用许可。示例尺寸始终标为示意，不升级为实测尺寸。
