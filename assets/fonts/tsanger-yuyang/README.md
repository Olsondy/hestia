# 仓耳渔阳体

用户指定来源：`CONTEXTA/contexta-server/resources/fonts/tsanger-yuyang`。原始 TTF 与版权声明保留在此目录，Hestia 不修改外部来源。使用仓耳免费商用字体授权，具体条件见 [NOTICE.txt](NOTICE.txt)，不将其等同于 SIL OFL，也不单独销售字体。

W01–W05 分别对应 CSS 字重 300、400、500、600、700。`fonts.css` 提供公共字体声明；`sources.json` 记录文件、字重与原始文件 SHA-256。WOFF2 仅压缩原始 TTF，保留完整字形，没有按当前页面文字裁剪。

正常构建直接读取已提交的 WOFF2，无需网络或 Python。重建字体时安装 Python fontTools 与 Brotli，设置 `FONTTOOLS_PYTHON` 指向该 Python 后运行 `npm run fonts`；此操作仅更新本目录的 WOFF2、清单和 CSS。
