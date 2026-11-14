import type { Metadata, Viewport } from 'next';
import '../(enterprise)/workbench.css';
import './admin.css';

// Platform console (ADR-0018) on HESTIA_ADMIN_HOST only, desktop. Shares the workbench's visual system (WEB_UI_DESIGN.md).
export const metadata: Metadata = { title: '平台管理', robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f2f1ee' }, { media: '(prefers-color-scheme: dark)', color: '#121214' }] };
const themeScript = `try{var t=localStorage.getItem('hestia.workbench.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }}/></head><body>{children}</body></html>;
}
