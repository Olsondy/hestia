import { redirect } from 'next/navigation';
import { siteEnterprise } from '../../../lib/site-entry';

export const dynamic = 'force-dynamic';

/** Workbench front door without an enterprise in the URL: the configured enterprise's workbench, else guidance. */
export default function WorkbenchDoor() {
  const enterprise = siteEnterprise();
  if (enterprise) redirect(`/w/${enterprise}`);
  return <main className="note">
    <a className="top__brand" href="/"><span className="mark" aria-hidden="true"/><b>Hestia</b><span>企业工作台</span></a>
    <h1 className="section-title">请使用企业提供的工作台地址。</h1>
    <p>工作台地址形如 <code>/w/企业标识</code>，由企业管理员在邀请你时提供。</p>
  </main>;
}
