import type { Metadata, Viewport } from 'next';
import './site.css';

// Site entry (ADR-0015): the root domain's front page with the customer and workbench doors. Own root layout.
export const metadata: Metadata = { title: 'Hestia · 空间设计工作台', description: '导入户型，由设计助手完成布局、风格与铺贴，3D 呈现并出图。' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f3ece2' };
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
