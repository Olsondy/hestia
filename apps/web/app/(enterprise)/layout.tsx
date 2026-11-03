import type { Metadata, Viewport } from 'next';
import './workbench.css';

// Enterprise workbench (/w/{slug}) for enterprise members, desktop. Separate root layout: no client H5 or personal workbench styles.
export const metadata: Metadata = { title: '企业工作台', description: '企业成员处理线索、审核方案与分享。', robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f2f1ee' }, { media: '(prefers-color-scheme: dark)', color: '#121214' }] };
// Apply the theme chosen in the top bar before first paint, so a dark choice does not flash light.
const themeScript = `try{var t=localStorage.getItem('hestia.workbench.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }}/></head><body>{children}</body></html>;
}
