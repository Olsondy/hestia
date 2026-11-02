# Hestia

Hestia 取名自古希腊神话中的炉火女神赫斯提亚，造屋之始祖。它是空间设计工作台：用户导入单层户型图纸并说明居住需求，由 Agent 完成空间设计与迭代，以 3D 和静态图呈现。首版仍在开发中，进度见 [项目现状](docs/status.md)。

## 目录

```text
apps/web/                        Next.js 应用
apps/worker/                     模型调用与后台任务 Worker
packages/                        共享契约、领域服务与场景运行时
example/prototypes/projects/     工作台原型（源码在 src/，含构建产物）
assets/fonts/tsanger-yuyang/     仓耳渔阳体字体与授权声明
scripts/                         构建、本地环境、迁移与验证脚本
dist/index.html                  原型兼容构建产物
docs/                            产品范围、架构、工单、验收与决策
```

## 启动

需要 Node.js 22+ 与 `package.json` 指定的 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm preview   # 原型：http://127.0.0.1:4173/example/prototypes/projects/
pnpm dev       # Web 应用：http://127.0.0.1:3000
```

本地数据库、完整命令与验证方式见 [开发与验证](docs/development.md)。

## 文档

- [项目现状](docs/status.md) · [产品上下文](PRODUCT.md) · [领域语言](CONTEXT.md) · [决策记录](docs/decisions/)
- [技术栈](docs/web-stack.md) · [实施计划](docs/v1-development-plan.md) · [设计系统](DESIGN.md) · [原型契约](docs/prototype-brief.md)
- [开发与验证](docs/development.md) · [验收记录](docs/validation/) · [参与开发](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可

项目尚未选择开源许可证（`UNLICENSED`）。第三方代码与字体依各自声明使用，见 [字体授权](assets/fonts/tsanger-yuyang/NOTICE.txt)。
