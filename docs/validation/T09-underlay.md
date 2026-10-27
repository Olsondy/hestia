# T09 图纸与 PDF 底图验证

本票提供图片或 PDF 选页、旋转裁切、私有保存与重开后的二维叠图。生产界面继承家居杂志方向和仓耳渔阳体；没有识图、尺度校准或真实模型调用。仅使用代码生成的 PDF/PNG，未读取私密样本。

## 实现与契约

- `GET /api/projects/:id/underlay` 返回 `{underlay,storage}`；无底图时 `underlay:null`。
- `POST /api/projects/:id/underlay` 接收 multipart 的 `metadata` JSON 与 `file` 两个字段。metadata 含 operationId、expectedVersion、source、crop、rotation、display。只上传选定区域的 PNG；PDF 原文件始终留在浏览器。
- `PATCH /api/projects/:id/underlay` 接收 operationId、expectedVersion、resourceId、display，保存偏移、显示缩放和不透明度。
- `GET /api/projects/:id/resources/:resourceId/content` 在服务端复核账号、项目、资源归属及 ready 状态后返回 PNG，`Cache-Control: private, no-store`。不接受客户端 objectKey、路径或 URL。
- crop 使用当前选定页**旋转前渲染像素**；先裁切再顺时针旋转。source 保留文件 SHA256、页码/页数、原渲染尺寸、PDF viewport 矩阵，sourceToImage 保存到最终图像的二维仿射变换。显示缩放不是米制尺度。
- project_underlays 使用独立版本和事务，避免覆盖并行家具编辑的空间快照。更新必须匹配 expectedVersion；操作 UUID 和请求内容实现幂等，失败重试冻结原请求。

## 文件可靠性与限制

当前唯一适配为 `LocalPrivateFileStore(PRIVATE_STORAGE_PATH)`，存放在非 public 的私有文件系统；生产对象存储供应商与部署尚未选择。此实现不代表已接通 S3 或云存储。

浏览器源文件上限 30 MiB、PDF 200 页；页面渲染限制长边约 3000 px、最高 1600 万像素。上传选区最多 12 MiB。服务端按实际流量限制 multipart，使用 sharp 验证真实格式、解码像素和尺寸，再重编码为去元数据的 PNG。拒绝损坏、伪 MIME、动画、多页图片及不匹配的变换尺寸。

资源先为 pending，文件临时写入、fsync 和原子重命名完成后，事务一起发布 ready 资源及底图版本。写入或元数据冲突时不会替换当前底图；失败可重试同一逻辑资源。最终 COMMIT 响应丢失时，只在数据库明确确认资源未 ready 后才删除文件，不能确认则保留，防止误删已发布文件。进程崩溃残留 pending 或未引用文件可重试恢复；定期清理与生产存储适配不在本票实现中。

## 验证命令

使用已经运行的本地 Next 和 PostgreSQL；本轮未启动或重启任何服务。

```sh
node --env-file=.env --import tsx --test packages/files/src/service.integration.test.ts
node --env-file=.env --import tsx scripts/validation/underlay-browser.ts
pnpm exec tsc --noEmit
pnpm --dir apps/web exec tsc --noEmit
```

数据库集成测试 7/7 通过：磁盘写入失败与原资源重试、跨账号/跨项目读写、非法类型/损坏内容/实际字节超限、并发版本冲突、坐标矩阵、最终 COMMIT 实际成功但响应丢失后的文件保留与幂等恢复。测试验证底图更新不改变空间项目 revision。

## 浏览器证据

最终结果与截图保存在忽略目录 `.impeccable/review/t09/`，不提交图纸或调试截图。浏览器脚本生成两页 PDF：第一页灰色，第二页四种不同颜色。选第 2 页，裁切 `(80,60,480,360)` 后旋转 90°，实际上传输出为 `360×480` PNG。脚本验证 Konva 画布存在真实红色像素，也下载并解码服务端字节检查四色位置，避免只检查元数据而漏掉画布空白或错页。

覆盖快速切页、提交成功后网络响应丢失并重试相同资源、偏移/不透明度保存后刷新恢复、未配准空间轮廓、坏 PDF 提示、图片导入重开，以及 HTTP 越权、伪 MIME、坏图、非法类型、实际超限和 pending 资源拒绝。验证使用 1440×1000、1100×900、390×844 视口；保存态启用 reduced-motion，并检查无横向溢出、字体加载和运行时错误。

最终浏览器全流程已通过，7 张当前截图均实际打开检查，Konva 选区与保存后叠图正常；两处 TypeScript 检查通过。测试中发现并修复了手机工作区固定高度遮挡、Konva JSX 空格节点导致空白画布，以及 COMMIT 响应丢失时误删 ready 文件的问题。重复执行曾触发登录接口正常 60 秒限流；等待自然恢复后完成最终验证，没有重启服务或修改限流。

本轮创建的随机测试账号、邀请、会话、项目和文件按具体 ID 清理，临时合成 PDF 删除；保留忽略目录中的验证截图。独立视觉审阅已完成，五段 `ship` 结论与 Documenter 对照记录于 `.impeccable/review/t09/finish-verdict.md`。7 张截图全部打开，未提出必须修复项；静态图只验证可见状态，拖动、保存和重开以浏览器脚本记录为证据。

主 Agent 复核文件完成/发布事务和权限边界，亲看桌面与手机截图，并新跑文件数据库测试 7/7 与根类型检查通过。四项工单验收通过。存储适配与生产部署边界如上；代码仍在本地，未宣称已提交、远端 CI 或云存储部署通过。
