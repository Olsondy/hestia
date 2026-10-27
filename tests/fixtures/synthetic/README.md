# 合成图纸夹具

这里的 PNG 和 HouseSpec 全部由 `scripts/validation/generate-synthetic.py` 生成，没有用户上传、真实住宅或真实扫描件。`scan-like`、`handdrawn-like` 只是加噪/旋转和双线扰动的合成图片，不能作为三类真实授权样本的验收证据。

理想墙中线为 6000 × 4000 mm 矩形，墙厚 200 mm，底边 900 mm 缺口。图像比例固定为 20 mm/px；理想几何在 `ground-truth.housespec.json`，像素离散化、旋转、抗锯齿会导致提取误差。

这些文件不包含家具图像。T01 的 `synthetic-chair` 是独立工具协议场景的虚拟对象，不得声称模型从图片识别出了该家具。
