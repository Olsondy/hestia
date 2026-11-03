import type { Metadata, Viewport } from 'next';
import './client.css';

// Customer-facing H5 (also embedded by the mini program web-view). Separate root layout: no workbench styles.
export const metadata: Metadata = { title: '方案客户端', description: '提交户型与石材偏好，查看并确认整体方案。' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f2f1ee' }, { media: '(prefers-color-scheme: dark)', color: '#0f0f10' }] };
// Apply the theme chosen on「我的」before first paint, so a dark choice does not flash light.
const themeScript = `try{var t=localStorage.getItem('hestia.client.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }}/></head><body>{children}</body></html>;
}
