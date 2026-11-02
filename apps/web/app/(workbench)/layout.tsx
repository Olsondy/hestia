import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Hestia · 你的空间', description: '从一处空间，开始理想的家。' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
