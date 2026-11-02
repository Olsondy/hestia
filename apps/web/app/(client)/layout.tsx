import type { Metadata, Viewport } from 'next';
import './client.css';

// Customer-facing H5 (also embedded by the mini program web-view). Separate root layout: no workbench styles.
export const metadata: Metadata = { title: '方案客户端', description: '提交户型与石材偏好，查看并确认铺贴方案。' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f6f1e8' };
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
